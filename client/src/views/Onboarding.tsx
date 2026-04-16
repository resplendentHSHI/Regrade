import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PolicyModal } from "@/components/PolicyModal";
import { testLogin, fetchCourses } from "@/lib/sidecar";
import { saveCredentials } from "@/lib/store";
import { saveCourses, getSettings, saveSettings } from "@/lib/store";
import type { Course } from "@/lib/types";

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);

  // Step 1 state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [loginOk, setLoginOk] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Step 2 state
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [policyTarget, setPolicyTarget] = useState<Course | null>(null);
  const [finishing, setFinishing] = useState(false);

  async function handleTestLogin() {
    setTesting(true);
    setLoginError("");
    setLoginOk(false);
    try {
      const result = await testLogin(email, password);
      if (result.ok) {
        setLoginOk(true);
        await saveCredentials({ gsEmail: email, gsPassword: password });
        // Pre-fetch courses in background so step 2 loads instantly
        setLoadingCourses(true);
        fetchCourses(email, password)
          .then((raw) => {
            setCourses(
              raw.map((c) => ({
                id: c.id, name: c.name, semester: c.semester,
                year: c.year, enabled: false, policyAckAt: null,
              }))
            );
          })
          .catch(() => {})
          .finally(() => setLoadingCourses(false));
      } else {
        setLoginError(result.error || "Login failed. Check your credentials.");
      }
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Unexpected error during login test.");
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    // Only fetch if we don't already have courses (pre-fetched from login)
    if (step !== 2 || courses.length > 0) return;
    let cancelled = false;
    setLoadingCourses(true);
    setCourseError("");
    fetchCourses(email, password)
      .then((raw) => {
        if (cancelled) return;
        setCourses(
          raw.map((c) => ({
            id: c.id,
            name: c.name,
            semester: c.semester,
            year: c.year,
            enabled: false,
            policyAckAt: null,
          }))
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setCourseError(err instanceof Error ? err.message : "Failed to load courses.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCourses(false);
      });
    return () => { cancelled = true; };
  }, [step, email, password]);

  function toggleCourse(course: Course) {
    if (course.enabled) {
      setCourses((prev) =>
        prev.map((c) => (c.id === course.id ? { ...c, enabled: false, policyAckAt: null } : c))
      );
    } else {
      setPolicyTarget(course);
    }
  }

  function handlePolicyAccept() {
    if (!policyTarget) return;
    setCourses((prev) =>
      prev.map((c) =>
        c.id === policyTarget.id
          ? { ...c, enabled: true, policyAckAt: new Date().toISOString() }
          : c
      )
    );
    setPolicyTarget(null);
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      await saveCourses(courses);
      const settings = await getSettings();
      await saveSettings({ ...settings, onboardingComplete: true });
      onComplete();
    } catch {
      setFinishing(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step ? "w-8 bg-primary" : i < step ? "w-2 bg-primary/60" : "w-2 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Step 0: Data Transparency */}
        {step === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How your data is handled</CardTitle>
              <CardDescription>
                Transparency is important to us. Here is exactly what happens with your information.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4 text-sm text-muted-foreground">
                <li className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-primary">&#x1f512;</span>
                  <span>
                    Your Gradescope credentials are stored on your device only, in your operating
                    system's secure keychain. They are never sent to our servers.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-primary">&#x1f5d1;</span>
                  <span>
                    Your graded assignments are sent to our server for AI analysis. The PDF
                    is permanently deleted from our server immediately after processing completes.
                    We never retain your coursework.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-primary">&#x1f4cb;</span>
                  <span>
                    What we keep on our server: your email address, which courses you've enabled, and
                    aggregate stats (pages reviewed, points recovered). That's it.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-primary">&#x2709;</span>
                  <span>
                    Email notifications: We'll email you when we find an obvious grading error. You
                    can turn this off anytime.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-primary">&#x2705;</span>
                  <span>
                    You're always in control: Every regrade suggestion is a draft for you to review.
                    We never submit anything to Gradescope on your behalf.
                  </span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => setStep(1)}>I understand, continue</Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 1: Gradescope Credentials */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Connect Gradescope</CardTitle>
              <CardDescription>
                Enter your Gradescope credentials. They are stored securely on this device only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gs-email">Email</Label>
                <Input
                  id="gs-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setLoginOk(false); setLoginError(""); }}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gs-password">Password</Label>
                <Input
                  id="gs-password"
                  type="password"
                  placeholder="Your Gradescope password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setLoginOk(false); setLoginError(""); }}
                />
              </div>

              <Button
                variant="outline"
                onClick={handleTestLogin}
                disabled={testing || !email || !password}
                className="w-full"
              >
                {testing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Testing connection...
                  </span>
                ) : (
                  "Test Login"
                )}
              </Button>

              {loginOk && (
                <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Connected successfully!
                </p>
              )}
              {loginError && (
                <p className="text-sm text-destructive">{loginError}</p>
              )}
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button disabled={!loginOk} onClick={() => setStep(2)}>Continue</Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 2: Course Selection */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select your courses</CardTitle>
              <CardDescription>
                Choose which courses Poko should monitor for grading issues.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCourses && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Loading courses...
                </div>
              )}
              {courseError && (
                <p className="text-sm text-destructive py-4">{courseError}</p>
              )}
              {!loadingCourses && !courseError && courses.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">No courses found.</p>
              )}
              {!loadingCourses && courses.length > 0 && (
                <ul className="divide-y">
                  {courses.map((course) => (
                    <li key={course.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div>
                        <p className="text-sm font-medium">{course.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {course.semester} {course.year}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={course.enabled}
                        onClick={() => toggleCourse(course)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          course.enabled ? "bg-primary" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                            course.enabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleFinish} disabled={finishing}>
                {finishing ? "Saving..." : "Finish Setup"}
              </Button>
            </CardFooter>
          </Card>
        )}

        <PolicyModal
          courseName={policyTarget?.name ?? ""}
          open={!!policyTarget}
          onAccept={handlePolicyAccept}
          onCancel={() => setPolicyTarget(null)}
        />
      </div>
    </div>
  );
}
