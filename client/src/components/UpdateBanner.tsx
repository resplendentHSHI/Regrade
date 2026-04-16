import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, X, Sparkles } from "lucide-react";
import { checkForUpdate, type UpdateInfo } from "@/lib/updates";

const DISMISS_KEY = "poko_update_dismissed";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForUpdate().then((r) => {
      if (!r.available) return;
      // Has the user already dismissed THIS specific update?
      const dismissedSha = localStorage.getItem(DISMISS_KEY);
      if (dismissedSha === r.latestCommit) {
        setDismissed(true);
      }
      setInfo(r);
    });
    // Re-check once an hour
    const interval = setInterval(() => {
      checkForUpdate().then((r) => {
        if (r.available) setInfo(r);
      });
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  function handleDismiss() {
    if (info?.latestCommit) {
      localStorage.setItem(DISMISS_KEY, info.latestCommit);
    }
    setDismissed(true);
  }

  async function handleDownload() {
    if (info) await openUrl(info.downloadUrl);
  }

  if (!info || !info.available || dismissed) return null;

  return (
    <div className="border-b border-accent/50 bg-accent/25 px-6 py-2.5">
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        <Sparkles className="h-4 w-4 text-accent-foreground/70 shrink-0" />
        <div className="flex-1 text-sm">
          <span className="font-medium">A new version of Poko is ready.</span>
          <span className="text-muted-foreground ml-2">
            Download and replace in Applications to update.
          </span>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 hover:opacity-90 transition-opacity shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Get update
        </button>
        <button
          onClick={handleDismiss}
          className="rounded-full p-1.5 hover:bg-muted transition-colors shrink-0"
          aria-label="Dismiss"
          title="Dismiss for this version"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
