import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";

type Tone = "brand" | "success" | "danger" | "warning" | "info" | "neutral";

/**
 * Dashboard KPI. Kept for its callers; renders the design-system StatTile (docs/design/DIRECTION.md):
 * the number is the content, so the icon is a small neutral glyph, not a coloured square. `tone` only
 * colours the value when it carries status (danger, warning).
 */
export function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: string;
  className?: string;
}) {
  const valueNode =
    tone === "danger" || tone === "warning" ? <span className={tone === "danger" ? "text-danger" : "text-warning"}>{value}</span> : value;
  return <StatTile label={label} value={valueNode} icon={icon} hint={hint} className={className} />;
}

export function StatCardSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-16" />
    </Card>
  );
}
