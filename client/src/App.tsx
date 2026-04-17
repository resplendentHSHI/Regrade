import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Onboarding } from "./views/Onboarding";
import { Home } from "./views/Home";
import { Assignments } from "./views/Assignments";
import { AssignmentDetail } from "./views/AssignmentDetail";
import { Queue } from "./views/Queue";
import { Upcoming } from "./views/Upcoming";
import { Settings } from "./views/Settings";
import { getSettings, getCredentials, getHeartbeatState, getAssignments } from "./lib/store";
import { signIn, getStoredToken } from "./lib/auth";
import { runHeartbeat, shouldRunHeartbeat } from "./lib/heartbeat";
import { pollJobResults, uploadPendingJobs, reconcileWithServer } from "./lib/queue";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { UpdateBanner } from "./components/UpdateBanner";
import { BetaBanner } from "./components/BetaBanner";

function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);

  async function handleSignIn() {
    setLoading(true);
    setError("");
    try {
      await signIn();
      onSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setAttempts((a) => a + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm rounded-3xl border-primary/20">
        <CardHeader className="text-center">
          <CardTitle className="font-heading text-3xl">Welcome to Poko</CardTitle>
          <p className="display-italic text-muted-foreground text-sm mt-1">
            your grade companion
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleSignIn} disabled={loading} className="w-full rounded-xl">
            {loading ? "Opening browser..." : attempts > 0 ? "Try Again" : "Sign in with Google"}
          </Button>
          {error && (
            <div className="text-xs text-destructive text-center px-2 leading-relaxed">
              {error}
            </div>
          )}
          {loading && (
            <p className="text-xs text-muted-foreground text-center">
              Complete the sign-in in your browser. You can close the tab after.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    getSettings().then((s) => setOnboarded(s.onboardingComplete));
  }, [token]);

  useEffect(() => {
    if (!onboarded || !token) return;

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let reconcileInterval: ReturnType<typeof setInterval> | null = null;

    async function init() {
      // Reconcile first — catches any state drift from previous session
      reconcileWithServer(token!).then((r) => {
        if (r.claimed || r.pulled || r.orphaned) {
          console.info(
            `Reconciled: claimed=${r.claimed} pulled=${r.pulled} orphaned=${r.orphaned}`
          );
        }
      }).catch((err) => console.warn("Reconcile failed:", err));

      const state = await getHeartbeatState();
      if (shouldRunHeartbeat(state.lastRun)) {
        const creds = await getCredentials();
        if (creds.gsEmail && creds.gsPassword) {
          runHeartbeat(creds.gsEmail, creds.gsPassword, token!).catch((err) =>
            console.error("Heartbeat error on start:", err)
          );
        }
      }

      heartbeatInterval = setInterval(async () => {
        const s = await getHeartbeatState();
        if (shouldRunHeartbeat(s.lastRun)) {
          const creds = await getCredentials();
          if (creds.gsEmail && creds.gsPassword) {
            runHeartbeat(creds.gsEmail, creds.gsPassword, token!).catch((err) =>
              console.error("Heartbeat interval error:", err)
            );
          }
        }
      }, 60_000);

      // Full reconcile every 2 minutes for safety net
      reconcileInterval = setInterval(() => {
        reconcileWithServer(token!).catch((err) =>
          console.warn("Periodic reconcile failed:", err)
        );
      }, 120_000);

      pollInterval = setInterval(async () => {
        const assignments = await getAssignments();
        // Retry any stuck pending uploads (e.g., previous attempts failed)
        const hasPending = assignments.some(
          (a) => a.status === "pending_upload" && a.pdfPath
        );
        if (hasPending) {
          uploadPendingJobs(token!).catch((err) =>
            console.error("Upload retry error:", err)
          );
        }
        const hasInFlight = assignments.some(
          (a) => a.jobId && (a.status === "uploading" || a.status === "analyzing")
        );
        if (hasInFlight) {
          pollJobResults(token!).catch((err) =>
            console.error("Poll job results error:", err)
          );
        }
      }, 30_000);
    }

    init().catch((err) => console.error("App init error:", err));

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (pollInterval) clearInterval(pollInterval);
      if (reconcileInterval) clearInterval(reconcileInterval);
    };
  }, [onboarded, token]);

  // Step 1: Sign in (skip if we already have a real token)
  if (!token) {
    return <SignInScreen onSignIn={() => setToken(getStoredToken())} />;
  }

  // Step 2: Loading settings
  if (onboarded === null) return null;

  // Step 3: Onboarding
  if (!onboarded) {
    return <Onboarding onComplete={() => setOnboarded(true)} />;
  }

  // Step 4: Dashboard
  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen">
        <UpdateBanner />
        <BetaBanner />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <Routes>
            <Route path="/" element={<Home token={token} />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/assignments" element={<Assignments />} />
            <Route path="/assignments/:id" element={<AssignmentDetail />} />
            <Route path="/upcoming" element={<Upcoming />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
