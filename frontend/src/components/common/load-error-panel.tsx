"use client";

import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared "could not load" panel (U4): a title, the reason, "Try again" and "Back to home".
 */
export function LoadErrorPanel({
  title,
  reason,
  onRetry,
  homeHref = "/dashboard",
  fullScreen = false,
  className,
}: {
  title?: string;
  reason?: string | null;
  onRetry?: () => void;
  homeHref?: string;
  fullScreen?: boolean;
  className?: string;
}) {
  const t = useTranslations("errorPanel");
  return (
    <div
      className={cn(
        "flex items-center justify-center p-4 text-center",
        fullScreen ? "min-h-dvh w-full bg-bg" : "mx-auto min-h-[400px] max-w-lg",
        className,
      )}
    >
      <div
        role="alert"
        className="w-full max-w-md rounded-[12px] border border-danger-border bg-surface p-6 sm:p-8"
      >
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-danger-bg text-danger border border-danger-border/40">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <h2 className="text-xl font-bold text-fg">{title ?? t("title")}</h2>
        <p className="mt-2 text-sm text-fg-muted">{reason || t("reason")}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            type="button"
            className="min-h-[44px] bg-brand hover:bg-brand/90 text-brand-fg font-medium px-5"
            onClick={onRetry ?? (() => window.location.reload())}
          >
            <RotateCcw className="mr-1.5 size-4" aria-hidden />
            {t("retry")}
          </Button>
          <Button asChild variant="outline" className="min-h-[44px] px-5">
            <a href={homeHref}>
              <Home className="mr-1.5 size-4" aria-hidden />
              {t("home")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
