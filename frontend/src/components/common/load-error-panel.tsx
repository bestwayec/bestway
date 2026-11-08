"use client";

import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared "could not load" panel (U4): a title, the reason, "Try again" and "Back to home".
 * Used by the mock runner and the CD simulator so both failures look and behave the same.
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
      <div role="alert" className="w-full max-w-md rounded-2xl border border-danger-border bg-surface p-6 shadow-lg sm:p-8">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-danger-bg text-danger">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <h2 className="text-lg font-bold text-fg">{title ?? t("title")}</h2>
        <p className="mt-2 text-sm text-fg-muted">{reason || t("reason")}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button type="button" onClick={onRetry ?? (() => window.location.reload())}>
            <RotateCcw className="size-4" aria-hidden />
            {t("retry")}
          </Button>
          <Button asChild variant="outline">
            {/* Plain anchor (full navigation is the right reset after a failed load); the
                locale proxy keeps the user's language via the NEXT_LOCALE cookie. */}
            <a href={homeHref}>
              <Home className="size-4" aria-hidden />
              {t("home")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
