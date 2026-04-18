import { useEffect, useState } from "react";
import { getHeartbeatState } from "@/lib/store";

/**
 * Persistent progress banner visible across all tabs.
 *
 * Reads heartbeat status + progressMessage from storage and polls frequently
 * while active. Shows real-time progress like "Uploading 3 PDFs for analysis…"
 * so the user always knows what Poko is doing regardless of which tab they're on.
 */
export function HeartbeatBanner() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const state = await getHeartbeatState();
        if (!mounted) return;
        setRunning(state.status === "running");
        setMessage(state.progressMessage);
      } catch {
        /* ignore — storage may briefly be unavailable mid-write */
      }
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
        <span className="inline-block h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
        <span className="text-foreground/90 font-medium truncate">
          {message || "Poko is scanning Gradescope"}
        </span>
      </div>
    </div>
  );
}
