"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CheckCircle2,
  Flame,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { VocabularyHistory } from "@/components/vocabulary/VocabularyHistory";
import { VocabularyQuizRunner } from "@/components/vocabulary/VocabularyQuizRunner";

export interface SrsWordItem {
  id: string;
  english: string;
  uzbek: string;
  mistakeCount: number;
  correctStreak: number;
  isMastered: boolean;
  lastReviewed: string;
  nextReviewAt?: string | null;
  intervalDays?: number;
}

export interface SrsStatsResponse {
  totalWeakWords: number;
  totalDueWords: number;
  totalMasteredWords: number;
  weakWords: SrsWordItem[];
}

export default function VocabularySrsPage() {
  const t = useTranslations("vocabulary");
  const ts = useTranslations("vocabulary.srs");
  const th = useTranslations("vocabularyHistory");
  const [stats, setStats] = React.useState<SrsStatsResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [isQuizActive, setIsQuizActive] = React.useState(false);

  const fetchStats = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.get<SrsStatsResponse>("/v1/vocabulary/srs/stats");
      setStats(data);
    } catch {
      setErrorMsg(ts("loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [ts]);

  React.useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (isQuizActive) {
    return (
      <div className="max-w-4xl mx-auto py-4">
        <VocabularyQuizRunner
          isSrs={true}
          onFinish={() => {
            fetchStats();
          }}
          onExit={() => {
            setIsQuizActive(false);
            fetchStats();
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      {/* Back button */}
      <div>
        <Link href="/vocabulary">
          <Button variant="ghost" size="sm" className="text-fg-muted hover:text-fg">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToCatalog")}
          </Button>
        </Link>
      </div>

      {/* SRS Hero Header */}
      <div className="space-y-6 rounded-card border border-border bg-surface p-5 sm:p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-2 text-sm text-fg-muted">
              <Sparkles className="h-4 w-4" aria-hidden />
              <span>{ts("badge")}</span>
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-fg">
              {ts("title")}
            </h1>
            <p className="text-sm text-fg-muted max-w-xl">
              {ts("intro")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={fetchStats}
              disabled={isLoading}
              className="border-border text-fg"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>

            <Button
              type="button"
              disabled={!stats || stats.totalDueWords === 0}
              onClick={() => setIsQuizActive(true)}
              className="bg-brand font-semibold text-brand-fg hover:bg-brand-hover"
            >
              <Play className="mr-2 h-4 w-4" />
              {ts("start")}
            </Button>
          </div>
        </div>

        {/* The number that matters first is what is due now; the rest is context. Neutral tiles, status colour only for status. */}
        {stats && (
          <div className="border-t border-border pt-6">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="srs-stats">
              <div className="col-span-2 rounded-card border border-brand/40 bg-brand-subtle p-4 sm:col-span-1">
                <dt className="flex items-center justify-between text-sm font-medium text-brand-subtle-fg">
                  <span>{ts("statDue")}</span>
                  <Flame className="h-4 w-4" aria-hidden />
                </dt>
                <dd className="mt-2 text-2xl font-bold tabular-nums text-fg">{t("words", { count: stats.totalDueWords })}</dd>
              </div>
              <div className="rounded-card border border-border bg-surface p-4">
                <dt className="flex items-center justify-between text-sm font-medium text-fg-muted">
                  <span>{ts("statLearning")}</span>
                </dt>
                <dd className="mt-2 text-2xl font-bold tabular-nums text-fg">{t("words", { count: stats.totalWeakWords })}</dd>
              </div>
              <div className="rounded-card border border-border bg-surface p-4">
                <dt className="flex items-center justify-between text-sm font-medium text-fg-muted">
                  <span>{ts("statMastered")}</span>
                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                </dt>
                <dd className="mt-2 text-2xl font-bold tabular-nums text-fg">{t("words", { count: stats.totalMasteredWords })}</dd>
              </div>
              <div className="col-span-2 rounded-card border border-border bg-surface p-4 sm:col-span-1">
                <dt className="flex items-center justify-between text-sm font-medium text-fg-muted">
                  <span>{ts("statTotal")}</span>
                  <Trophy className="h-4 w-4" aria-hidden />
                </dt>
                <dd className="mt-2 text-2xl font-bold tabular-nums text-fg">{t("words", { count: stats.totalWeakWords + stats.totalMasteredWords })}</dd>
              </div>
            </dl>
            {stats.totalDueWords === 0 && <p className="mt-3 text-sm text-fg-muted" data-testid="srs-none-due">{ts("noneDue")}</p>}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="py-16 text-center text-fg-muted flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-brand" />
          <span>{ts("loading")}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-danger/10 p-4 text-sm text-danger border border-danger/20">
          {errorMsg}
        </div>
      )}

      {!isLoading && stats && (
        <div className="space-y-4 rounded-card border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-base font-bold text-fg flex items-center justify-between">
            <span>{ts("listTitle")}</span>
            <Badge variant="neutral" className="text-xs">
              {stats.weakWords.length < stats.totalWeakWords + stats.totalMasteredWords
                ? ts("shownOfTotal", { shown: stats.weakWords.length, total: stats.totalWeakWords + stats.totalMasteredWords })
                : t("words", { count: stats.weakWords.length })}
            </Badge>
          </h2>

          {stats.weakWords.length === 0 ? (
            <div className="space-y-3 rounded-card border border-dashed border-border p-12 text-center text-fg-muted">
              <CheckCircle2 className="h-12 w-12 text-brand mx-auto" />
              <h3 className="text-base font-bold text-fg">{ts("emptyTitle")}</h3>
              <p className="text-xs text-fg-muted max-w-sm mx-auto">
                {ts("emptyBody")}
              </p>
              <Link href="/vocabulary">
                <Button variant="outline" className="mt-2 text-xs">
                  {ts("goCatalog")}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-subtle text-sm text-fg-muted">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">#</th>
                    <th className="py-2.5 px-4 font-semibold">{ts("colEnglish")}</th>
                    <th className="py-2.5 px-4 font-semibold">{ts("colUzbek")}</th>
                    <th className="py-2.5 px-4 font-semibold text-center">{ts("colMistakes")}</th>
                    <th className="py-2.5 px-4 font-semibold text-center">{ts("colStreak")}</th>
                    <th className="py-2.5 px-4 font-semibold text-right">{ts("colStatus")}</th>
                    <th className="py-2.5 px-4 font-semibold">{th("nextDue")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.weakWords.map((w, idx) => (
                    <tr key={w.id} className="hover:bg-bg-subtle/50 transition-colors">
                      <td className="py-2.5 px-4 text-fg-muted font-mono text-xs">{idx + 1}</td>
                      <td className="px-4 py-2.5 font-semibold text-fg">{w.english}</td>
                      <td className="px-4 py-2.5 font-medium text-fg-muted">
                        {w.uzbek}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant="neutral" className="h-5 px-2 text-xs tabular-nums">
                          {ts("times", { count: w.mistakeCount })}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs">
                        {w.correctStreak}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {w.isMastered ? (
                          <Badge variant="success" className="text-xs">
                            {ts("mastered")}
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-xs">
                            {ts("learning")}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        {w.nextReviewAt ? new Date(w.nextReviewAt).toLocaleString() : w.isMastered ? "—" : th("due")}
                        {w.intervalDays ? ` · ${th("interval", { days: w.intervalDays })}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <VocabularyHistory review />
    </div>
  );
}
