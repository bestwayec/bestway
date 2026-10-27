"use client";

import * as React from "react";
import { AlertCircle, ArrowRight, BookOpen, CheckCircle, Flame, Play, RefreshCw, Sparkles, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TargetedPracticeDialog } from "@/components/dashboard/targeted-practice-dialog";
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

const DEFAULT_MISTAKE_VAULT: MistakeCategory[] = [
  {
    id: "tfng",
    name: "True / False / Not Given",
    skill: "reading",
    wrongCount: 8,
    totalAttempted: 24,
    accuracy: 66,
    lastTrained: "2 kun oldin",
    recommendedFocus: "Matnda to'g'ridan-to'g'ri berilmagan ma'lumotlarni taxmin qilmaslik (Not Given vs False).",
    videoUrl: "/en/videos?lesson=lesson-29",
    videoButtonText: "▶️ 29-dars: Linking Words",
  },
  {
    id: "headings",
    name: "Headings Matching",
    skill: "reading",
    wrongCount: 5,
    totalAttempted: 18,
    accuracy: 72,
    lastTrained: "Kecha",
    recommendedFocus: "Paragrafning birinchi va oxirgi jumlalariga emas, umumiy g'oyasiga e'tibor qaratish.",
    videoUrl: "/en/videos?lesson=lesson-26",
    videoButtonText: "▶️ 26-dars: Relative Clauses",
  },
  {
    id: "info-matching",
    name: "Information Matching & Multiple Choice",
    skill: "listening",
    wrongCount: 7,
    totalAttempted: 20,
    accuracy: 65,
    lastTrained: "3 kun oldin",
    recommendedFocus: "Spikerning fikrini o'zgartiruvchi 'However', 'Actually' kabi signallarni payqash.",
    videoUrl: "/en/videos?lesson=lesson-13",
    videoButtonText: "▶️ 13-dars: Reported Speech",
  },
  {
    id: "summary",
    name: "Summary & Sentence Completion",
    skill: "reading",
    wrongCount: 4,
    totalAttempted: 22,
    accuracy: 81,
    lastTrained: "Bugun",
    recommendedFocus: "Grammatik shakl (ot, fe'l, sifat) va so'z chegarasi (NO MORE THAN TWO WORDS) qoidasi.",
    videoUrl: "/en/videos?lesson=lesson-1",
    videoButtonText: "▶️ 1-dars: Nouns (Otlar)",
  },
];

export function MistakeVault({ className }: { className?: string }) {
  const { data: vaultData } = useMistakeVault();
  const [selectedFilter, setSelectedFilter] = React.useState<"all" | "reading" | "listening">("all");
  
  // Targeted Practice Runner Dialog State
  const [practiceOpen, setPracticeOpen] = React.useState<boolean>(false);
  const [activeCategory, setActiveCategory] = React.useState<MistakeCategory | null>(null);

  const categories: MistakeCategory[] = (vaultData?.categories as MistakeCategory[]) || DEFAULT_MISTAKE_VAULT;

  const filtered = categories.filter(
    (item) => selectedFilter === "all" || item.skill === selectedFilter
  );

  const totalMistakes = vaultData?.totalMistakes ?? categories.reduce((acc, curr) => acc + curr.wrongCount, 0);

  const handleStartReTest = (category: MistakeCategory) => {
    setActiveCategory(category);
    setPracticeOpen(true);
  };

  return (
    <>
      <Card className={cn("border-emerald-500/15 bg-[#111827]/90 text-slate-100 shadow-xl", className)}>
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
                          Modul: <span className="text-slate-300 font-medium">{cat.skill}</span> · Oxirgi mashq: {cat.lastTrained ?? "Yaqinda"}
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
