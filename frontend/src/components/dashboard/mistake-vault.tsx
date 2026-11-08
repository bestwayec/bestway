"use client";

import * as React from "react";
import { AlertCircle, ArrowRight, BookOpen, CheckCircle, Flame, Play, RefreshCw, Sparkles, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TargetedPracticeDialog } from "@/components/dashboard/targeted-practice-dialog";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/feedback";
import { useMistakeVault } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";

export interface MistakeCategory {
  id: string;
  name: string;
  skill: "reading" | "listening" | "writing" | "speaking";
  wrongCount: number;
  totalAttempted: number;
  accuracy: number;
  lastTrained?: string;
  recommendedFocus: string;
  videoUrl?: string;
  videoButtonText?: string;
}

export function MistakeVault({ className }: { className?: string }) {
  const t = useTranslations("insights");
  const { data: vaultData, isLoading, isError, refetch } = useMistakeVault();
  const [selectedFilter, setSelectedFilter] = React.useState<"all" | "reading" | "listening">("all");
  
  // Targeted Practice Runner Dialog State
  const [practiceOpen, setPracticeOpen] = React.useState<boolean>(false);
  const [activeCategory, setActiveCategory] = React.useState<MistakeCategory | null>(null);

  // Only the student's own graded answers are shown; there is no demo fallback.
  const categories: MistakeCategory[] = (vaultData?.categories as MistakeCategory[] | undefined) ?? [];

  const filtered = categories.filter(
    (item) => selectedFilter === "all" || item.skill === selectedFilter
  );

  const totalMistakes = categories.reduce((acc, curr) => acc + curr.wrongCount, 0);

  const handleStartReTest = (category: MistakeCategory) => {
    setActiveCategory(category);
    setPracticeOpen(true);
  };

  return (
    <>
      <Card className={cn("border-emerald-500/15 bg-surface/90 text-slate-100 shadow-xl", className)}>
        <CardHeader className="pb-3 border-b border-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                <Target className="size-4 text-emerald-400" />
                Zaif Nuqtalar Banki (Personal Mistake Vault)
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Imtihonlarda yo&apos;l qo&apos;yilgan xatolar asosida shakllangan shaxsiy mashqlar ombori
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="danger" className="border-rose-500/30 bg-rose-950/30 text-rose-300 text-xs py-0.5">
                <Flame className="size-3 mr-1 text-rose-400" />
                {totalMistakes} ta xato savol to&apos;plandi
              </Badge>
            </div>
          </div>

          {/* Skill Filters */}
          <div className="flex items-center gap-1.5 pt-2">
            {(["all", "reading", "listening"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSelectedFilter(filter)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-all capitalize",
                  selectedFilter === filter
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                {filter === "all" ? "Barcha savol turlari" : filter}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-3">
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          ) : isError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg-subtle/40 p-4 text-sm text-fg-muted">
              <span>{t("vaultLoadError")}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
                <RefreshCw className="size-3.5 mr-1" />
                {t("retry")}
              </Button>
            </div>
          ) : categories.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-bg-subtle/40 p-4" data-testid="mistake-vault-empty">
              <CheckCircle className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <p className="text-sm font-semibold text-fg">{t("vaultEmptyTitle")}</p>
                <p className="mt-1 text-xs text-fg-muted">{t("vaultEmptyHint")}</p>
              </div>
            </div>
          ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((cat) => {
              const isCritical = cat.accuracy < 70;

              return (
                <div
                  key={cat.id}
                  className="group relative flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-all hover:border-emerald-500/40 hover:bg-slate-900/80"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                          {cat.name}
                        </h4>
                        <p className="text-[11px] text-slate-400 capitalize">
                          Modul: <span className="text-slate-300 font-medium">{cat.skill}</span>{cat.lastTrained ? <> · {t("lastTrained")}: {cat.lastTrained}</> : null}
                        </p>
                      </div>
                      <Badge
                        variant={isCritical ? "danger" : "warning"}
                        className="text-[10px] shrink-0"
                      >
                        {cat.wrongCount} xato
                      </Badge>
                    </div>

                    {/* Accuracy Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>Aniqlik ko&apos;rsatkichi:</span>
                        <span className={isCritical ? "text-rose-400 font-bold" : "text-amber-400 font-bold"}>
                          {cat.accuracy}% ({cat.totalAttempted - cat.wrongCount}/{cat.totalAttempted})
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={cn("h-full rounded-full transition-all", isCritical ? "bg-rose-500" : "bg-amber-400")}
                          style={{ width: `${cat.accuracy}%` }}
                        />
                      </div>
                    </div>

                    {/* Pedagogical Recommendation */}
                    <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
                      💡 <span className="text-slate-300 font-medium">Tavsiya:</span> {cat.recommendedFocus}
                    </p>
                  </div>

                  {/* Re-test & Video Lesson Routing CTA */}
                  <div className="pt-3 mt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={cat.videoUrl || "/en/videos"}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-all hover:scale-[1.02]"
                    >
                      <Play className="size-3 fill-current" />
                      <span>{cat.videoButtonText || "▶️ Darsni ko'rish"}</span>
                    </a>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleStartReTest(cat)}
                      className="h-8 border-emerald-500/40 text-emerald-400 hover:bg-emerald-600 hover:text-white text-xs font-semibold shadow-sm transition-all"
                    >
                      <Sparkles className="size-3 mr-1" />
                      Bo&apos;shliqlarni yopish (10 ta)
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </CardContent>
      </Card>

      {/* 1-Click Interactive Targeted Practice Runner Dialog */}
      <TargetedPracticeDialog
        open={practiceOpen}
        onOpenChange={setPracticeOpen}
        categoryId={activeCategory?.id ?? null}
        categoryName={activeCategory?.name ?? null}
      />
    </>
  );
}
