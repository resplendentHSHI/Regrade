import { convertFileSrc } from "@tauri-apps/api/core";
import * as api from "./api";
import * as store from "./store";

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
