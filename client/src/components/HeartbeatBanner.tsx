import { useEffect, useState } from "react";
import { getHeartbeatState } from "@/lib/store";

/**
 * Persistent "Poko is syncing" banner visible across all tabs.
 *
 * Reads heartbeat status from the on-disk store and polls frequently while
 * active. Unlike a local component state, this survives tab switches and
 * component unmounts — the user can always tell whether a scan is actually
 * still running, regardless of which page they're on.
 */
export function HeartbeatBanner() {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const state = await getHeartbeatState();
        if (!mounted) return;
        setRunning(state.status === "running");
      } catch {
        /* ignore — storage may briefly be unavailable mid-write */
      }
      // Poll faster while running so the banner disappears promptly on
      // completion; relax while idle to save work.
      if (mounted) {
        timer = setTimeout(tick, running ? 1500 : 4000);
      }
    }

    tick();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [running]);

  if (!running) return null;

  return (
    <div className="border-b border-primary/20 bg-primary/10 px-6 py-1.5">
      <div className="flex items-center gap-2 max-w-5xl mx-auto text-sm">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0"
          aria-hidden="true"
        />
        <span className="text-foreground/90 font-medium">
          Poko is scanning Gradescope
        </span>
        <span className="text-muted-foreground hidden sm:inline">
          — this runs in the background, feel free to keep using the app.
        </span>
      </div>
    </div>
  );
}
