import * as React from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-[12px] bg-border/50", className)}
      aria-hidden
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-fg-muted", className)} aria-hidden />;
}

/** Sahifa/blok bo'sh bo'lganda — nima qilish kerakligini aytadi */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-border bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="rounded-full bg-surface-elevated p-3 border border-border">
          <Icon className="size-6 text-fg-muted" aria-hidden />
        </div>
      )}
      <div className="space-y-1.5 max-w-md">
        <p className="text-base font-semibold text-fg">{title}</p>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** So'rov muvaffaqiyatsiz bo'lganda — nima bo'ldi + Qayta urinish kartasi */
export function ErrorState({
  title,
  description,
  action,
  onRetry,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[12px] border border-danger-border bg-surface p-6 sm:p-8 text-center",
        className,
      )}
      role="alert"
    >
      <div className="rounded-full bg-danger-bg p-3 border border-danger-border/50">
        <AlertTriangle className="size-6 text-danger" aria-hidden />
      </div>
      <div className="space-y-1.5 max-w-md">
        <h3 className="text-lg font-semibold text-fg">{title}</h3>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {action ? (
        <div className="mt-2">{action}</div>
      ) : onRetry ? (
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className="mt-2 min-h-[44px] px-5"
        >
          <RotateCcw className="mr-1.5 size-4" />
          Qayta urinish
        </Button>
      ) : null}
    </div>
  );
}
