import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
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
  confidence?: string;
  pointsDisputed?: number;
  summary?: string;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-600 border-red-200",
  strong: "bg-amber-500/10 text-amber-600 border-amber-200",
  marginal: "bg-muted text-muted-foreground border-border",
};

export function AssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [courseName, setCourseName] = useState("");
  const [copied, setCopied] = useState(false);

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
    ? (() => { try { const parsed = JSON.parse(assignment.resultJson); return Array.isArray(parsed) ? parsed : parsed.issues || []; } catch { return []; } })()
    : [];

  const handleCopy = async () => {
    if (assignment.draftMd) {
      await navigator.clipboard.writeText(assignment.draftMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
              <iframe
                src={convertFileSrc(assignment.pdfPath)}
                className="w-full h-[600px] rounded-md border"
                title="Assignment PDF"
              />
            ) : (
              <div className="flex items-center justify-center h-48 rounded-md border border-dashed text-muted-foreground">
                PDF not available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Regrade draft */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Regrade Draft</CardTitle>
              {assignment.draftMd && (
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy to Clipboard"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {assignment.draftMd ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{assignment.draftMd}</Markdown>
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
              const confidence = issue.confidence?.toLowerCase() || "marginal";
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
                    {issue.summary && (
                      <p className="text-sm mt-0.5 opacity-80">{issue.summary}</p>
                    )}
                    {issue.category && (
                      <p className="text-xs mt-1 opacity-60">{issue.category}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {issue.pointsDisputed !== undefined && (
                      <span className="text-sm font-semibold tabular-nums">
                        {issue.pointsDisputed} pts
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
