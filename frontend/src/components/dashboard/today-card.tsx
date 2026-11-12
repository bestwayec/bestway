"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { BookOpenCheck, ChevronRight, ClipboardList, Languages, PlayCircle, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { api } from "@/lib/api-client";
import { useMyMockAttempts } from "@/hooks/use-mock";
import type { StudentAssignmentItem } from "./StudentAssignmentsWidget";
import { buildTodayItems, type TodayItem } from "./today-items";

const ICONS = { resume: PlayCircle, homework: ClipboardList, words: Languages, result: Trophy } as const;

/**
 * "Today" for students: what to do next, built only from real API data (attempts, homework, SRS words).
 * Nothing is invented: with no data the card says so and offers the first real action.
 */
export function TodayCard({ skipResume = false }: { skipResume?: boolean }) {
  const t = useTranslations("today");
  const { data: attempts, isLoading: attemptsLoading } = useMyMockAttempts();
  const homework = useQuery({
    queryKey: ["student", "my-assignments"],
    queryFn: () => api.get<StudentAssignmentItem[]>("/student/my-assignments"),
    staleTime: 60_000,
  });
  const words = useQuery({
    queryKey: ["vocabulary", "srs-stats"],
    queryFn: () => api.get<{ totalWeakWords: number }>("/v1/vocabulary/srs/stats"),
    staleTime: 60_000,
  });

  const loading = attemptsLoading || homework.isLoading || words.isLoading;
  const items = buildTodayItems({
    attempts,
    assignments: homework.data,
    weakWords: words.data?.totalWeakWords,
  }).filter((item) => !(skipResume && item.kind === "resume"));

  const line = (item: TodayItem) => {
    switch (item.kind) {
      case "resume":
        return { title: t("resumeTitle"), detail: item.title };
      case "homework":
        return { title: t("homeworkTitle", { count: item.count }), detail: item.overdue ? t("homeworkOverdue", { count: item.overdue }) : item.nextTitle };
      case "words":
        return { title: t("wordsTitle", { count: item.count }), detail: t("wordsDetail") };
      case "result":
        return { title: item.pending ? t("resultPending") : t("resultReady"), detail: item.title };
    }
  };

  return (
    <Card className="p-4 sm:p-5" aria-labelledby="today-title">
      <div className="mb-3 flex items-center gap-2">
        <BookOpenCheck className="size-5 text-brand" aria-hidden />
        <h2 id="today-title" className="text-subtitle text-fg">{t("title")}</h2>
      </div>
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-[12px] border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-fg-muted">{t("empty")}</p>
          <Link href="/mock" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand hover:underline">
            {t("emptyAction")} <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            const { title, detail } = line(item);
            return (
              <li key={item.kind}>
                <Link href={item.href} className="flex min-h-[56px] items-center gap-3 py-2.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover rounded-[8px] px-1">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand-subtle-fg">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-fg">{title}</span>
                    {detail ? <span className="block truncate text-sm text-fg-muted">{detail}</span> : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
