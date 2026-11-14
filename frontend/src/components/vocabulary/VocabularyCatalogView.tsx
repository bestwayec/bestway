"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BookA,
  BookOpen,
  ChevronRight,
  FileSpreadsheet,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
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

const ALL_LEVELS = "ALL";
const LEVELS = [ALL_LEVELS, "A1", "A2", "B1", "B2", "C1", "C2", "IELTS", "MULTILEVEL"];

export function VocabularyCatalogView({ userRole = "student" }: { userRole?: string }) {
  const t = useTranslations("vocabulary");
  const tc = useTranslations("vocabulary.catalog");
  const [sets, setSets] = React.useState<VocabularySetSummary[]>([]);
  const [srsStats, setSrsStats] = React.useState<SrsStats | null>(null);
  const [selectedLevel, setSelectedLevel] = React.useState(ALL_LEVELS);
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
      } else {
        // Without this the page said "no vocabulary sets found" when the request failed.
        setErrorMsg(tc("loadFailed"));
      }
      if (statsRes.status === "fulfilled") {
        setSrsStats(statsRes.value || null);
      }
    } catch {
      setErrorMsg(tc("loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [tc]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredSets = React.useMemo(() => {
    return sets.filter((s) => {
      const matchesLevel = selectedLevel === ALL_LEVELS || s.level === selectedLevel;
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
            <div className="p-2.5 rounded-xl bg-brand/10 border border-brand/20 text-brand-subtle-fg">
              <BookA className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-fg tracking-tight">
                {tc("title")}
              </h1>
              <p className="text-sm text-fg-muted mt-0.5">
                {tc("subtitle")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsPlayerBattleOpen(true)}
            className="border-warning/30 text-warning hover:bg-warning/10"
          >
            <Gamepad2 className="mr-2 h-4 w-4" />
            {tc("joinWithPin")}
          </Button>

          {isTeacherOrAdmin && sets.length > 0 && (
            <Button
              type="button"
              onClick={() => setBattleSetId(sets[0].id)}
              variant="outline"
              className="border-warning-border bg-warning-bg text-warning hover:bg-warning/15 font-medium"
            >
              <Zap className="mr-2 h-4 w-4" />
              {tc("liveBattle")}
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={fetchData}
            disabled={isLoading}
            className="border-border text-fg"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>

          {isTeacherOrAdmin && (
            <Button
              type="button"
              onClick={() => setIsBuilderOpen(true)}
              className="bg-brand hover:bg-brand-hover text-brand-fg font-medium shadow-md shadow-brand/20"
            >
              <Plus className="mr-2 h-4 w-4" />
              {tc("createSet")}
            </Button>
          )}
        </div>
      </div>

      {/* Subway Vocab Runner Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-r from-brand-subtle/40 via-bg-subtle to-brand-subtle/20 p-6 md:p-7 shadow-xl shadow-brand/30">
        <div className="absolute -right-10 -bottom-10 h-44 w-44 rounded-full bg-brand/10 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-subtle-fg">
              <Zap className="h-3.5 w-3.5 text-brand animate-pulse" />
              <span>{tc("runnerBadge")}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-fg tracking-tight flex items-center gap-2">
              {tc("runnerTitle")}
            </h2>
            <p className="text-xs sm:text-sm text-fg-muted leading-relaxed">
              {tc("runnerBody")}
            </p>
          </div>

          <div className="shrink-0 flex items-center">
            <Link href="/vocabulary/runner">
              <Button
                size="lg"
                className="bg-brand hover:bg-brand-hover text-brand-fg font-extrabold px-6 py-3 rounded-xl shadow-lg shadow-brand/25 transition-transform hover:scale-[1.03] active:scale-[0.98] flex items-center gap-2"
              >
                <Gamepad2 className="h-5 w-5" />
                <span>{tc("playNow")}</span>
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* SRS Quick Alert Banner (if user has weak words) */}
      {srsStats && srsStats.totalWeakWords > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-gradient-to-r from-warning/10 via-surface to-brand/10 p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-warning/20 text-warning shrink-0">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-fg flex flex-wrap items-center gap-2">
                <span>{tc("srsTitle")}</span>
                <Badge variant="danger" className="shrink-0 whitespace-nowrap px-2 text-xs">
                  {tc("srsCount", { count: srsStats.totalWeakWords })}
                </Badge>
              </h3>
              <p className="text-xs text-fg-muted mt-0.5">
                {tc("srsBody")}
              </p>
            </div>
          </div>

          <Link href="/vocabulary/srs">
            <Button variant="outline" className="border-warning-border bg-warning-bg text-warning hover:bg-warning/15 font-semibold shrink-0">
              <Sparkles className="mr-2 h-4 w-4" />
              {tc("srsCta")}
            </Button>
          </Link>
        </div>
      )}

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Level Pills */}
        <div role="group" aria-label={tc("levelFilter")} className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0 scrollbar-none">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              aria-pressed={selectedLevel === lvl}
              onClick={() => setSelectedLevel(lvl)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedLevel === lvl
                  ? "bg-brand text-brand-fg shadow-md shadow-brand/25"
                  : "bg-bg-subtle text-fg-muted hover:bg-bg-subtle/80 hover:text-fg"
              }`}
            >
              {lvl === ALL_LEVELS ? tc("levelAll") : lvl}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tc("searchPlaceholder")}
            aria-label={tc("searchLabel")}
            type="search"
            className="pl-9 h-9 text-xs bg-surface"
          />
        </div>
      </div>

      {/* Loading & Error States */}
      {isLoading && (
        <div className="py-20 text-center text-fg-muted flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-brand" />
          <span>{tc("loading")}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-danger/10 p-4 text-sm text-danger border border-danger/20">
          {errorMsg}
        </div>
      )}

      {/* Sets Grid */}
      {!isLoading && !errorMsg && (
        <>
          {filteredSets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-fg-muted space-y-3">
              <BookOpen className="h-10 w-10 text-fg-muted/60 mx-auto" />
              <h3 className="text-base font-semibold text-fg">{tc("emptyTitle")}</h3>
              <p className="text-xs text-fg-muted max-w-sm mx-auto">
                {sets.length === 0 ? tc("emptyNone") : tc("emptyBody")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredSets.map((s) => {
                const hasScore = s.userBestPercentage !== null && s.userBestPercentage !== undefined;
                return (
                  <div
                    key={s.id}
                    className="group rounded-2xl border border-border bg-surface p-6 shadow-sm hover:shadow-xl hover:border-brand/40 transition-all duration-300 flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge className="bg-brand/10 text-brand-subtle-fg border border-brand/20 font-mono text-xs">
                          {s.level}
                        </Badge>
                        <span className="text-xs text-fg-muted font-mono">
                          {t("words", { count: s.wordCount })}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-fg group-hover:text-brand transition-colors line-clamp-1">
                          {s.title}
                        </h3>
                        {s.description && (
                          <p className="text-xs text-fg-muted mt-1 line-clamp-2 leading-relaxed">
                            {s.description}
                          </p>
                        )}
                      </div>

                      {s.groupName && (
                        <div className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted bg-bg-subtle/50 px-2.5 py-1 rounded-md">
                          <Layers className="h-3 w-3" />
                          <span>{tc("group", { name: s.groupName })}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 border-t border-border pt-4">
                      {hasScore ? (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-fg-muted">{tc("bestScore")}</span>
                          <span className="font-bold text-brand">
                            {s.userBestPercentage}%
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-fg-muted">
                          {userRole === "student" ? tc("notTakenPoints") : tc("notTaken")}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Link href={`/vocabulary/${s.id}`} className="flex-1">
                          <Button className="w-full bg-brand hover:bg-brand-hover text-brand-fg font-medium shadow-sm">
                            <Play className="mr-1.5 h-4 w-4" />
                            {tc("startPractice")}
                          </Button>
                        </Link>

                        {isTeacherOrAdmin && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setBattleSetId(s.id)}
                              className="border-warning/30 text-warning hover:bg-warning/10"
                              title={tc("battleForSet")}
                              aria-label={tc("battleForSet")}
                            >
                              <Zap className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setReportSetId(s.id)}
                              className="border-border text-fg hover:bg-bg-subtle"
                              title={tc("groupReport")}
                              aria-label={tc("groupReport")}
                            >
                              <FileSpreadsheet className="h-4 w-4 text-brand" />
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
              onSuccess={() => {
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
