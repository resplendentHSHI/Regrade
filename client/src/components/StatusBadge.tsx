import { Badge } from "@/components/ui/badge";

type Variant = "default" | "secondary" | "destructive" | "outline";

const STATUS_CONFIG: Record<string, { label: string; variant: Variant }> = {
  pending_upload: { label: "Pending", variant: "outline" },
  uploading: { label: "Uploading", variant: "secondary" },
  analyzing: { label: "Analyzing", variant: "secondary" },
  complete: { label: "Reviewed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  no_issues: { label: "No Issues", variant: "outline" },
  regrade_candidates: { label: "Possible Regrade", variant: "default" },
};

/**
 * Label the status with hedge words unless the issue is critical-confidence.
 * Takes the highest confidence tier found in the analysis as an optional hint.
 */
export function statusLabel(status: string, topTier?: string): string {
  if (status === "regrade_candidates") {
    if (topTier === "critical") return "Likely Regrade";
    if (topTier === "strong") return "Possible Regrade";
    return "Maybe Worth Reviewing";
  }
  return STATUS_CONFIG[status]?.label ?? status;
}

/** Extract the highest confidence tier from a result_json string. */
export function topConfidenceTier(resultJson?: string): string | undefined {
  if (!resultJson) return undefined;
  try {
    const parsed = JSON.parse(resultJson);
    const issues: Array<{ confidence_tier?: string; keep?: boolean }> =
      parsed.issues || [];
    const kept = issues.filter((i) => i.keep);
    if (kept.some((i) => i.confidence_tier === "critical")) return "critical";
    if (kept.some((i) => i.confidence_tier === "strong")) return "strong";
    if (kept.some((i) => i.confidence_tier === "marginal")) return "marginal";
  } catch {
    return undefined;
  }
  return undefined;
}

export function StatusBadge({
  status,
  resultJson,
}: {
  status: string;
  resultJson?: string;
}) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "outline" as Variant };
  const tier = topConfidenceTier(resultJson);
  const label = statusLabel(status, tier);
  return <Badge variant={config.variant}>{label}</Badge>;
}
