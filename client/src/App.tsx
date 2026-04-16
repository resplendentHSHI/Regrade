import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./views/Onboarding";
import { Home } from "./views/Home";
import { Assignments } from "./views/Assignments";
import { AssignmentDetail } from "./views/AssignmentDetail";
import { Upcoming } from "./views/Upcoming";
import { Settings } from "./views/Settings";
import { getSettings, getCredentials, getHeartbeatState, getAssignments } from "./lib/store";
import { signIn } from "./lib/auth";
import { runHeartbeat, shouldRunHeartbeat } from "./lib/heartbeat";
import { pollJobResults } from "./lib/queue";

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((s) => setOnboarded(s.onboardingComplete));
  }, []);

  useEffect(() => {
    if (!onboarded) return;

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function init() {
      // Auto sign-in and store token
      const t = await signIn();
      setToken(t);

      // Check if heartbeat should run on start
      const state = await getHeartbeatState();
      if (shouldRunHeartbeat(state.lastRun)) {
        const creds = await getCredentials();
        if (creds.gsEmail && creds.gsPassword) {
          runHeartbeat(creds.gsEmail, creds.gsPassword, t).catch((err) =>
            console.error("Heartbeat error on start:", err)
          );
        }
      }

      // Check every 60 seconds if it's time to run heartbeat
      heartbeatInterval = setInterval(async () => {
        const s = await getHeartbeatState();
        if (shouldRunHeartbeat(s.lastRun)) {
          const creds = await getCredentials();
          if (creds.gsEmail && creds.gsPassword) {
            runHeartbeat(creds.gsEmail, creds.gsPassword, t).catch((err) =>
              console.error("Heartbeat interval error:", err)
            );
          }
        }
      }, 60_000);

      // Poll for in-flight job results every 30 seconds
      pollInterval = setInterval(async () => {
        const assignments = await getAssignments();
        const hasInFlight = assignments.some(
          (a) => a.jobId && (a.status === "uploading" || a.status === "analyzing")
        );
        if (hasInFlight) {
          pollJobResults(t).catch((err) =>
            console.error("Poll job results error:", err)
          );
        }
      }, 30_000);
    }

    init().catch((err) => console.error("App init error:", err));

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [onboarded]);

  if (onboarded === null) return null;

  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />;
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Home token={token} />} />
            <Route path="/assignments" element={<Assignments />} />
            <Route path="/assignments/:id" element={<AssignmentDetail />} />
            <Route path="/upcoming" element={<Upcoming />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
