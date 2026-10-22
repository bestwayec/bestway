"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  CheckCircle2,
  Flame,
  HelpCircle,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { VocabularyQuizRunner } from "@/components/vocabulary/VocabularyQuizRunner";

export interface SrsWordItem {
  id: string;
  english: string;
  uzbek: string;
  mistakeCount: number;
  correctStreak: number;
  isMastered: boolean;
  lastReviewed: string;
}

export interface SrsStatsResponse {
  totalWeakWords: number;
  totalMasteredWords: number;
  weakWords: SrsWordItem[];
}

export default function VocabularySrsPage() {
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
    } catch (err: any) {
      setErrorMsg(err.message || "SRS ma'lumotlarini yuklab bo'lmadi");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Lug'atlar ro'yxatiga qaytish
          </Button>
        </Link>
      </div>

      {/* SRS Hero Header */}
      <div className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Spaced Repetition System (SRS)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground">
              Mening Xatolar Bankim
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Lug'at testlarida adashgan so'zlaringiz bu yerda to'planadi. Har bir so'zga 2 marta ketma-ket to'g'ri javob bersangiz, u to'liq <strong>O'zlashtirilgan</strong> hisoblanadi.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={fetchStats}
              disabled={isLoading}
              className="border-border text-foreground"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Yangilash
            </Button>

            <Button
              type="button"
              disabled={!stats || stats.totalWeakWords === 0}
              onClick={() => setIsQuizActive(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md shadow-emerald-600/20"
            >
              <Play className="mr-2 h-4 w-4" />
              Xatolar Mashqini Boshlash
            </Button>
          </div>
        </div>

        {/* SRS Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-border pt-6">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold flex items-center justify-between">
                <span>O'rganilayotgan Xatolar</span>
                <Flame className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold text-foreground mt-2">
                {stats.totalWeakWords} ta so'z
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-between">
                <span>O'zlashtirilgan (Mastered)</span>
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
                {stats.totalMasteredWords} ta so'z
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
                <span>Jami Tahlil Qilingan</span>
                <Trophy className="h-4 w-4" />
              </div>
              <p className="text-2xl font-bold text-foreground mt-2">
                {stats.totalWeakWords + stats.totalMasteredWords} ta
              </p>
            </div>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="py-16 text-center text-muted-foreground flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-500" />
          <span>Xatolar banki yuklanmoqda...</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive border border-destructive/20">
          {errorMsg}
        </div>
      )}

      {!isLoading && stats && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-foreground flex items-center justify-between">
            <span>So'zlar Ro'yxati va O'zlashtirish Holati</span>
            <Badge variant="neutral" className="text-xs">
              {stats.weakWords.length} ta so'z
            </Badge>
          </h2>

          {stats.weakWords.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground space-y-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-foreground">Hozircha xatolaringiz yo'q! 🎉</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Barcha topshirilgan testlardagi so'zlar to'liq o'zlashtirilgan. Yangi lug'at to'plamlarini yechib ko'ring!
              </p>
              <Link href="/vocabulary">
                <Button variant="outline" className="mt-2 text-xs">
                  Lug'atlar katalogiga o'tish
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">#</th>
                    <th className="py-2.5 px-4 font-semibold">Inglizcha So'z</th>
                    <th className="py-2.5 px-4 font-semibold">O'zbekcha Tarjimasi</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Xatolar Soni</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Ketma-ket to'g'ri</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Holati</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stats.weakWords.map((w, idx) => (
                    <tr key={w.id} className="hover:bg-muted/50 transition-colors">
                      <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">{idx + 1}</td>
                      <td className="py-2.5 px-4 font-bold text-foreground">{w.english}</td>
                      <td className="py-2.5 px-4 text-emerald-600 dark:text-emerald-400 font-medium">
                        {w.uzbek}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant="danger" className="h-5 px-2 text-xs">
                          {w.mistakeCount} marta
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs">
                        {w.correctStreak} / 2
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {w.isMastered ? (
                          <Badge variant="success" className="text-xs">
                            O'zlashtirildi ✅
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-xs">
                            O'rganilmoqda ⏳
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
