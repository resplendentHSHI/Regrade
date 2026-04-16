import * as api from "./api";
import * as store from "./store";
import { readFile } from "@tauri-apps/plugin-fs";

export async function uploadPendingJobs(token: string): Promise<number> {
  const assignments = await store.getAssignments();
  let uploaded = 0;

  const pending = assignments.filter((a) => a.status === "pending_upload" && a.pdfPath);
  for (const item of pending) {
    try {
      const pdfBytes = await readFile(item.pdfPath!);
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
      console.error(`Upload failed for ${item.name}:`, err);
      await store.addActivity(`Upload failed for ${item.name}: ${err}`, "warning");
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
      console.error(`Poll failed for ${item.name}:`, err);
    }
  }

  await store.saveAssignments(assignments);
  return completed;
}
