import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { getAssignments, getCourses } from "@/lib/store";
import type { Assignment, Course } from "@/lib/types";

interface IssueEntry {
  question?: string;
  category?: string;
  confidence_tier?: string;
  points_disputed?: number;
  reasoning?: string;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-600 border-red-200",
  strong: "bg-amber-500/10 text-amber-600 border-amber-200",
  marginal: "bg-muted text-muted-foreground border-border",
};

function parseDraftSections(draft: string): Array<{ title: string; body: string; raw: string }> {
  const sections: Array<{ title: string; body: string; raw: string }> = [];
  const parts = draft.split(/(?=^## )/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Skip the top-level H1 header (starts with "# " but not "## ")
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

export function AssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [courseName, setCourseName] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

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
        <Button variant="ghost" onClick={() => navigate("/assignments")} className="mt-4">
          Back to Assignments
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

  const draftSections = assignment.draftMd ? parseDraftSections(assignment.draftMd) : [];

  const handleCopySection = async (raw: string, idx: number) => {
    await navigator.clipboard.writeText(raw);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Back navigation */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/assignments")}>
        &larr; Back
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{assignment.name}</h1>
          <p className="text-muted-foreground mt-1">{courseName}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {assignment.score !== null && assignment.maxScore !== null && (
            <span className="text-lg font-semibold tabular-nums">
              {assignment.score}/{assignment.maxScore}
            </span>
          )}
          <StatusBadge status={assignment.status} />
        </div>
      </div>

      <Separator />

      {/* Split layout: PDF + Draft */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        {/* Left: PDF viewer */}
        <Card>
          <CardHeader>
            <CardTitle>Submission PDF</CardTitle>
          </CardHeader>
          <CardContent>
            {assignment.pdfPath ? (
              <div className="space-y-3">
                <object
                  data={convertFileSrc(assignment.pdfPath)}
                  type="application/pdf"
                  className="w-full h-[600px] rounded-md border"
                >
                  <div className="flex flex-col items-center justify-center h-48 rounded-md border border-dashed text-muted-foreground gap-2">
                    <p>PDF preview not available in this view</p>
                    <a
                      href={convertFileSrc(assignment.pdfPath)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline text-sm"
                    >
                      Open PDF
                    </a>
                  </div>
                </object>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 rounded-md border border-dashed text-muted-foreground">
                PDF not available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Regrade draft — per-question cards */}
        <Card>
          <CardHeader>
            <CardTitle>Regrade Draft</CardTitle>
          </CardHeader>
          <CardContent>
            {draftSections.length > 0 ? (
              <div className="space-y-3">
                {draftSections.map((section, i) => (
                  <Card key={i} className="border-l-4 border-l-amber-400">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-sm">{section.title}</h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopySection(section.raw, i)}
                        >
                          {copiedIdx === i ? "Copied!" : "Copy"}
                        </Button>
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {section.body}
                        </Markdown>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : assignment.draftMd ? (
              /* Fallback: draft exists but no ## sections parsed — render as plain markdown */
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {assignment.draftMd}
                </Markdown>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 rounded-md border border-dashed text-muted-foreground">
                No regrade draft
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Issue breakdown */}
      {issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Issue Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {issues.map((issue, i) => {
              const confidence = issue.confidence_tier?.toLowerCase() || "marginal";
              const styles = CONFIDENCE_STYLES[confidence] || CONFIDENCE_STYLES.marginal;
              return (
                <div
                  key={i}
                  className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${styles}`}
                >
                  <div className="flex-1 min-w-0">
                    {issue.question && (
                      <p className="font-medium text-sm">{issue.question}</p>
                    )}
                    {issue.reasoning && (
                      <p className="text-sm mt-0.5 opacity-80">{issue.reasoning}</p>
                    )}
                    {issue.category && (
                      <p className="text-xs mt-1 opacity-60">{issue.category}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {issue.points_disputed !== undefined && (
                      <span className="text-sm font-semibold tabular-nums">
                        {issue.points_disputed} pts
                      </span>
                    )}
                    <Badge variant="outline" className="capitalize text-xs">
                      {confidence}
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
