import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { getAssignments, getCourses } from "@/lib/store";
import type { Assignment, Course } from "@/lib/types";
import { FileText, ExternalLink, Copy, Check } from "lucide-react";

interface IssueEntry {
  question?: string;
  category?: string;
  confidence_tier?: string;
  points_disputed?: number;
  reasoning?: string;
}

const TIER_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-600 border-red-200 dark:border-red-900",
  strong: "bg-amber-500/10 text-amber-700 border-amber-200 dark:border-amber-900",
  marginal: "bg-muted text-muted-foreground border-border",
};

const TIER_LABEL: Record<string, string> = {
  critical: "Likely regrade",
  strong: "Possible regrade",
  marginal: "Maybe worth reviewing",
};

function parseDraftSections(
  draft: string
): Array<{ title: string; body: string; raw: string }> {
  const sections: Array<{ title: string; body: string; raw: string }> = [];
  const parts = draft.split(/(?=^## )/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) continue;
    if (!trimmed.startsWith("## ")) continue;
    const firstNewline = trimmed.indexOf("\n");
    const title =
      firstNewline > 0
        ? trimmed.slice(3, firstNewline).trim()
        : trimmed.slice(3).trim();
    const body = firstNewline > 0 ? trimmed.slice(firstNewline + 1).trim() : "";
    sections.push({ title, body, raw: trimmed });
  }
  return sections;
}

/** Extract just the regrade message (what the user should paste) from a section body. */
function extractRegradeText(body: string): string {
  // Keep the body as-is but strip the horizontal rule at the end and the
  // "Requesting regrade for:" header since that's context, not message.
  return body
    .replace(/---\s*$/, "")
    .trim();
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="gap-1.5 rounded-full"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" /> {label}
        </>
      )}
    </Button>
  );
}

export function AssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [courseName, setCourseName] = useState("");

  useEffect(() => {
    if (!id) return;
    const [courseId, assignmentId] = id.split("_");

    Promise.all([getAssignments(), getCourses()]).then(([assignments, courses]) => {
      const match = assignments.find(
        (a: Assignment) => a.courseId === courseId && a.assignmentId === assignmentId
      );
      setAssignment(match || null);
      const course = courses.find((c: Course) => c.id === courseId);
      setCourseName(course?.name || courseId);
    });
  }, [id]);

  if (!assignment) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Assignment not found.</p>
        <Button variant="ghost" onClick={() => navigate("/queue")} className="mt-4">
          Back to Queue
        </Button>
      </div>
    );
  }

  const issues: IssueEntry[] = assignment.resultJson
    ? (() => {
        try {
          const parsed = JSON.parse(assignment.resultJson);
          return Array.isArray(parsed) ? parsed : parsed.issues || [];
        } catch {
          return [];
        }
      })()
    : [];

  const keptIssues = issues.filter(
    (i) => (i as { keep?: boolean }).keep !== false
  );
  const draftSections = assignment.draftMd ? parseDraftSections(assignment.draftMd) : [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Back navigation */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/queue")}>
        &larr; Back to Queue
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl">{assignment.name}</h1>
          <p className="display-italic text-muted-foreground mt-1">{courseName}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {assignment.score !== null && assignment.maxScore !== null && (
            <span className="font-heading text-2xl tabular-nums">
              {assignment.score}
              <span className="text-muted-foreground/60 text-base">/{assignment.maxScore}</span>
            </span>
          )}
          <StatusBadge status={assignment.status} resultJson={assignment.resultJson} />
        </div>
      </div>

      <Separator />

      {/* Split layout: PDF + Drafts */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        {/* Left: PDF viewer */}
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="font-heading text-lg">Submission PDF</CardTitle>
            {assignment.pdfPath && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={async () => {
                  try {
                    await openPath(assignment.pdfPath!);
                  } catch {
                    await openUrl(convertFileSrc(assignment.pdfPath!));
                  }
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {assignment.pdfPath ? (
              <iframe
                src={convertFileSrc(assignment.pdfPath)}
                className="w-full h-[640px] rounded-xl border bg-muted/20"
                title="Assignment PDF"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-48 rounded-xl border border-dashed text-muted-foreground gap-2">
                <FileText className="h-6 w-6 opacity-40" />
                <p className="text-sm">PDF not available</p>
              </div>
            )}
            {assignment.pdfPath && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                If the preview doesn't load, tap <span className="font-medium">Open</span> to view in your default PDF app.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Right: Regrade drafts */}
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-lg">Regrade Drafts</h2>
            {draftSections.length > 0 && assignment.draftMd && (
              <CopyButton text={assignment.draftMd} label="Copy all" />
            )}
          </div>

          {draftSections.length > 0 ? (
            draftSections.map((section, i) => {
              const issue = keptIssues[i];
              const tier = issue?.confidence_tier || "marginal";
              const tierColor =
                tier === "critical"
                  ? "border-l-red-400"
                  : tier === "strong"
                    ? "border-l-amber-400"
                    : "border-l-muted-foreground/30";
              const regradeText = extractRegradeText(section.body);
              return (
                <Card key={i} className={`rounded-2xl border-l-4 ${tierColor}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm">{section.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {TIER_LABEL[tier] || tier}
                          {issue?.points_disputed !== undefined
                            ? ` · ${issue.points_disputed} pts`
                            : ""}
                        </p>
                      </div>
                      <CopyButton text={regradeText} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed bg-muted/30 rounded-xl p-3">
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {regradeText}
                      </Markdown>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : assignment.draftMd ? (
            <Card className="rounded-2xl">
              <CardHeader className="flex-row items-center justify-between pb-2 space-y-0">
                <h3 className="font-medium text-sm">Draft</h3>
                <CopyButton text={assignment.draftMd} />
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed">
                  <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {assignment.draftMd}
                  </Markdown>
                </div>
              </CardContent>
            </Card>
          ) : assignment.status === "no_issues" ? (
            <Card className="rounded-2xl">
              <CardContent className="py-10 text-center">
                <Check className="h-8 w-8 mx-auto mb-2 text-emerald-500/70" />
                <p className="text-sm font-medium">No issues found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Grading looks fair on this one.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No regrade draft yet.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Issue breakdown */}
      {keptIssues.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-heading text-lg">What Poko noticed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {keptIssues.map((issue, i) => {
              const tier = issue.confidence_tier?.toLowerCase() || "marginal";
              const styles = TIER_STYLES[tier] || TIER_STYLES.marginal;
              return (
                <div
                  key={i}
                  className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${styles}`}
                >
                  <div className="flex-1 min-w-0">
                    {issue.question && (
                      <p className="font-medium text-sm">{issue.question}</p>
                    )}
                    {issue.reasoning && (
                      <p className="text-sm mt-1 opacity-80 leading-snug">
                        {issue.reasoning}
                      </p>
                    )}
                    {issue.category && (
                      <p className="text-[11px] mt-1.5 opacity-60 uppercase tracking-wide">
                        {issue.category.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {issue.points_disputed !== undefined && (
                      <span className="text-sm font-semibold tabular-nums">
                        +{issue.points_disputed} pts
                      </span>
                    )}
                    <Badge variant="outline" className="capitalize text-[10px] rounded-full">
                      {tier}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
