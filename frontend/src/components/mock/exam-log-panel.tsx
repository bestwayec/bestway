"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";

export const EXAM_LOG_EVENTS = new Set([
  "tab_switch", "window_blur", "exit_fullscreen", "fullscreen_exit", "mouse_leave", "copy_blocked", "cut_blocked",
  "paste_blocked", "contextmenu_blocked", "devtools_attempt", "view_source_attempt",
]);

const KNOWN = EXAM_LOG_EVENTS;

/** Plain-language text of a recorded exam-window event (translator of the `mock.examLog` namespace). */
export function examLogEventText(t: (key: string, values?: Record<string, string>) => string, event: string): string {
  return EXAM_LOG_EVENTS.has(event) ? t(`events.${event}`) : t("events.other", { event });
}

/**
 * Staff only: what the exam window recorded during this attempt (leaving full screen,
 * switching tabs, refused pastes...), with the time. Recorded events never stopped the exam.
 */
export function ExamLogPanel({ events }: { events: { event: string; date: string }[] }) {
  const t = useTranslations("mock.examLog");
  const locale = useLocale();
  const time = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(locale === "uz" ? "uz-UZ" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  return (
    <Card className="p-5" data-testid="exam-log-panel">
      <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
        <ShieldAlert className="size-4 text-warning" aria-hidden />
        {t("title", { count: events.length })}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t("note")}</p>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{t("empty")}</p>
      ) : (
        <ol className="mt-3 space-y-1.5 text-sm">
          {events.map((item, index) => (
            <li key={`${item.date}-${index}`} className="flex flex-wrap items-baseline gap-x-3 rounded-[8px] bg-bg-subtle px-3 py-2">
              <span className="font-mono text-xs tabular-nums text-fg-muted">{time(item.date)}</span>
              <span className="text-fg">{KNOWN.has(item.event) ? t(`events.${item.event}`) : t("events.other", { event: item.event })}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
