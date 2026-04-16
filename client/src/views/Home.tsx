import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getHeartbeatState, getActivity, getAssignments } from "@/lib/store";
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

export function Home() {
  const [heartbeat, setHeartbeat] = useState<HeartbeatState | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [stats, setStats] = useState({ pointsRecovered: 0, pagesReviewed: 0, assignmentsAnalyzed: 0 });

  useEffect(() => {
    getHeartbeatState().then(setHeartbeat);
    getActivity().then((a) => setActivity(a.slice(0, 20)));
    getAssignments().then((assignments: Assignment[]) => {
      const pointsRecovered = assignments.reduce((sum, a) => sum + (a.pointsRecovered || 0), 0);
      const pagesReviewed = assignments.filter((a) => a.pdfPath).length;
      const assignmentsAnalyzed = assignments.filter((a) =>
        ["complete", "no_issues", "regrade_candidates"].includes(a.status)
      ).length;
      setStats({ pointsRecovered, pagesReviewed, assignmentsAnalyzed });
    });
  }, []);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      {/* Hero stat */}
      <Card>
        <CardContent className="pt-2 pb-2 text-center">
          <p className="text-sm font-medium text-muted-foreground tracking-wide uppercase">Points Recovered</p>
          <p className="text-6xl font-bold tracking-tight mt-2">{stats.pointsRecovered}</p>
          <p className="text-sm text-muted-foreground mt-2">across all your courses</p>
        </CardContent>
      </Card>

      {/* Supporting stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card size="sm">
          <CardContent className="text-center">
            <p className="text-3xl font-semibold">{stats.pagesReviewed}</p>
            <p className="text-sm text-muted-foreground">Pages Reviewed</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="text-center">
            <p className="text-3xl font-semibold">{stats.assignmentsAnalyzed}</p>
            <p className="text-sm text-muted-foreground">Assignments Analyzed</p>
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
          {heartbeat.queueDepth > 0 && (
            <Badge variant="secondary">{heartbeat.queueDepth} in queue</Badge>
          )}
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
