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
import { saveCredentials, getCredentials } from "@/lib/store";
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

  // On mount: if the user has already saved Gradescope credentials in a
  // previous session (or earlier in this one and then came back via Back),
  // trust them — skip the re-entry form and show a "connected" confirmation.
  useEffect(() => {
    getCredentials().then((c) => {
      if (c.gsEmail && c.gsPassword) {
        setEmail(c.gsEmail);
        setPassword(c.gsPassword);
        setLoginOk(true);
      }
    });
  }, []);

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
    if (step !== 6 || courses.length > 0) return;
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
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === step ? "w-8 bg-primary" : i < step ? "w-2 bg-primary/60" : "w-2 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Step 0 · Brief 1/3 — Friends-only */}
        {step === 0 && (
          <Card key="brief-1" className="relative overflow-hidden rounded-3xl border-border/70">
            <div className="pointer-events-none absolute top-3 right-4 brief-index brief-glide" aria-hidden="true">
              fig. 01 — brief · 1 of 3
            </div>
            <CardHeader className="relative pb-3">
              <div className="brief-glide space-y-2">
                <span className="brief-index">§ pricing</span>
                <div className="h-px bg-border brief-tick" />
                <CardTitle className="font-heading text-2xl tracking-tight leading-tight">
                  Friends-only for now.
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="relative pt-0 text-sm leading-relaxed">
              <p className="brief-glide brief-delay-2 text-muted-foreground brief-nums">
                Each assignment runs through a custom-built workflow I've put
                real work into — handcrafted prompts, multi-stage reasoning, and
                the top Claude model on every exam — which costs me about $1.20
                per analysis and works out to roughly{" "}
                <span className="text-foreground font-medium">$30–50/user/month</span>{" "}
                during the school year, plus a ~$25 one-time backfill when you
                sign up. It's on the pricey side because I'd rather eat the cost
                than ship you something half-smart that misses real points.
                Anthropic credits are covering it right now, but those run out,
                so I'm keeping the list small until I figure out billing. Glad
                you're one of the early ones.
              </p>
            </CardContent>
            <CardFooter className="relative justify-end brief-glide brief-delay-3">
              <Button onClick={() => setStep(1)} className="brief-button">
                Continue
                <span aria-hidden="true" className="ml-1">→</span>
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 1 · Brief 2/3 — $5/month only when it works */}
        {step === 1 && (
          <Card key="brief-2" className="relative overflow-hidden rounded-3xl border-border/70">
            <div className="pointer-events-none absolute top-3 right-4 brief-index brief-glide" aria-hidden="true">
              fig. 02 — brief · 2 of 3
            </div>
            <CardHeader className="relative pb-3">
              <div className="brief-glide space-y-2">
                <span className="brief-index">§ billing</span>
                <div className="h-px bg-border brief-tick" />
                <CardTitle className="font-heading text-2xl tracking-tight leading-tight">
                  <span className="brief-nums">$5</span>/month, only if it works.
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="relative pt-0 text-sm leading-relaxed">
              <p className="brief-glide brief-delay-2 text-muted-foreground brief-nums">
                You only get charged in months where Poko actually catches a
                regrade you got points back on. If it finds nothing, you pay
                nothing. One caught mistake is usually worth way more than $5
                in points, so if this hits even once a semester you come out
                ahead.
              </p>
            </CardContent>
            <CardFooter className="relative justify-between brief-glide brief-delay-3">
              <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={() => setStep(2)} className="brief-button">
                Continue
                <span aria-hidden="true" className="ml-1">→</span>
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 2 · Brief 3/4 — Open source + private */}
        {step === 2 && (
          <Card key="brief-3" className="relative overflow-hidden rounded-3xl border-border/70">
            <div className="pointer-events-none absolute top-3 right-4 brief-index brief-glide" aria-hidden="true">
              fig. 03 — brief · 3 of 4
            </div>
            <CardHeader className="relative pb-3">
              <div className="brief-glide space-y-2">
                <span className="brief-index">§ code</span>
                <div className="h-px bg-border brief-tick" />
                <CardTitle className="font-heading text-2xl tracking-tight leading-tight">
                  Want to poke around the code?
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="relative pt-0 text-sm leading-relaxed space-y-4">
              <p className="brief-glide brief-delay-2 text-muted-foreground">
                Poko is fully open source — the whole thing is on{" "}
                <a
                  href="https://github.com/resplendentHSHI/Regrade"
                  className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary transition-colors"
                  onClick={(e) => {
                    e.preventDefault();
                    import("@tauri-apps/plugin-opener").then((m) =>
                      m.openUrl("https://github.com/resplendentHSHI/Regrade")
                    );
                  }}
                >
                  GitHub
                </a>
                . It's designed from the ground up to keep your data private:
                your Gradescope password never leaves this device, and PDFs are
                deleted from the server the moment analysis finishes.
              </p>
              <p className="brief-glide brief-delay-3 text-xs display-italic text-muted-foreground pt-2 border-t border-border/60">
                Tell me what's broken or what you wish it did — there's a
                Feedback link in the sidebar once you're in, or you can open an
                issue on GitHub. I read every one.
              </p>
            </CardContent>
            <CardFooter className="relative justify-between brief-glide brief-delay-4">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} className="brief-button">
                Continue
                <span aria-hidden="true" className="ml-1">→</span>
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 3 · Brief 4/4 — Ground rules (terms of use / responsible use) */}
        {step === 3 && (
          <Card key="brief-4" className="relative overflow-hidden rounded-3xl border-border/70">
            <div className="pointer-events-none absolute top-3 right-4 brief-index brief-glide" aria-hidden="true">
              fig. 04 — brief · 4 of 4
            </div>
            <CardHeader className="relative pb-3">
              <div className="brief-glide space-y-2">
                <span className="brief-index">§ terms of use</span>
                <div className="h-px bg-border brief-tick" />
                <CardTitle className="font-heading text-2xl tracking-tight leading-tight">
                  Terms of use.
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="relative pt-0 text-sm leading-relaxed space-y-4">
              <ul className="brief-glide brief-delay-2 space-y-3 text-muted-foreground">
                <li>
                  <span className="text-foreground font-medium">Your course's policy comes first.</span>{" "}
                  Poko is a grading-assistance tool, not a loophole — if your
                  instructor or academic integrity office says don't use
                  automated tools, don't. You'll confirm this for each enabled
                  course during setup.
                </li>
                <li>
                  <span className="text-foreground font-medium">Regrade requests are your responsibility.</span>{" "}
                  Poko drafts suggestions. You decide whether to send any of
                  them. Please only submit requests you actually believe in, and
                  be polite to your graders — they're usually students too.
                </li>
                <li>
                  <span className="text-foreground font-medium">No warranty.</span>{" "}
                  Poko is a small beta project. We make no guarantees about
                  analysis accuracy, uptime, or that your server-side data is
                  safe from total loss. Use it for what it is.
                </li>
                <li>
                  <span className="text-foreground font-medium">No abuse.</span>{" "}
                  Don't use Poko to spam graders, submit bad-faith regrades, or
                  scrape Gradescope data you're not supposed to have access to.
                  Accounts doing this may be cut off without notice.
                </li>
              </ul>
              <p className="brief-glide brief-delay-3 text-xs text-muted-foreground text-center pt-2 border-t border-border/60">
                Billing isn't set up yet — I'll ping you when it is. Just use it
                for now.
              </p>
            </CardContent>
            <CardFooter className="relative justify-between brief-glide brief-delay-4">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)} className="brief-button">
                Agree &amp; start setup
                <span aria-hidden="true" className="ml-1">→</span>
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 4: Data Transparency */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">How your data is handled</CardTitle>
              <CardDescription>
                Exactly what happens with your information, in plain terms.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>
                  Your Gradescope credentials are stored on your device only, in your operating
                  system's secure keychain. They are never sent to our servers.
                </li>
                <li>
                  Your graded assignments are sent to our server for AI analysis. The PDF
                  is permanently deleted from our server immediately after processing completes.
                  We never retain your coursework.
                </li>
                <li>
                  What we keep on our server: your email address, which courses you've enabled, and
                  aggregate stats (pages reviewed, points recovered). That's it.
                </li>
                <li>
                  Email notifications: We'll email you when we find an obvious grading error. You
                  can turn this off anytime.
                </li>
                <li>
                  You're always in control: Every regrade suggestion is a draft for you to review.
                  We never submit anything to Gradescope on your behalf.
                </li>
                <li>
                  None of this is a black box — Poko is fully open source, so if you want to
                  verify any of the above you can read the code on{" "}
                  <a
                    href="https://github.com/resplendentHSHI/Regrade"
                    className="text-primary underline underline-offset-2"
                    onClick={(e) => {
                      e.preventDefault();
                      import("@tauri-apps/plugin-opener").then((m) =>
                        m.openUrl("https://github.com/resplendentHSHI/Regrade")
                      );
                    }}
                  >
                    GitHub
                  </a>
                  .
                </li>
              </ul>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={() => setStep(5)}>I understand, continue</Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 5: Gradescope Credentials */}
        {step === 5 && (
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="font-heading text-xl">Connect Gradescope</CardTitle>
              <CardDescription>
                Poko needs a Gradescope password login — not SSO — to pull your graded work.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Instructions — "use your own email, set a password" */}
              <div className="rounded-2xl border border-accent/50 bg-accent/20 p-4 text-xs leading-relaxed space-y-2">
                <p className="font-medium text-foreground text-sm">
                  Important — use a personal email, not your school SSO
                </p>
                <p className="text-muted-foreground">
                  If your school logs you in through SSO (Google, Shibboleth, Microsoft),
                  Poko can't sign in with that. You'll need to link a personal email to your
                  Gradescope account and set an explicit password. It takes about 2 minutes:
                </p>
                <ol className="list-decimal list-outside ml-4 space-y-1 text-muted-foreground">
                  <li>
                    Sign into Gradescope normally, then open{" "}
                    <a
                      href="https://www.gradescope.com/account/edit"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      Account Settings
                    </a>
                  </li>
                  <li>
                    Add a <strong>personal email</strong> (e.g. Gmail) as a secondary email
                  </li>
                  <li>
                    Click <strong>"Set a password"</strong> and pick something memorable
                  </li>
                  <li>
                    Verify the email, then enter that email + password below
                  </li>
                </ol>
                <p className="text-muted-foreground italic">
                  Your credentials stay on this device — they never leave your Mac.
                </p>
              </div>

              {loginOk ? (
                /* Already connected — don't let them re-submit creds */
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <svg
                      className="h-5 w-5 text-primary mt-0.5 shrink-0"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Connected to Gradescope</p>
                      <p className="text-xs text-muted-foreground mt-0.5 break-all">
                        {email}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginOk(false);
                      setPassword("");
                      setLoginError("");
                    }}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    Use a different account
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="gs-email">Gradescope email</Label>
                    <Input
                      id="gs-email"
                      type="email"
                      placeholder="your.personal@gmail.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setLoginError(""); }}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gs-password">Password</Label>
                    <Input
                      id="gs-password"
                      type="password"
                      placeholder="The password you set on Gradescope"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setLoginError(""); }}
                    />
                  </div>

                  <Button
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
                        Signing in...
                      </span>
                    ) : (
                      "Let's go!"
                    )}
                  </Button>

                  {loginError && (
                    <p className="text-sm text-destructive">{loginError}</p>
                  )}
                </>
              )}
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="outline" onClick={() => setStep(4)}>Back</Button>
              <Button disabled={!loginOk} onClick={() => setStep(6)}>Continue</Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 6: Course Selection */}
        {step === 6 && (
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
              <Button variant="outline" onClick={() => setStep(5)}>Back</Button>
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
