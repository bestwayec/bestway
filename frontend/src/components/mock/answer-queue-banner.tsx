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
  storageUnavailable,
  conflicts,
  lockedEdits,
  onKeepLocal,
  onUseServer,
  submitUnconfirmed,
  onRetrySubmit,
}: {
  queued: number;
  failing: boolean;
  storageUnavailable: boolean;
  conflicts: number;
  lockedEdits: number;
  onKeepLocal: () => void;
  onUseServer: () => void;
  submitUnconfirmed: boolean;
  onRetrySubmit: () => void;
}) {
  const t = useTranslations("mock.runnerUx");
  const online = React.useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  const connectionNotice = !online || (failing && queued > 0);
  if (!submitUnconfirmed && !connectionNotice && !storageUnavailable && !conflicts && !lockedEdits) return null;
  return (
    <div role="status" aria-live="polite" data-testid={submitUnconfirmed ? "submit-unconfirmed" : "answer-queue-banner"} className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[60] space-y-2 rounded-control border border-warning-border bg-surface px-3.5 py-2.5 text-sm text-fg shadow-lg">
      {submitUnconfirmed ? (
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="flex-1">{queued > 0 ? t("submitUnconfirmedQueued", { count: queued }) : t("submitUnconfirmed")}</span>
          <Button size="sm" onClick={onRetrySubmit} className="min-h-[44px]">
            <RotateCw className="size-4" aria-hidden />
            {t("retrySubmit")}
          </Button>
        </div>
      ) : connectionNotice && (
        <div className="flex items-center gap-2">
          <CloudOff className="size-4 shrink-0 text-warning" aria-hidden />
          <span>{queued > 0 ? t("queueWaiting", { count: queued }) : t("queueOfflineAllSaved")}</span>
        </div>
      )}
      {storageUnavailable && <p>{t("queueStorageUnavailable")}</p>}
      {lockedEdits > 0 && <p>{t("queueLocked", { count: lockedEdits })}</p>}
      {conflicts > 0 && !submitUnconfirmed && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1">{t("queueConflicts", { count: conflicts })}</p>
          <Button size="sm" variant="outline" onClick={onUseServer}>{t("useServerAnswers")}</Button>
          <Button size="sm" onClick={onKeepLocal}>{t("keepLocalAnswers")}</Button>
        </div>
      )}
    </div>
  );
}
