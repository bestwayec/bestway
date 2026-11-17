import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./feedback";

/**
 * One number with its label (docs/design/DIRECTION.md): label on top, the value large with tabular
 * numbers, an optional hint or trend below. No coloured icon square: the number is the content.
 * `loading` keeps the tile's height (no layout shift).
 */
export function StatTile({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  loading,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** A short change against the previous value, e.g. "+0.5". Sign decides the colour. */
  trend?: { value: string; direction: "up" | "down" | "flat"; label?: string };
  icon?: React.ElementType;
  loading?: boolean;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-fg">{value}</p>
      )}
      {(hint || trend) && !loading && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
          {trend && (
            <span
              className={cn(
                "font-semibold tabular-nums",
                trend.direction === "up" && "text-success",
                trend.direction === "down" && "text-danger",
              )}
            >
              {trend.value}
              {trend.label && <span className="sr-only"> {trend.label}</span>}
            </span>
          )}
          {hint}
        </p>
      )}
    </>
  );
  const classes = cn("block rounded-card border border-border bg-surface p-4 sm:p-5", className);
  return href ? (
    <a href={href} className={cn(classes, "transition-[border-color,box-shadow] duration-fast hover:border-border-strong hover:shadow-e1")}>
      {body}
    </a>
  ) : (
    <div className={classes}>{body}</div>
  );
}
