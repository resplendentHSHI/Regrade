import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { getHeartbeatState, getActivity, getAssignments, getCredentials } from "@/lib/store";
import { runHeartbeat } from "@/lib/heartbeat";
import * as api from "@/lib/api";
import type { HeartbeatState, ActivityEntry, Assignment } from "@/lib/types";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatScheduledTime(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  const diff = date.getTime() - Date.now();
  if (diff < 0) return "Overdue";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `In ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `In ${hours}h`;
}

interface HomeProps {
  token: string | null;
}

export function Home({ token }: HomeProps) {
  const [heartbeat, setHeartbeat] = useState<HeartbeatState | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [stats, setStats] = useState({ pointsRecovered: 0, pagesReviewed: 0, assignmentsAnalyzed: 0 });
  const [liveQueueDepth, setLiveQueueDepth] = useState(0);
  const [serverOffline, setServerOffline] = useState(false);

  // Derive from the persisted heartbeat status so the button state survives
  // tab switches and component unmounts. A purely-local useState would reset
  // to false when the user navigates away, even if the scan is still going.
  const isRunning = heartbeat?.status === "running";

  async function loadLocalStats() {
    const assignments = await getAssignments();
    const pointsRecovered = assignments.reduce((sum: number, a: Assignment) => sum + (a.pointsRecovered || 0), 0);
    const pagesReviewed = assignments.filter((a: Assignment) => a.pdfPath).length;
    const assignmentsAnalyzed = assignments.filter((a: Assignment) =>
      ["complete", "no_issues", "regrade_candidates"].includes(a.status)
    ).length;
    setStats({ pointsRecovered, pagesReviewed, assignmentsAnalyzed });
  }

  async function loadQueueDepth() {
    const assignments = await getAssignments();
    const depth = assignments.filter((a: Assignment) =>
      ["pending_upload", "uploading", "analyzing"].includes(a.status)
    ).length;
    setLiveQueueDepth(depth);
  }

  async function loadData() {
    getHeartbeatState().then(setHeartbeat);
    getActivity().then((a) => setActivity(a.slice(0, 20)));
    loadQueueDepth();

    if (token) {
      try {
        const serverStats = await api.getUserStats(token);
        setStats({
          pointsRecovered: serverStats.points_recovered,
          pagesReviewed: serverStats.pages_reviewed,
          assignmentsAnalyzed: serverStats.assignments_analyzed,
        });
        setServerOffline(false);
        return;
      } catch {
        setServerOffline(true);
      }
    }
    // Fallback to local stats
    await loadLocalStats();
  }

  useEffect(() => {
    loadData();
    // Poll faster while a heartbeat is running so button/queue updates feel
    // snappy; relax once idle.
    const intervalMs = isRunning ? 2_000 : 10_000;
    const interval = setInterval(loadData, intervalMs);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isRunning]);

  async function handleRunNow() {
    // Guard: if a scan is already in progress (this tab or any other view),
    // don't start a second one. The persisted heartbeat status is the
    // source of truth.
    if (isRunning) return;

    const creds = await getCredentials();
    if (!creds.gsEmail || !creds.gsPassword) {
      console.warn("Run Now: no Gradescope credentials saved");
      return;
    }
    const t = token ?? "";

    // Fire-and-forget: runHeartbeat writes status="running" to storage
    // immediately, which the polling loop will pick up and flip the UI.
    // We don't await the whole run — that let the UI state fall out of
    // sync with actual progress when the user navigated away.
    runHeartbeat(creds.gsEmail, creds.gsPassword, t).catch((err) =>
      console.error("Run now error:", err)
    );

    // Refresh eagerly so the "Running…" state appears within ~300ms
    // rather than waiting for the next 2s poll tick.
    setTimeout(loadData, 300);
    setTimeout(loadData, 1200);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      {/* Hero stat */}
      <Card className="relative overflow-hidden rounded-3xl border-primary/20">
        <div
          className="absolute inset-0 pointer-events-none opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 500px 250px at 50% 0%, oklch(0.92 0.06 10 / 0.6), transparent 70%)",
          }}
        />
        <CardContent className="pt-4 pb-6 text-center relative">
          <p className="text-[11px] font-medium text-muted-foreground tracking-[0.2em] uppercase">
            Points Recovered
          </p>
          <p
            className="font-heading mt-3 leading-none tabular-nums"
            style={{ fontSize: "6rem", fontWeight: 500, letterSpacing: "-0.03em" }}
          >
            {stats.pointsRecovered}
          </p>
          <p className="display-italic text-sm text-muted-foreground mt-3">
            across all your courses
          </p>
          {serverOffline && (
            <p className="text-xs text-muted-foreground/70 mt-2">· server offline ·</p>
          )}
        </CardContent>
      </Card>

      {/* Supporting stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card size="sm" className="rounded-2xl border-secondary/40">
          <CardContent className="text-center py-4">
            <p className="text-3xl font-heading font-medium tabular-nums">{stats.pagesReviewed}</p>
            <p className="text-xs text-muted-foreground tracking-wide mt-1">pages reviewed</p>
          </CardContent>
        </Card>
        <Card size="sm" className="rounded-2xl border-accent/50">
          <CardContent className="text-center py-4">
            <p className="text-3xl font-heading font-medium tabular-nums">{stats.assignmentsAnalyzed}</p>
            <p className="text-xs text-muted-foreground tracking-wide mt-1">assignments analyzed</p>
          </CardContent>
        </Card>
      </div>

      {/* Heartbeat status */}
      {heartbeat && (
        <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                heartbeat.status === "running"
                  ? "bg-green-500 animate-pulse"
                  : heartbeat.status === "error"
                    ? "bg-red-500"
                    : "bg-muted-foreground/40"
              }`}
            />
            <span>
              Last run: {formatRelativeTime(heartbeat.lastRun)}
            </span>
          </div>
          <span>Next: {formatScheduledTime(heartbeat.nextScheduled)}</span>
          {liveQueueDepth > 0 && (
            <Badge variant="secondary">{liveQueueDepth} in queue</Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunNow}
            disabled={isRunning}
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Running…
              </span>
            ) : (
              "Run Now"
            )}
          </Button>
        </div>
      )}

      <Separator />

      {/* Recent activity */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4 tracking-wide uppercase">Recent Activity</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet. Run a heartbeat scan to get started.</p>
        ) : (
          <div className="space-y-2">
            {activity.map((entry, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                    entry.type === "success"
                      ? "bg-green-500"
                      : entry.type === "warning"
                        ? "bg-amber-500"
                        : "bg-muted-foreground/40"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground">{entry.message}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(entry.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
