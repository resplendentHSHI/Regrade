import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getUpcoming, getCourses } from "@/lib/store";
import type { UpcomingAssignment, Course } from "@/lib/types";

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  const formatted = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (days < 0) return `${formatted} (past due)`;
  if (days === 0) return `${formatted} (today)`;
  if (days === 1) return `${formatted} (tomorrow)`;
  if (days <= 7) return `${formatted} (${days} days)`;
  return formatted;
}

export function Upcoming() {
  const [upcoming, setUpcoming] = useState<UpcomingAssignment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    getUpcoming().then(setUpcoming);
    getCourses().then(setCourses);
  }, []);

  const courseMap = new Map(courses.map((c) => [c.id, c]));

  const sorted = [...upcoming].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Upcoming</h1>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground">
          No upcoming assignments found. Run a heartbeat scan to check.
        </p>
      ) : (
        <Card>
          <CardContent className="space-y-1">
            {sorted.map((a) => {
              const course = courseMap.get(a.courseId);
              return (
                <div
                  key={`${a.courseId}_${a.assignmentId}`}
                  className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {course?.name || a.courseName || a.courseId}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm text-muted-foreground">
                      {formatDueDate(a.dueDate)}
                    </span>
                    <Badge variant="outline">{a.type}</Badge>
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
