import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  X,
  Plus,
  CheckCircle,
  AlertCircle,
  Clock,
  Inbox,
  PartyPopper,
} from "lucide-react";
import {
  getAssignments,
  saveAssignments,
  getCredentials,
  getCourses,
  removeAssignment,
} from "@/lib/store";
import { listGraded, fetchSpecific } from "@/lib/sidecar";
import { appDataDir } from "@tauri-apps/api/path";
import type { Assignment, Course } from "@/lib/types";

type GradedItem = {
  course_id: string;
  assignment_id: string;
  submission_id: string;
  name: string;
  score: number | null;
  max_score: number | null;
  due_date: string | null;
  type: string;
};

const ACTIVE_STATUSES = new Set(["pending_upload", "uploading", "analyzing"]);
const COMPLETED_STATUSES = new Set(["no_issues", "regrade_candidates", "failed", "complete"]);

function estimatedTime(status: string): string {
  if (status === "analyzing") return "~5-10 min";
  if (status === "uploading") return "< 1 min";
  if (status === "pending_upload") return "< 1 min";
  return "";
}

function ActiveIndicator({ status }: { status: string }) {
  if (status === "analyzing") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Analyzing
      </span>
    );
  }
  if (status === "uploading") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-violet-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Uploading
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      Pending
    </span>
  );
}

function CompletedIcon({ status }: { status: string }) {
  if (status === "regrade_candidates") {
    return <AlertCircle className="h-4 w-4 text-amber-500" />;
  }
  if (status === "failed") {
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  }
  return <CheckCircle className="h-4 w-4 text-emerald-500" />;
}

function completedLabel(status: string): string {
  if (status === "regrade_candidates") return "Regrade Candidates";
  if (status === "failed") return "Failed";
  if (status === "no_issues") return "No Issues";
  return "Reviewed";
}

