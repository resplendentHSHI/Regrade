import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_upload: { label: "Pending", variant: "outline" },
  uploading: { label: "Uploading", variant: "secondary" },
  analyzing: { label: "Analyzing", variant: "secondary" },
  complete: { label: "Reviewed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  no_issues: { label: "No Issues", variant: "outline" },
  regrade_candidates: { label: "Regrade Found", variant: "default" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
