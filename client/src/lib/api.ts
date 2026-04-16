import { refreshAccessToken } from "./auth";

const SERVER_URL = "https://tp64.tailf28040.ts.net";

async function request(path: string, options: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...fetchOpts } = options;
  const headers: Record<string, string> = { ...(fetchOpts.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let resp = await fetch(`${SERVER_URL}${path}`, { ...fetchOpts, headers });

  // Auto-refresh on 401
  if (resp.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      resp = await fetch(`${SERVER_URL}${path}`, { ...fetchOpts, headers });
    }
  }

  return resp;
}

export async function verifyAuth(token: string) {
  const resp = await request("/auth/verify", { method: "POST", token });
  if (!resp.ok) throw new Error("Auth failed");
  return resp.json() as Promise<{ email: string; user_id: string }>;
}

export async function uploadJob(token: string, file: Blob,
  metadata: { courseId: string; assignmentId: string; assignmentName: string; courseName: string }) {
  const form = new FormData();
  form.append("file", file, "submission.pdf");
  form.append("course_id", metadata.courseId);
  form.append("assignment_id", metadata.assignmentId);
  form.append("assignment_name", metadata.assignmentName);
  form.append("course_name", metadata.courseName);
  const resp = await request("/jobs", { method: "POST", token, body: form });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  return resp.json() as Promise<{ job_id: string; status: string }>;
}

export async function getJobStatus(token: string, jobId: string) {
  const resp = await request(`/jobs/${jobId}/status`, { token });
  if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
  return resp.json() as Promise<{ job_id: string; status: string }>;
}

export async function getJobResult(token: string, jobId: string) {
  const resp = await request(`/jobs/${jobId}/result`, { token });
  if (!resp.ok) throw new Error(`Result fetch failed: ${resp.status}`);
  return resp.json() as Promise<{ job_id: string; status: string; result_json: string | null; draft_md: string | null }>;
}

export async function deleteJob(token: string, jobId: string) {
  const resp = await request(`/jobs/${jobId}`, { method: "DELETE", token });
  return resp.ok;
}

export async function syncScores(token: string,
  scores: Array<{ course_id: string; assignment_id: string; score: number; max_score: number }>) {
  const resp = await request("/scores/sync", {
    method: "POST", token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores }),
  });
  if (!resp.ok) throw new Error(`Score sync failed: ${resp.status}`);
  return resp.json() as Promise<{ changes_detected: number; total_points_delta: number; details: unknown[] }>;
}

export async function getUserStats(token: string) {
  const resp = await request("/users/me/stats", { token });
  if (!resp.ok) throw new Error(`Stats fetch failed: ${resp.status}`);
  return resp.json() as Promise<{ email: string; points_recovered: number; pages_reviewed: number; assignments_analyzed: number }>;
}

export async function checkHealth() {
  try {
    const resp = await fetch(`${SERVER_URL}/health`);
    return resp.ok;
  } catch { return false; }
}
