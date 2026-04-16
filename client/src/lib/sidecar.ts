import { Command } from "@tauri-apps/plugin-shell";

interface SidecarResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function runSidecar(args: string[]): Promise<SidecarResponse> {
  // Use Tauri's sidecar mechanism — resolves to the bundled binary
  // (binaries/poko-sidecar-{target_triple} in the app bundle)
  const cmd = Command.sidecar("binaries/poko-sidecar", args);

  const output = await cmd.execute();
  if (output.stdout) {
    try {
      return JSON.parse(output.stdout.trim());
    } catch {
      return { ok: false, error: `Invalid JSON: ${output.stdout}` };
    }
  }
  return { ok: false, error: output.stderr || "No output from sidecar" };
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
  dataDir: string, existingHashes: string[] = [],
) {
  const resp = await runSidecar([
    "fetch", email, password,
    JSON.stringify(courseIds), dataDir,
    JSON.stringify(existingHashes),
  ]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch");
  return resp as { ok: boolean; items: unknown[]; scores: unknown[] };
}

export async function fetchUpcoming(email: string, password: string, courseIds: string[]) {
  const resp = await runSidecar(["upcoming", email, password, JSON.stringify(courseIds)]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch upcoming");
  return resp.assignments as Array<{ name: string; dueDate: string; courseId: string; assignmentId: string; type: string }>;
}
