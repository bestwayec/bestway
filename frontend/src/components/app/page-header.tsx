import * as React from "react";
import { cn } from "@/lib/utils";

/** Sahifa sarlavhasi — nom, tavsif va o'ng tomonda amallar */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="mt-1 h-6 w-1 shrink-0 rounded-[2px] bg-brand sm:mt-1.5 sm:h-7"
        />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 text-sm text-pretty text-fg-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
