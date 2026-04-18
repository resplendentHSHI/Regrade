import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Home, ListTodo, FileText, Calendar, Settings, MessageCircleHeart } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Egg } from "./Egg";
import { PetCompanion } from "./Pet";
import { getPet, getAssignments } from "@/lib/store";
import { getRandomTip, type Pet, type TipContext } from "@/lib/pet";

const links = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/queue", icon: ListTodo, label: "Queue" },
  { to: "/assignments", icon: FileText, label: "Assignments" },
  { to: "/upcoming", icon: Calendar, label: "Upcoming" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const TIP_DURATION_MS = 8000;
const IDLE_TIP_INTERVAL_MS = 50_000;

export function Sidebar() {
  const [pet, setPet] = useState<Pet | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [mood, setMood] = useState<"idle" | "happy">("idle");
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTipRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenStatusRef = useRef<Record<string, string>>({});

  // Load pet on mount
  useEffect(() => {
    getPet().then(setPet);
  }, []);

  function showTip(context: TipContext, moodOverride?: "idle" | "happy") {
    if (!pet) return;
    const text = getRandomTip(pet.species, context);
    setTip(text);
    if (moodOverride) {
      setMood(moodOverride);
      setTimeout(() => setMood("idle"), TIP_DURATION_MS);
    }
    if (clearTipRef.current) clearTimeout(clearTipRef.current);
    clearTipRef.current = setTimeout(() => setTip(null), TIP_DURATION_MS);
  }

  // Welcome tip on first load
  useEffect(() => {
    if (!pet) return;
    if (pet.tipsShown === 0) {
      showTip("welcome");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.species]);

  // Idle tip timer
  useEffect(() => {
    if (!pet) return;
    const interval = setInterval(() => {
      // Don't interrupt an active tip
      if (!tip) showTip("idle");
    }, IDLE_TIP_INTERVAL_MS);
    tipTimerRef.current = interval;
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.species, tip]);

  // Watch assignments for status transitions — show contextual tips
  useEffect(() => {
    if (!pet) return;
    const poll = setInterval(async () => {
      const items = await getAssignments();
      const current: Record<string, string> = {};
      for (const a of items) {
        current[`${a.courseId}_${a.assignmentId}`] = a.status;
      }
      const prev = lastSeenStatusRef.current;
      // Detect transitions
      for (const key of Object.keys(current)) {
        const before = prev[key];
        const now = current[key];
        if (before && before !== now) {
          if (now === "regrade_candidates") {
            showTip("regrade_found", "happy");
            break;
          }
          if (now === "no_issues") {
            showTip("no_issues");
            break;
          }
          if (now === "analyzing" && before !== "analyzing") {
            showTip("analyzing");
            break;
          }
        }
      }
      lastSeenStatusRef.current = current;
    }, 6000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.species]);

  return (
    <aside className="w-60 border-r border-sidebar-border bg-sidebar flex flex-col h-full relative">
      {/* Subtle paper-texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(oklch(0.8 0.04 75 / 0.15) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />

      {/* Brand */}
      <div className="relative p-5 pb-4">
        <h1 className="font-heading text-2xl tracking-tight leading-none">
          <span className="text-primary">P</span>oko
        </h1>
        <p className="text-[10px] text-muted-foreground mt-0.5 tracking-wide uppercase">
          grade companion
        </p>
      </div>

      {/* Divider with small ornament */}
      <div className="relative flex items-center gap-2 px-5 mb-2">
        <div className="h-px flex-1 bg-sidebar-border" />
        <span className="text-[8px] text-muted-foreground/60">✿</span>
        <div className="h-px flex-1 bg-sidebar-border" />
      </div>

      {/* Nav — scrollable so the pet nest always stays visible at the bottom */}
      <nav className="relative flex-1 min-h-0 overflow-y-auto px-3 space-y-0.5">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all ${
                isActive
                  ? "bg-sidebar-primary/10 text-sidebar-primary font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`h-4 w-4 transition-transform ${
                    isActive ? "scale-110" : ""
                  }`}
                  strokeWidth={isActive ? 2.25 : 1.75}
                />
                <span>{label}</span>
                {isActive && (
                  <span className="ml-auto text-primary/60 text-[10px]">●</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Feedback link */}
      <div className="relative px-3 pb-2">
        <button
          onClick={() =>
            openUrl(
              "https://docs.google.com/forms/d/e/1FAIpQLSd5Y8XbEvwBMI7QUmDpcac6Ksy7FZUr-0cmikN0iBewM-GjmQ/viewform?usp=publish-editor"
            )
          }
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm w-full text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
        >
          <MessageCircleHeart className="h-4 w-4" strokeWidth={1.75} />
          <span>Feedback</span>
          <span className="ml-auto text-muted-foreground/50 text-[10px]">↗</span>
        </button>
      </div>

      {/* Pet nest — shrink-0 so banners don't push it off screen */}
      <div className="relative px-3 pb-4 pt-2 shrink-0">
        <div className="rounded-2xl border border-sidebar-border bg-card/50 backdrop-blur-sm p-2 relative overflow-hidden">
          {/* warm gradient wash */}
          <div
            className="absolute inset-0 opacity-60 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 50% 120%, oklch(0.95 0.04 10 / 0.6), transparent 60%)",
            }}
          />
          <div className="relative">
            {pet ? (
              <PetCompanion pet={pet} tip={tip} mood={mood} />
            ) : (
              <Egg onHatched={(p) => setPet(p)} />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
