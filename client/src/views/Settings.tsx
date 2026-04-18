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
} from "@/lib/store";
import { signOut, getStoredToken } from "@/lib/auth";
import * as api from "@/lib/api";
import type { Course } from "@/lib/types";

export function Settings() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [gsEmail, setGsEmail] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    getCourses().then(setCourses);
    getCredentials().then((c) => setGsEmail(c.gsEmail));
    getSettings().then((s) => setNotifications(s.notificationsEnabled));
    const token = getStoredToken();
    if (token) {
      api.getUserStats(token).then((s) => setGoogleEmail(s.email)).catch(() => {});
    }
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
    // Clear ALL local data — this backs up the privacy statement.
    const fs = await import("@tauri-apps/plugin-fs");
    const STORE_FILES = [
      "credentials.json",
      "courses.json",
      "assignments.json",
      "upcoming.json",
      "activity.json",
      "heartbeat.json",
      "settings.json",
      "pet.json",
      "tokens.json",
    ];
    for (const name of STORE_FILES) {
      try {
        await fs.remove(`poko/${name}`, { baseDir: fs.BaseDirectory.AppData });
      } catch { /* file may not exist */ }
    }
    // Also clear any downloaded PDFs
    try {
      await fs.remove("poko/pdfs", {
        baseDir: fs.BaseDirectory.AppData,
        recursive: true,
      });
    } catch { /* ignore */ }
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
              <p className="text-sm font-medium">{gsEmail || "Not connected"}</p>
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
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-heading text-lg">Privacy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            Poko downloads your graded PDFs from Gradescope and sends them to our
            server for AI analysis. The PDF is{" "}
            <span className="font-medium text-foreground">permanently deleted</span>{" "}
            from our server immediately after processing. We never retain your coursework.
          </p>
          <p>
            Your Gradescope credentials are stored locally on your device only and
            are never sent to our server. We only store your email, enabled courses,
            and aggregate stats (pages reviewed, points recovered) on our server.
          </p>
          <p>
            Your data is handled with the{" "}
            <a
              href="https://resend.com/security"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                import("@tauri-apps/plugin-opener").then((m) =>
                  m.openUrl("https://resend.com/security")
                );
              }}
            >
              same security posture
            </a>{" "}
            we use for notification email. Sign out (below) to delete everything
            stored on this device.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Terms of Use */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-heading text-lg">Terms of Use</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            <span className="font-medium text-foreground">Your course's policy comes first.</span>{" "}
            You confirmed this for each enabled course during setup. Poko is a
            grading-assistance tool, not a loophole — if your instructor or
            academic integrity office says don't use automated tools, don't.
          </p>
          <p>
            <span className="font-medium text-foreground">Regrade requests are your responsibility.</span>{" "}
            Poko drafts suggestions. You decide whether to send any of them.
            Please only submit requests you actually believe in, and be polite to
            your graders — they're usually students too.
          </p>
          <p>
            <span className="font-medium text-foreground">No warranty.</span>{" "}
            Poko is a small beta project. We make no guarantees about analysis
            accuracy, uptime, or that your server-side data is safe from total
            loss. Use it for what it is.
          </p>
          <p>
            <span className="font-medium text-foreground">No abuse.</span>{" "}
            Don't use Poko to spam graders, submit bad-faith regrades, or
            scrape Gradescope data you're not supposed to have access to.
            Accounts doing this may be cut off without notice.
          </p>
          <p className="text-xs italic pt-1 border-t border-border">
            Questions or disputes? Reach out via the Feedback link in the sidebar.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="text-sm font-medium">{googleEmail || "Unknown"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gradescope account</p>
            <p className="text-sm font-medium">{gsEmail || "Not connected"}</p>
          </div>
          <Separator />
          <Button variant="destructive" onClick={handleSignOut}>
            Sign Out
          </Button>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            Deletes everything Poko has stored on this device: your Gradescope
            credentials, downloaded PDFs, analysis results, activity log, and
            your pet. Your server-side account stays until you delete it there.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
