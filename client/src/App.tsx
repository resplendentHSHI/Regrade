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
import { signIn, getStoredToken } from "./lib/auth";
import { runHeartbeat, shouldRunHeartbeat } from "./lib/heartbeat";
import { pollJobResults } from "./lib/queue";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setLoading(true);
    setError("");
    try {
      await signIn();
      onSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Poko</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">
            Your intelligent grading assistant
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleSignIn} disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in with Google"}
          </Button>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
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

    async function init() {
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

      pollInterval = setInterval(async () => {
        const assignments = await getAssignments();
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
    };
  }, [onboarded, token]);

  // Step 1: Sign in
  if (!token || token === "dev-token-placeholder") {
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
