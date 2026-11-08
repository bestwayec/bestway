import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "danger" | "warning" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  brand: "bg-brand-subtle text-brand",
  success: "bg-success-bg text-success",
  danger: "bg-danger-bg text-danger",
  warning: "bg-warning-bg text-warning",
  info: "bg-info-bg text-info",
  neutral: "bg-surface-elevated text-fg-muted",
};

export function StatCard({
  label,
  value,
  icon: Icon,
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
  return (
    <Card
      className={cn("p-5 rounded-[12px] border border-border bg-surface", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-fg-muted">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-fg tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-sm text-fg-muted">{hint}</p>}
        </div>
        {Icon && (
          <span
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-border/40",
              toneClass[tone],
            )}
          >
            <Icon className="size-5" />
          </span>
        )}
      </div>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="p-5 rounded-[12px] border border-border bg-surface">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
    </Card>
  );
}
