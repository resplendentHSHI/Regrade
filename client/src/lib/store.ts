import { BaseDirectory, mkdir, readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import type { Assignment, Course, ActivityEntry, HeartbeatState, UpcomingAssignment } from "./types";
import type { Pet } from "./pet";

const STORE_DIR = "poko";

async function ensureDir() {
  const dirExists = await exists(STORE_DIR, { baseDir: BaseDirectory.AppData });
  if (!dirExists) {
    await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const text = await readTextFile(`${STORE_DIR}/${filename}`, { baseDir: BaseDirectory.AppData });
    return JSON.parse(text) as T;
  } catch { return fallback; }
}

async function writeJson(filename: string, data: unknown): Promise<void> {
  await ensureDir();
  await writeTextFile(`${STORE_DIR}/${filename}`, JSON.stringify(data, null, 2), { baseDir: BaseDirectory.AppData });
}

export const getCourses = () => readJson<Course[]>("courses.json", []);
export const saveCourses = (courses: Course[]) => writeJson("courses.json", courses);
export const getAssignments = () => readJson<Assignment[]>("assignments.json", []);
export const saveAssignments = (items: Assignment[]) => writeJson("assignments.json", items);
export const getUpcoming = () => readJson<UpcomingAssignment[]>("upcoming.json", []);
export const saveUpcoming = (items: UpcomingAssignment[]) => writeJson("upcoming.json", items);

export async function addActivity(message: string, type: "info" | "success" | "warning" = "info") {
  const entries = await readJson<ActivityEntry[]>("activity.json", []);
  entries.unshift({ timestamp: new Date().toISOString(), message, type });
  if (entries.length > 100) entries.length = 100;
  await writeJson("activity.json", entries);
}
export const getActivity = () => readJson<ActivityEntry[]>("activity.json", []);

export const getHeartbeatState = () => readJson<HeartbeatState>("heartbeat.json", {
  lastRun: null, nextScheduled: null, status: "idle" as const, queueDepth: 0,
});
export const saveHeartbeatState = (state: HeartbeatState) => writeJson("heartbeat.json", state);

interface Settings {
  onboardingComplete: boolean;
  serverUrl: string;
  notificationsEnabled: boolean;
}
export const getSettings = () => readJson<Settings>("settings.json", {
  onboardingComplete: false, serverUrl: "http://localhost:8080", notificationsEnabled: true,
});
export const saveSettings = (s: Settings) => writeJson("settings.json", s);

export async function removeAssignment(courseId: string, assignmentId: string) {
  const items = await getAssignments();
  const filtered = items.filter(
    (a) => !(a.courseId === courseId && a.assignmentId === assignmentId)
  );
  await saveAssignments(filtered);
}

interface Credentials { gsEmail: string; gsPassword: string; }
export const getCredentials = () => readJson<Credentials>("credentials.json", { gsEmail: "", gsPassword: "" });
export const saveCredentials = (c: Credentials) => writeJson("credentials.json", c);

// ── Pet companion ─────────────────────────────────────────────────────────
export const getPet = () => readJson<Pet | null>("pet.json", null);
export const savePet = (pet: Pet) => writeJson("pet.json", pet);