/* ──────────────────── Manual Add Dialog ──────────────────── */
function AddAssignmentDialog({
  open,
  onOpenChange,
  onAdded,
  existingIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
  existingIds: Set<string>;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<GradedItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  // Fetch graded assignments when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const creds = await getCredentials();
        const courses = await getCourses();
        const enabledIds = courses.filter((c) => c.enabled).map((c) => c.id);
        if (enabledIds.length === 0) {
          setError("No courses enabled. Enable courses in Settings first.");
          setLoading(false);
          return;
        }
        const graded = await listGraded(creds.gsEmail, creds.gsPassword, enabledIds);
        if (!cancelled) {
          setItems(graded);
          setSelected(new Set());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load assignments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [open]);

  function toggleItem(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleAnalyze() {
    setSubmitting(true);
    setError("");
    try {
      const creds = await getCredentials();
      const courses = await getCourses();
      const courseMap = new Map(courses.map((c) => [c.id, c]));
      const dataDir = await appDataDir();

      const toFetch = items.filter((i) => selected.has(`${i.course_id}_${i.assignment_id}`));
      if (toFetch.length === 0) return;

      await fetchSpecific(creds.gsEmail, creds.gsPassword, toFetch, dataDir);

      // Add to store as pending_upload
      const existing = await getAssignments();
      const newItems: Assignment[] = toFetch
        .filter((i) => !existingIds.has(`${i.course_id}_${i.assignment_id}`))
        .map((i) => ({
          courseId: i.course_id,
          assignmentId: i.assignment_id,
          submissionId: i.submission_id,
          name: i.name,
          courseName: courseMap.get(i.course_id)?.name,
          score: i.score,
          maxScore: i.max_score,
          dueDate: i.due_date,
          type: i.type,
          status: "pending_upload" as const,
        }));

      await saveAssignments([...existing, ...newItems]);
      onAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch assignments");
    } finally {
      setSubmitting(false);
    }
  }

  // Group by course
  const grouped = items.reduce<Record<string, GradedItem[]>>((acc, i) => {
    (acc[i.course_id] ||= []).push(i);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Assignments</DialogTitle>
          <DialogDescription>
            Select graded assignments to analyze for regrade opportunities.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading assignments...</span>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No graded assignments found.</p>
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[50vh] -mx-6 px-6">
              <div className="space-y-4 pb-2">
                {Object.entries(grouped).map(([courseId, courseItems]) => (
                  <div key={courseId}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      {courseItems[0]?.name ? courseId : courseId}
                    </p>
                    <div className="space-y-1">
                      {courseItems.map((item) => {
                        const key = `${item.course_id}_${item.assignment_id}`;
                        const alreadyExists = existingIds.has(key);
                        const isSelected = selected.has(key);

                        return (
                          <button
                            key={key}
                            disabled={alreadyExists}
                            onClick={() => toggleItem(key)}
                            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                              alreadyExists
                                ? "opacity-50 cursor-not-allowed bg-muted/30"
                                : isSelected
                                  ? "bg-primary/10 ring-1 ring-primary/30"
                                  : "hover:bg-muted/50"
                            }`}
                          >
                            <div
                              className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                                alreadyExists
                                  ? "bg-muted border-muted-foreground/30"
                                  : isSelected
                                    ? "bg-primary border-primary"
                                    : "border-muted-foreground/40"
                              }`}
                            >
                              {(isSelected || alreadyExists) && (
                                <CheckCircle className="h-3 w-3 text-primary-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{item.name}</p>
                              {item.due_date && (
                                <p className="text-xs text-muted-foreground">
                                  Due{" "}
                                  {new Date(item.due_date).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </p>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                              {item.score !== null && item.max_score !== null
                                ? `${item.score}/${item.max_score}`
                                : "—"}
                            </div>
                            {alreadyExists && (
                              <Badge variant="outline" className="text-xs shrink-0">
                                Already added
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Separator />

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                {selected.size} selected
              </p>
              <Button
                onClick={handleAnalyze}
                disabled={selected.size === 0 || submitting}
                size="sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Downloading...
                  </>
                ) : (
                  <>Analyze Selected</>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────── Queue View ──────────────────── */
export function Queue() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [courseFilter, setCourseFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([getAssignments(), getCourses()]);
    setAssignments(a);
    setCourses(c);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, [load]);

  const courseMap = new Map(courses.map((c) => [c.id, c]));

  const filtered = courseFilter === "all"
    ? assignments
    : assignments.filter((a) => a.courseId === courseFilter);

  const activeItems = filtered.filter((a) => ACTIVE_STATUSES.has(a.status));
  const completedItems = filtered.filter((a) => COMPLETED_STATUSES.has(a.status));

  // Group completed by course
  const completedGrouped = completedItems.reduce<Record<string, Assignment[]>>((acc, a) => {
    (acc[a.courseId] ||= []).push(a);
    return acc;
  }, {});

  const existingIds = new Set(assignments.map((a) => `${a.courseId}_${a.assignmentId}`));

  async function handleRemove(courseId: string, assignmentId: string) {
    await removeAssignment(courseId, assignmentId);
    await load();
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your analysis pipeline and manage assignments
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Add Assignment
        </Button>
      </div>

      {/* Course filter chips */}
      {courses.filter((c) => c.enabled).length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCourseFilter("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              courseFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            All
          </button>
          {courses.filter((c) => c.enabled).map((c) => (
            <button
              key={c.id}
              onClick={() => setCourseFilter(c.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                courseFilter === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Active Queue */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Active Queue
        </h2>
        {activeItems.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Inbox className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No items in queue</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Add assignments to start analyzing
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {activeItems.map((a) => {
              const courseName = a.courseName || courseMap.get(a.courseId)?.name || a.courseId;
              return (
                <Card
                  key={`${a.courseId}_${a.assignmentId}`}
                  className="group relative overflow-hidden"
                >
                  {/* Animated progress accent */}
                  {a.status === "analyzing" && (
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500 animate-pulse" />
                  )}
                  {a.status === "uploading" && (
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-violet-500 animate-pulse" />
                  )}
                  <CardContent className="flex items-center gap-4 py-3.5">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{courseName}</span>
                        {a.score !== null && a.maxScore !== null && (
                          <>
                            <span className="text-muted-foreground/30">·</span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {a.score}/{a.maxScore}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <ActiveIndicator status={a.status} />
                      <span className="text-xs text-muted-foreground/60 tabular-nums w-16 text-right">
                        {estimatedTime(a.status)}
                      </span>
                      <button
                        onClick={() => handleRemove(a.courseId, a.assignmentId)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
                        title="Remove from queue"
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Separator />

      {/* Completed */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Completed
        </h2>
        {completedItems.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <PartyPopper className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">All caught up!</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Completed analyses will appear here
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(completedGrouped)
              .sort(([a], [b]) => {
                const nameA = courseMap.get(a)?.name || a;
                const nameB = courseMap.get(b)?.name || b;
                return nameA.localeCompare(nameB);
              })
              .map(([courseId, items]) => {
                const courseName = courseMap.get(courseId)?.name || courseId;
                return (
                  <Card key={courseId}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">{courseName}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {items.map((a) => {
                        const isRegrade = a.status === "regrade_candidates";
                        const isFailed = a.status === "failed";

                        return (
                          <div
                            key={`${a.courseId}_${a.assignmentId}`}
                            className={`group/item flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                              isRegrade
                                ? "bg-amber-500/5 hover:bg-amber-500/10"
                                : isFailed
                                  ? "bg-destructive/5 hover:bg-destructive/10"
                                  : "hover:bg-muted/50"
                            }`}
                          >
                            <button
                              onClick={() =>
                                navigate(`/assignments/${a.courseId}_${a.assignmentId}`)
                              }
                              className="flex items-center gap-3 flex-1 min-w-0 text-left"
                            >
                              <CompletedIcon status={a.status} />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate text-sm">{a.name}</p>
                                {a.dueDate && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Due{" "}
                                    {new Date(a.dueDate).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {a.score !== null && a.maxScore !== null && (
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {a.score}/{a.maxScore}
                                  </span>
                                )}
                                {a.pointsRecovered !== undefined && a.pointsRecovered > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    +{a.pointsRecovered} pts
                                  </Badge>
                                )}
                                <Badge
                                  variant={
                                    isRegrade
                                      ? "default"
                                      : isFailed
                                        ? "destructive"
                                        : "outline"
                                  }
                                  className={isRegrade ? "bg-amber-500 text-white" : ""}
                                >
                                  {completedLabel(a.status)}
                                </Badge>
                              </div>
                            </button>
                            <button
                              onClick={() => handleRemove(a.courseId, a.assignmentId)}
                              className="opacity-0 group-hover/item:opacity-100 p-1 rounded hover:bg-muted transition-all shrink-0"
                              title="Remove from history"
                            >
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </section>

      {/* Manual Add Dialog */}
      <AddAssignmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={load}
        existingIds={existingIds}
      />
    </div>
  );
}
