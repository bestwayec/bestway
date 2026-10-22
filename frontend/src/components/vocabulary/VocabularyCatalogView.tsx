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
    <div className="space-y-8 max-w-7xl mx-auto">
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
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setReportSetId(s.id)}
                            className="border-border text-foreground hover:bg-muted"
                            title="Guruh hisoboti va Excel"
                          >
                            <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                          </Button>
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
