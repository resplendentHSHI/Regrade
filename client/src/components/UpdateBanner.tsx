import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Sparkles, X, ExternalLink } from "lucide-react";

/**
 * Shows a banner when a new version is available, but does NOT auto-install.
 *
 * The Tauri updater's downloadAndInstall() deletes the current .app before
 * writing the new one. On unsigned builds, the new .app gets blocked by
 * Gatekeeper and the user is left with no app at all. Until we have proper
 * Apple code signing, we just tell the user to reinstall via the curl
 * installer command (which bypasses Gatekeeper by not going through Safari).
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
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
    const interval = setInterval(run, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function handleCopyInstall() {
    const cmd = `curl -sL https://raw.githubusercontent.com/resplendentHSHI/Regrade/poko-server/scripts/install-mac.sh | bash`;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }

  function handleDismiss() {
    if (update) {
      localStorage.setItem("poko_update_dismissed_version", update.version);
    }
    setDismissed(true);
  }

  if (!update || dismissed) return null;

  return (
    <div className="border-b border-accent/50 bg-accent/25 px-6 py-2.5">
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        <Sparkles className="h-4 w-4 text-accent-foreground/70 shrink-0" />
        <div className="flex-1 text-sm">
          <span className="font-medium">Poko {update.version} is available.</span>
          <span className="text-muted-foreground ml-2">
            Paste the install command in Terminal to update.
          </span>
        </div>
        <button
          onClick={handleCopyInstall}
          className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 hover:opacity-90 transition-opacity shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {copied ? "Copied!" : "Copy Install Command"}
        </button>
        <button
          onClick={handleDismiss}
          className="rounded-full p-1.5 hover:bg-muted transition-colors shrink-0"
          aria-label="Dismiss"
          title="Dismiss until next version"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
