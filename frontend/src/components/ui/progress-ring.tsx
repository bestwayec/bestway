import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A circular progress meter. `value` / `max` fill the ring; the centre shows `label`
 * (defaults to the rounded percentage). The ring is exposed as role="meter" with the real
 * value, so screen readers hear numbers, not a picture.
 */
export function ProgressRing({
  value,
  max = 100,
  size = 64,
  stroke = 6,
  label,
  ariaLabel,
  tone = "brand",
  className,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  label?: React.ReactNode;
  ariaLabel: string;
  tone?: "brand" | "warning" | "danger" | "neutral";
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const ratio = clamped / safeMax;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = { brand: "text-brand", warning: "text-warning", danger: "text-danger", neutral: "text-fg-muted" }[tone];
  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          className={cn("stroke-current transition-[stroke-dashoffset] duration-slow ease-out motion-reduce:transition-none", color)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums text-fg">
        {label ?? `${Math.round(ratio * 100)}%`}
      </span>
    </div>
  );
}
