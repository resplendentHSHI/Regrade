import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, Sparkles, Loader2 } from "lucide-react";

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<"idle" | "downloading" | "installing" | "error">("idle");
  const [progress, setProgress] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    // Only check in production builds (updater can't verify in dev)
    let cancelled = false;
    async function run() {
      try {
        const u = await check();
        if (!cancelled && u) {
          const dismissKey = "poko_update_dismissed_version";
          const dismissedVersion = localStorage.getItem(dismissKey);
          if (dismissedVersion === u.version) {
            setDismissed(true);
          }
          setUpdate(u);
        }
      } catch {
        // Updater fails in dev mode — that's fine
      }
    }
    run();
    // Re-check every hour
    const interval = setInterval(run, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleInstall() {
    if (!update) return;
    setState("downloading");
    setError("");
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setTotal(event.data.contentLength ?? 0);
            break;
          case "Progress":
            setProgress((p) => p + event.data.chunkLength);
            break;
          case "Finished":
            setState("installing");
            break;
        }
      });
      // Relaunch the app with the new version
      await relaunch();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleDismiss() {
    if (update) {
      localStorage.setItem("poko_update_dismissed_version", update.version);
    }
    setDismissed(true);
  }

  if (!update || dismissed) return null;

  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  return (
    <div className="border-b border-accent/50 bg-accent/25 px-6 py-2.5">
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        <Sparkles className="h-4 w-4 text-accent-foreground/70 shrink-0" />
        <div className="flex-1 text-sm">
          {state === "idle" && (
            <>
              <span className="font-medium">Poko {update.version} is ready.</span>
              <span className="text-muted-foreground ml-2">
                One click installs and relaunches.
              </span>
            </>
          )}
          {state === "downloading" && (
            <>
              <span className="font-medium">Downloading…</span>
              <span className="text-muted-foreground ml-2 tabular-nums">{pct}%</span>
            </>
          )}
          {state === "installing" && (
            <span className="font-medium">Installing, relaunching…</span>
          )}
          {state === "error" && (
            <span className="text-destructive">Update failed: {error}</span>
          )}
        </div>
        {state === "idle" && (
          <>
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 hover:opacity-90 transition-opacity shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="rounded-full p-1.5 hover:bg-muted transition-colors shrink-0"
              aria-label="Dismiss"
              title="Dismiss until next version"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </>
        )}
        {(state === "downloading" || state === "installing") && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        )}
      </div>
    </div>
  );
}
