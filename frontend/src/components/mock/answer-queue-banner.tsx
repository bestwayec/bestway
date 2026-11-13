"use client";

import * as React from "react";
import { CloudOff, RotateCw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/**
 * Exam connection notice. States come from the runner: how many answers are still only
 * on this device, whether saving is failing, and whether a hand-in could not be
 * confirmed. Nothing is claimed that the runner did not observe.
 */
export function AnswerQueueBanner({
  queued,
  failing,
  submitUnconfirmed,
  onRetrySubmit,
}: {
  queued: number;
  failing: boolean;
  submitUnconfirmed: boolean;
  onRetrySubmit: () => void;
}) {
  const t = useTranslations("mock.runnerUx");
  const online = React.useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  if (submitUnconfirmed) {
    return (
      <div role="alert" data-testid="submit-unconfirmed" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[60] flex flex-col gap-2 rounded-[10px] border border-warning-border bg-surface px-3.5 py-3 text-sm text-fg shadow-lg sm:flex-row sm:items-center">
        <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
        <span className="flex-1">{queued > 0 ? t("submitUnconfirmedQueued", { count: queued }) : t("submitUnconfirmed")}</span>
        <Button size="sm" onClick={onRetrySubmit} className="min-h-[44px]">
          <RotateCw className="size-4" aria-hidden />
          {t("retrySubmit")}
        </Button>
      </div>
    );
  }
  if (online && !(failing && queued > 0)) return null;
  return (
    <div role="status" aria-live="polite" data-testid="answer-queue-banner" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[60] flex items-center gap-2 rounded-[10px] border border-warning-border bg-surface px-3.5 py-2.5 text-sm text-fg shadow-lg">
      <CloudOff className="size-4 shrink-0 text-warning" aria-hidden />
      <span>{queued > 0 ? t("queueWaiting", { count: queued }) : t("queueOfflineAllSaved")}</span>
    </div>
  );
}
