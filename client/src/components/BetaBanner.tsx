import { useEffect, useState } from "react";
import { X, Flower2 } from "lucide-react";

const DISMISS_KEY = "poko_beta_banner_dismissed_at";
const RE_SHOW_AFTER_DAYS = 7;

export function BetaBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (!dismissed) {
      setVisible(true);
      return;
    }
    const daysAgo = (Date.now() - Number(dismissed)) / (1000 * 60 * 60 * 24);
    setVisible(daysAgo > RE_SHOW_AFTER_DAYS);
  }, []);

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="border-b border-secondary/50 bg-secondary/30 px-6 py-2">
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        <Flower2 className="h-4 w-4 text-secondary-foreground/70 shrink-0" />
        <div className="flex-1 text-sm">
          <span className="font-medium">Poko is in early beta.</span>
          <span className="text-muted-foreground ml-2">
            Please use the Feedback link in the sidebar to share bugs or ideas — we're
            reading everything.
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="rounded-full p-1.5 hover:bg-muted transition-colors shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
