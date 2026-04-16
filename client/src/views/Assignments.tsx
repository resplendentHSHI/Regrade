import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { getAssignments, getCourses } from "@/lib/store";
import type { Assignment, Course } from "@/lib/types";

export function Assignments() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    getAssignments().then(setAssignments);
    getCourses().then(setCourses);
  }, []);

  const courseMap = new Map(courses.map((c) => [c.id, c]));

  // Group assignments by courseId
  const grouped = assignments.reduce<Record<string, Assignment[]>>((acc, a) => {
    (acc[a.courseId] ||= []).push(a);
    return acc;
  }, {});

  // Sort each group newest first by dueDate
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
    });
  }

  const courseIds = Object.keys(grouped).sort((a, b) => {
    const nameA = courseMap.get(a)?.name || a;
    const nameB = courseMap.get(b)?.name || b;
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Assignments</h1>

      {courseIds.length === 0 ? (
        <p className="text-muted-foreground">No assignments found. Run a heartbeat scan to fetch your assignments.</p>
      ) : (
        courseIds.map((courseId) => {
          const course = courseMap.get(courseId);
          const items = grouped[courseId];
          const totalRecovered = items.reduce((s, a) => s + (a.pointsRecovered || 0), 0);

          return (
            <Card key={courseId}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{course?.name || courseId}</CardTitle>
                  {totalRecovered > 0 && (
                    <Badge variant="default">+{totalRecovered} pts recovered</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {items.map((a) => (
                  <button
                    key={`${a.courseId}_${a.assignmentId}`}
                    onClick={() => navigate(`/assignments/${a.courseId}_${a.assignmentId}`)}
                    className="w-full flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.name}</p>
                      {a.dueDate && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Due {new Date(a.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {a.score !== null && a.maxScore !== null && (
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {a.score}/{a.maxScore}
                        </span>
                      )}
                      {a.pointsRecovered !== undefined && a.pointsRecovered > 0 && (
                        <Badge variant="secondary">+{a.pointsRecovered}</Badge>
                      )}
                      <StatusBadge status={a.status} />
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
