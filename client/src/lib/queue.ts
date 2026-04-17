import { convertFileSrc } from "@tauri-apps/api/core";
import * as api from "./api";
import * as store from "./store";

/**
 * Reconcile local state with the server. Called on app start and periodically.
 *
 * For each local assignment:
 *   - If client has a pdfHash and server has a job with that hash → claim the
 *     job_id and sync the state/result
 *   - If client has a jobId that server doesn't know → clear it so we re-upload
 *   - If server has results the client hasn't fetched → fetch them
 *
 * Never loses data. Never silently drops state. Idempotent.
 */
export async function reconcileWithServer(token: string): Promise<{
  claimed: number; pulled: number; orphaned: number;
}> {
  let serverState;
  try {
    serverState = await api.syncJobs(token);
  } catch (err) {
    console.warn("Reconcile skipped (server unreachable):", err);
    return { claimed: 0, pulled: 0, orphaned: 0 };
  }

  const assignments = await store.getAssignments();
  const byHash = serverState.by_hash;
  let claimed = 0;
  let pulled = 0;
  let orphaned = 0;

  for (const item of assignments) {
    const serverJob = item.pdfHash ? byHash[item.pdfHash] : undefined;

    // Case 1: client has a jobId the server doesn't know about → orphaned
    if (item.jobId && !Object.values(byHash).some((j) => j.job_id === item.jobId)) {
      if (serverJob) {
        // Server has the same hash under a different jobId — claim it
        item.jobId = serverJob.job_id;
        claimed++;
      } else if (item.pdfPath) {
        // Lost upload — revert so it retries
        item.jobId = undefined;
        if (!["no_issues", "regrade_candidates", "failed"].includes(item.status)) {
          item.status = "pending_upload";
        }
        orphaned++;
      }
    }

    // Case 2: server has a job for our hash that we don't know about
    if (serverJob && !item.jobId && item.pdfHash) {
      item.jobId = serverJob.job_id;
      claimed++;
    }

    // Case 3: server has result, client hasn't stored it yet
    if (serverJob?.has_result && !item.resultJson && item.jobId) {
      try {
        const result = await api.getJobResult(token, item.jobId);
        item.resultJson = result.result_json ?? undefined;
        item.draftMd = result.draft_md ?? undefined;
        if (result.result_json) {
          const parsed = JSON.parse(result.result_json);
          const kept = parsed.kept_issue_count || 0;
          item.status = kept > 0 ? "regrade_candidates" : "no_issues";
        } else {
          item.status = "failed";
        }
        pulled++;
      } catch (err) {
        console.warn(`Failed to pull result for ${item.name}:`, err);
      }
    }

    // Case 4: sync status from server for in-flight items
    if (serverJob && !serverJob.has_result && item.jobId && item.jobId === serverJob.job_id) {
      // Server says still processing — make sure our status reflects that
      if (item.status === "pending_upload" || item.status === "uploading") {
        item.status = serverJob.status === "analyzing" ? "analyzing" : "uploading";
      }
    }
  }

  await store.saveAssignments(assignments);
  return { claimed, pulled, orphaned };
}

export async function uploadPendingJobs(token: string): Promise<number> {
  const assignments = await store.getAssignments();
  let uploaded = 0;

  const pending = assignments.filter((a) => a.status === "pending_upload" && a.pdfPath);
  for (const item of pending) {
    try {
      // Read PDF bytes via Tauri's asset protocol (works with absolute paths)
      const assetUrl = convertFileSrc(item.pdfPath!);
      const resp = await fetch(assetUrl);
      if (!resp.ok) {
        throw new Error(`Failed to read PDF: ${resp.status} ${resp.statusText} (${item.pdfPath})`);
      }
      const pdfBytes = await resp.arrayBuffer();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });

      const result = await api.uploadJob(token, blob, {
        courseId: item.courseId,
        assignmentId: item.assignmentId,
        assignmentName: item.name,
        courseName: item.courseName || "",
      });
      item.jobId = result.job_id;
      item.status = "uploading";
      uploaded++;
      await store.addActivity(`Uploaded ${item.name} for analysis`, "info");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Upload failed for ${item.name}:`, msg);
      await store.addActivity(`Upload failed for ${item.name}: ${msg}`, "warning");
    }
  }

  await store.saveAssignments(assignments);
  return uploaded;
}

export async function pollJobResults(token: string): Promise<number> {
  const assignments = await store.getAssignments();
  let completed = 0;

  const inFlight = assignments.filter(
    (a) => a.jobId && (a.status === "uploading" || a.status === "analyzing"),
  );

  for (const item of inFlight) {
    try {
      const status = await api.getJobStatus(token, item.jobId!);
      if (status.status === "complete" || status.status === "failed") {
        const result = await api.getJobResult(token, item.jobId!);
        item.resultJson = result.result_json ?? undefined;
        item.draftMd = result.draft_md ?? undefined;

        if (result.result_json) {
          const parsed = JSON.parse(result.result_json);
          const kept = parsed.kept_issue_count || 0;
          item.status = kept > 0 ? "regrade_candidates" : "no_issues";
          await store.addActivity(
            kept > 0
              ? `Poko found ${kept} regrade candidate(s) in ${item.name}`
              : `No issues found in ${item.name}`,
            kept > 0 ? "success" : "info",
          );
        } else {
          item.status = "failed";
        }

        await api.deleteJob(token, item.jobId!);
        completed++;
      } else {
        item.status = "analyzing";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Poll failed for ${item.name}:`, msg);
      // If server returned 404, the job was deleted. Self-heal:
      // - if we already have a result stored, mark it complete based on kept count
      // - otherwise the upload was lost; revert to pending_upload so it retries
      if (msg.includes("404")) {
        if (item.resultJson) {
          try {
            const parsed = JSON.parse(item.resultJson);
            const kept = parsed.kept_issue_count || 0;
            item.status = kept > 0 ? "regrade_candidates" : "no_issues";
          } catch {
            item.status = "no_issues";
          }
        } else {
          // Lost upload — clear jobId and put back in queue for retry
          item.jobId = undefined;
          item.status = "pending_upload";
        }
      }
    }
  }

  await store.saveAssignments(assignments);
  return completed;
}
