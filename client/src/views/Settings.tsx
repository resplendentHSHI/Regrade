import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getCourses,
  saveCourses,
  getSettings,
  saveSettings,
  getCredentials,
  saveCredentials,
} from "@/lib/store";
import { signOut } from "@/lib/auth";
import type { Course } from "@/lib/types";

export function Settings() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [email, setEmail] = useState("");
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    getCourses().then(setCourses);
    getCredentials().then((c) => setEmail(c.gsEmail));
    getSettings().then((s) => setNotifications(s.notificationsEnabled));
  }, []);

  const toggleCourse = async (courseId: string) => {
    const updated = courses.map((c) =>
      c.id === courseId ? { ...c, enabled: !c.enabled } : c
    );
    setCourses(updated);
    await saveCourses(updated);
  };

  const toggleNotifications = async () => {
    const next = !notifications;
    setNotifications(next);
    const settings = await getSettings();
    await saveSettings({ ...settings, notificationsEnabled: next });
  };

  const handleSignOut = async () => {
    await saveCredentials({ gsEmail: "", gsPassword: "" });
    await saveSettings({ onboardingComplete: false, serverUrl: "http://localhost:8080", notificationsEnabled: true });
    await saveCourses([]);
    signOut();
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Courses */}
      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
          <CardDescription>Enable or disable courses for automated review.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses found.</p>
          ) : (
            courses.map((course) => (
              <div
                key={course.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium text-sm">{course.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {course.semester} {course.year}
                  </p>
                </div>
                <button
                  onClick={() => toggleCourse(course.id)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    course.enabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                      course.enabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            ))
          )}
          <Button variant="outline" size="sm" className="mt-3">
            Refresh Courses
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Gradescope */}
      <Card>
        <CardHeader>
          <CardTitle>Gradescope</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Connected as</p>
              <p className="text-sm font-medium">{email || "Not connected"}</p>
            </div>
            <Button variant="outline" size="sm">
              Update Credentials
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <p className="text-sm">Desktop notifications</p>
            <button
              onClick={toggleNotifications}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                notifications ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${
                  notifications ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Privacy */}
      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Poko downloads your graded PDFs and analyzes them locally using AI. Your
            submissions never leave your device unless you explicitly submit a regrade
            request through Gradescope.
          </p>
          <p>
            Credentials are stored locally in your app data directory and are never
            transmitted to any third-party server. The analysis server runs on your
            own infrastructure.
          </p>
          <p>
            You can delete all stored data at any time by signing out below.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleSignOut}>
            Sign Out
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            This will clear all stored data and return to the onboarding screen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
