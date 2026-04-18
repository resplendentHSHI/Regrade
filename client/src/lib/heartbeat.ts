import { appDataDir } from "@tauri-apps/api/path";
import * as sidecar from "./sidecar";
import * as api from "./api";
import * as store from "./store";
import { uploadPendingJobs, pollJobResults } from "./queue";
import type { Assignment } from "./types";

export async function runHeartbeat(
  gsEmail: string,
  gsPassword: string,
  token: string,
): Promise<void> {
  const state = await store.getHeartbeatState();
  state.status = "running";
  await store.saveHeartbeatState(state);

  try {
    const courses = await store.getCourses();
    const enabledIds = courses.filter((c) => c.enabled).map((c) => c.id);
    if (enabledIds.length === 0) {
      state.status = "idle";
      return;
    }

    const appData = await appDataDir();
    const sep = appData.endsWith("/") || appData.endsWith("\\") ? "" : "/";
    const dataDir = `${appData}${sep}poko/pdfs`;

    const assignments = await store.getAssignments();
    const alreadyProcessedIds = assignments.map(
      (a) => `${a.courseId}_${a.assignmentId}`
    );

    // First run (no assignments yet): backfill 30 days.
    // Subsequent runs: download ALL newly graded (no date limit).
    const isFirstRun = assignments.length === 0;
    const backfillDays = isFirstRun ? 30 : undefined;

    // 1. Fetch graded PDFs + scores from Gradescope
    const result = await sidecar.fetchGraded(
      gsEmail, gsPassword, enabledIds, dataDir, alreadyProcessedIds, backfillDays,
    );

    // 2. Add new items to local assignments
    const courseMap = new Map(courses.map((c) => [c.id, c.name]));
    for (const item of result.items as any[]) {
      assignments.push({
        courseId: item.course_id,
        assignmentId: item.assignment_id,
        submissionId: item.submission_id,
        name: item.name,
        courseName: courseMap.get(item.course_id) || "",
        score: item.score,
        maxScore: item.max_score,
        dueDate: item.due_date,
        type: item.type,
        pdfHash: item.pdf_hash,
        pdfPath: item.pdf_path,
        status: "pending_upload",
      } as Assignment);
    }
    await store.saveAssignments(assignments);

    // 3. Sync scores with server
    const scores = result.scores as any[];
    if (scores.length > 0) {
      try {
        await api.syncScores(token, scores);
      } catch (err) {
        console.error("Score sync failed:", err);
      }
    }

    // 4. Upload pending PDFs to server
    await uploadPendingJobs(token);

    // 5. Poll for any completed results
    await pollJobResults(token);

    // 6. Fetch upcoming assignments
    try {
      const upcoming = await sidecar.fetchUpcoming(gsEmail, gsPassword, enabledIds);
      await store.saveUpcoming(upcoming);
    } catch (err) {
      console.error("Upcoming fetch failed:", err);
    }

    const newCount = (result.items as any[]).length;
    try {
      await store.addActivity(
        `Heartbeat complete: ${newCount} new assignment(s) found`,
        newCount > 0 ? "success" : "info",
      );
    } catch (err) {
      console.warn("Activity log write failed:", err);
    }

    state.lastRun = new Date().toISOString();
    state.status = "idle";
    state.queueDepth = (await store.getAssignments()).filter(
      (a) => a.status === "pending_upload" || a.status === "uploading" || a.status === "analyzing",
    ).length;
  } catch (err) {
    state.status = "error";
    console.error("Heartbeat error:", err);
    try {
      await store.addActivity(`Heartbeat error: ${err}`, "warning");
    } catch (logErr) {
      console.warn("Error activity log write failed:", logErr);
    }
  } finally {
    // ALWAYS persist the terminal status — even if the try/catch bodies
    // themselves threw. Without this, a crash mid-run leaves status="running"
    // in storage, making the UI claim Poko is forever running.
    if (state.status === "running") {
      // Safety net: if we somehow exit the try without setting a terminal
      // status, treat it as an error rather than lying to the UI.
      state.status = "error";
    }

    // Schedule next for tomorrow 2 AM
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    state.nextScheduled = next.toISOString();

    try {
      await store.saveHeartbeatState(state);
    } catch (err) {
      console.error("Failed to persist final heartbeat state:", err);
    }
  }
}

/**
 * Recover from a crashed prior heartbeat. If storage claims the heartbeat is
 * still "running" but nothing is actually in progress (this function is only
 * called before any new run starts), reset it to idle so the UI doesn't lie.
 */
export async function resetStaleRunningStatus(): Promise<void> {
  const state = await store.getHeartbeatState();
  if (state.status === "running") {
    state.status = "idle";
    await store.saveHeartbeatState(state);
  }
}

export function shouldRunHeartbeat(lastRun: string | null): boolean {
  if (!lastRun) return true;
  const last = new Date(lastRun);
  const now = new Date();
  // Run if last run was before today's 2 AM and it's past 2 AM now
  const todaySlot = new Date(now);
  todaySlot.setHours(2, 0, 0, 0);
  return last < todaySlot && now >= todaySlot;
}
