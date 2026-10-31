"use client";

import * as React from "react";
import {
  AlertTriangle,
  Award,
  BookA,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { VocabularyBuilder } from "@/components/teacher/VocabularyBuilder";
import { VocabularyGroupReport } from "@/components/teacher/VocabularyGroupReport";
import { VocabBattleHost } from "@/components/vocabulary/VocabBattleHost";
import { VocabBattlePlayer } from "@/components/vocabulary/VocabBattlePlayer";
import { Gamepad2, Zap } from "lucide-react";

export interface VocabularySetSummary {
  id: string;
  title: string;
  description?: string;
  level: string;
  groupId?: string | null;
  groupName?: string | null;
  createdById?: string;
  createdByName?: string;
  wordCount: number;
  createdAt: string;
  userLastScore?: number | null;
  userBestPercentage?: number | null;
}

export interface SrsStats {
  totalWeakWords: number;
  totalMasteredWords: number;
  weakWords: any[];
}

const LEVELS = ["Hammasi", "A1", "A2", "B1", "B2", "C1", "C2", "IELTS", "MULTILEVEL"];

export function VocabularyCatalogView({ userRole = "student" }: { userRole?: string }) {
  const [sets, setSets] = React.useState<VocabularySetSummary[]>([]);
  const [srsStats, setSrsStats] = React.useState<SrsStats | null>(null);
  const [selectedLevel, setSelectedLevel] = React.useState("Hammasi");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Modal states
  const [isBuilderOpen, setIsBuilderOpen] = React.useState(false);
  const [reportSetId, setReportSetId] = React.useState<string | null>(null);
  const [battleSetId, setBattleSetId] = React.useState<string | null>(null);
  const [isPlayerBattleOpen, setIsPlayerBattleOpen] = React.useState(false);

  const isTeacherOrAdmin = ["teacher", "admin", "super_admin"].includes(userRole);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [setsRes, statsRes] = await Promise.allSettled([
        api.get<VocabularySetSummary[]>("/v1/vocabulary/sets"),
        api.get<SrsStats>("/v1/vocabulary/srs/stats"),
      ]);

      if (setsRes.status === "fulfilled") {
        setSets(setsRes.value || []);
      }
      if (statsRes.status === "fulfilled") {
        setSrsStats(statsRes.value || null);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Lug'atlar ro'yxatini yuklab bo'lmadi");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredSets = React.useMemo(() => {
    return sets.filter((s) => {
      const matchesLevel = selectedLevel === "Hammasi" || s.level === selectedLevel;
      const matchesSearch =
        !searchQuery.trim() ||
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesLevel && matchesSearch;
    });
  }, [sets, selectedLevel, searchQuery]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12 sm:pb-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
              <BookA className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                Lug'at Boyligi va So'z Mashqlari
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Mavzulashtirilgan leksika, audio talaffuz, SRS xatolar banki va +5 ballik gamifikatsiya
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsPlayerBattleOpen(true)}
            className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
          >
            <Gamepad2 className="mr-2 h-4 w-4" />
            PIN Bilan Kirish
          </Button>

          {isTeacherOrAdmin && sets.length > 0 && (
            <Button
              type="button"
              onClick={() => setBattleSetId(sets[0].id)}
              className="bg-amber-600 hover:bg-amber-500 text-white font-medium shadow-md shadow-amber-600/20"
            >
              <Zap className="mr-2 h-4 w-4" />
              Live Vocab Battle
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={fetchData}
            disabled={isLoading}
            className="border-border text-foreground"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Yangilash
          </Button>

          {isTeacherOrAdmin && (
            <Button
              type="button"
              onClick={() => setIsBuilderOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-600/20"
            >
              <Plus className="mr-2 h-4 w-4" />
              Yangi Lug'at Yaratish
            </Button>
          )}
        </div>
      </div>

      {/* Subway Vocab Runner Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-950/40 via-[#0B0F17] to-emerald-900/20 p-6 md:p-7 shadow-xl shadow-emerald-950/20">
        <div className="absolute -right-10 -bottom-10 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <Zap className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
              <span>Yangi 3D Gamifikatsiya • Subway Vocab Runner</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              ⚡️ Subway Vocab Runner — So'zlarni yugurib o'rganing!
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              3 yo'lakli dinamik yugurish trassasi, 60 FPS silliq harakat, CEFR (A1–C1) so'z boyligi, Irregular Verbs va kollokatsiyalar! To'g'ri darvozani tanlang, xavfli to'siqlardan sakrab o'ting va o'z rekordingizni o'rnating.
            </p>
          </div>

          <div className="shrink-0 flex items-center">
            <Link href="/vocabulary/runner">
              <Button
                size="lg"
                className="bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/25 transition-transform hover:scale-[1.03] active:scale-[0.98] flex items-center gap-2"
              >
                <Gamepad2 className="h-5 w-5" />
                <span>Hoziroq O'ynash</span>
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* SRS Quick Alert Banner (if user has weak words) */}
      {srsStats && srsStats.totalWeakWords > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-card to-emerald-500/10 p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500/20 text-amber-500 shrink-0">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <span>Shaxsiy Xatolar Banki (SRS)</span>
                <Badge variant="danger" className="h-5 px-2 text-xs">
                  {srsStats.totalWeakWords} ta xato
                </Badge>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Oldingi testlarda xato qilingan so'zlaringiz saqlangan. Ular ustida mashq qilib, 2 marta ketma-ket to'g'ri topshirib o'zlashtiring!
              </p>
            </div>
          </div>

          <Link href="/vocabulary/srs">
            <Button className="bg-amber-600 hover:bg-amber-500 text-white font-semibold shrink-0 shadow-md shadow-amber-600/20">
              <Sparkles className="mr-2 h-4 w-4" />
              Xatolar Ustida Ishlash
            </Button>
          </Link>
        </div>
      )}

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Level Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0 scrollbar-none">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              onClick={() => setSelectedLevel(lvl)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedLevel === lvl
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Lug'at nomidan qidirish..."
            className="pl-9 h-9 text-xs bg-card"
          />
        </div>
      </div>

      {/* Loading & Error States */}
      {isLoading && (
        <div className="py-20 text-center text-muted-foreground flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-500" />
          <span>Lug'at to'plamlari yuklanmoqda...</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive border border-destructive/20">
          {errorMsg}
        </div>
      )}

      {/* Sets Grid */}
      {!isLoading && (
        <>
          {filteredSets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground space-y-3">
              <BookOpen className="h-10 w-10 text-muted-foreground/60 mx-auto" />
              <h3 className="text-base font-semibold text-foreground">Lug'at to'plamlari topilmadi</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Tanlangan darajada yoki qidiruv bo'yicha hech narsa topilmadi.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredSets.map((s) => {
                const hasScore = s.userBestPercentage !== null && s.userBestPercentage !== undefined;
                return (
                  <div
                    key={s.id}
                    className="group rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-xl hover:border-emerald-500/40 transition-all duration-300 flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge className="bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono text-xs">
                          {s.level}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          {s.wordCount} ta so'z
                        </span>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors line-clamp-1">
                          {s.title}
                        </h3>
                        {s.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                            {s.description}
                          </p>
                        )}
                      </div>

                      {s.groupName && (
                        <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-md">
                          <Layers className="h-3 w-3" />
                          <span>Guruh: {s.groupName}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 border-t border-border pt-4">
                      {hasScore ? (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Eng yaxshi natijangiz:</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {s.userBestPercentage}%
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Hali topshirilmagan (+5 ball kutilmoqda)
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Link href={`/vocabulary/${s.id}`} className="flex-1">
                          <Button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm">
                            <Play className="mr-1.5 h-4 w-4" />
                            Mashqni Boshlash
                          </Button>
                        </Link>

                        {isTeacherOrAdmin && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setBattleSetId(s.id)}
                              className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                              title="Ushbu to'plam bo'yicha Live Battle (PIN) ochish"
                            >
                              <Zap className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setReportSetId(s.id)}
                              className="border-border text-foreground hover:bg-muted"
                              title="Guruh hisoboti va Excel"
                            >
                              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Teacher Vocabulary Builder Modal */}
      {isBuilderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-3xl my-8">
            <VocabularyBuilder
              onSuccess={(created) => {
                setIsBuilderOpen(false);
                fetchData();
              }}
              onCancel={() => setIsBuilderOpen(false)}
            />
          </div>
        </div>
      )}

      
      {/* Live Vocab Battle Host Modal */}
      {battleSetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-4xl my-8">
            <VocabBattleHost
              setId={battleSetId}
              onClose={() => setBattleSetId(null)}
            />
          </div>
        </div>
      )}

      {/* Live Vocab Battle Player Modal */}
      {isPlayerBattleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-md my-8">
            <VocabBattlePlayer
              onClose={() => setIsPlayerBattleOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Teacher Group Report Modal */}
      {reportSetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-4xl my-8">
            <VocabularyGroupReport
              setId={reportSetId}
              onClose={() => setReportSetId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
