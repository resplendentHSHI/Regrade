import { Command } from "@tauri-apps/plugin-shell";

interface SidecarResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function runSidecar(args: string[]): Promise<SidecarResponse> {
  try {
    const cmd = Command.sidecar("binaries/poko-sidecar", args);
    const output = await cmd.execute();
    if (output.stdout) {
      try {
        return JSON.parse(output.stdout.trim());
      } catch {
        return { ok: false, error: `Invalid JSON from sidecar: ${output.stdout.slice(0, 200)}` };
      }
    }
    return { ok: false, error: output.stderr || "No output from sidecar" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Sidecar invocation failed:", msg);
    return { ok: false, error: `Sidecar error: ${msg}` };
  }
}

export async function testLogin(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return runSidecar(["login", email, password]);
}

export async function fetchCourses(email: string, password: string) {
  const resp = await runSidecar(["courses", email, password]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch courses");
  return resp.courses as Array<{ id: string; name: string; semester: string; year: string }>;
}

export async function fetchGraded(
  email: string, password: string, courseIds: string[],
  dataDir: string, alreadyProcessedIds: string[] = [],
  backfillDays?: number,
) {
  const args = [
    "fetch", email, password,
    JSON.stringify(courseIds), dataDir,
    JSON.stringify(alreadyProcessedIds),
  ];
  if (backfillDays !== undefined) {
    args.push(String(backfillDays));
  }
  const resp = await runSidecar(args);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch");
  return resp as { ok: boolean; items: unknown[]; scores: unknown[] };
}

export async function fetchUpcoming(email: string, password: string, courseIds: string[]) {
  const resp = await runSidecar(["upcoming", email, password, JSON.stringify(courseIds)]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch upcoming");
  return resp.assignments as Array<{ name: string; dueDate: string; courseId: string; assignmentId: string; type: string }>;
}

export async function listGraded(email: string, password: string, courseIds: string[]) {
  const resp = await runSidecar(["list_graded", email, password, JSON.stringify(courseIds)]);
  if (!resp.ok) throw new Error(resp.error || "Failed to list graded");
  return resp.assignments as Array<{
    course_id: string; assignment_id: string; submission_id: string;
    name: string; score: number | null; max_score: number | null;
    due_date: string | null; type: string;
  }>;
}

export async function fetchSpecific(
  email: string, password: string,
  assignments: Array<{ course_id: string; assignment_id: string; submission_id: string; name: string; score: number | null; max_score: number | null; due_date: string | null; type: string }>,
  dataDir: string,
) {
  const resp = await runSidecar([
    "fetch_specific", email, password,
    JSON.stringify(assignments), dataDir,
  ]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch specific");
  return resp as { ok: boolean; items: unknown[] };
}
