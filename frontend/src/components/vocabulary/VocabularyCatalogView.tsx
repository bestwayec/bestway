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
import { useQuery } from "@tanstack/react-query";
import type { VocabularyCollection } from "@/lib/group-contract.generated";
import { VocabularyHistory } from "./VocabularyHistory";
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
  canEdit?: boolean;
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
  const te = useTranslations("vocabularyEditor");
  const [isBuilderOpen, setIsBuilderOpen] = React.useState(false);
  const [editSetId, setEditSetId] = React.useState("");
  const editable = useQuery({
    queryKey: ["vocabulary-edit", editSetId],
    queryFn: () => api.get<VocabularyCollection>(`/v1/vocabulary/sets/${encodeURIComponent(editSetId)}`),
    enabled: Boolean(editSetId),
    staleTime: 0,
  });
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
            <div className="rounded-card border border-border bg-surface p-2.5 text-brand">
              <BookA className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-fg">
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
          >
            <Gamepad2 className="mr-2 h-4 w-4" />
            {tc("joinWithPin")}
          </Button>

          {isTeacherOrAdmin && sets.length > 0 && (
            <Button
              type="button"
              onClick={() => setBattleSetId(sets[0].id)}
              variant="outline"
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
              className="bg-brand hover:bg-brand-hover text-brand-fg font-medium"
            >
              <Plus className="mr-2 h-4 w-4" />
              {tc("createSet")}
            </Button>
          )}
        </div>
      </div>

      {/* Daily review: the first thing to do when there are words to review (spaced repetition). */}
      {srsStats && srsStats.totalWeakWords > 0 && (
        <section aria-label={tc("srsTitle")} className="flex flex-col justify-between gap-4 rounded-card border border-border bg-surface p-5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-fg">
              <span>{tc("srsTitle")}</span>
              <Badge variant="neutral" className="shrink-0 whitespace-nowrap px-2 text-xs tabular-nums">
                {tc("srsCount", { count: srsStats.totalWeakWords })}
              </Badge>
            </h2>
            <p className="mt-1 text-sm text-fg-muted">{tc("srsBody")}</p>
          </div>
          <Link href="/vocabulary/srs" className="shrink-0">
            <Button className="w-full bg-brand font-semibold text-brand-fg hover:bg-brand-hover sm:w-auto">
              <Sparkles className="mr-2 h-4 w-4" />
              {tc("srsCta")}
            </Button>
          </Link>
        </section>
      )}

      {/* The word game: one calm row, secondary to the word sets. */}
      <section aria-label={tc("runnerTitle")} className="flex flex-col justify-between gap-4 rounded-card border border-border bg-bg-subtle p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="min-w-0">
          <p className="text-sm text-fg-muted">{tc("runnerBadge")}</p>
          <h2 className="text-lg font-semibold text-fg">{tc("runnerTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{tc("runnerBody")}</p>
        </div>
        <Link href="/vocabulary/runner" className="shrink-0">
          <Button variant="outline" className="w-full sm:w-auto">
            <Gamepad2 className="mr-2 h-4 w-4" />
            <span>{tc("playNow")}</span>
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </section>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Level Pills */}
        <div role="group" aria-label={tc("levelFilter")} className="flex w-full flex-wrap items-center gap-1.5">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              aria-pressed={selectedLevel === lvl}
              onClick={() => setSelectedLevel(lvl)}
              className={`min-h-11 rounded-control px-3.5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-brand ${
                selectedLevel === lvl
                  ? "bg-brand text-brand-fg"
                  : "bg-bg-subtle text-fg-muted hover:bg-bg-subtle/80 hover:text-fg"
              }`}
            >
              {lvl === ALL_LEVELS ? tc("levelAll") : lvl}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-muted" aria-hidden />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tc("searchPlaceholder")}
            aria-label={tc("searchLabel")}
            type="search"
            className="min-h-11 pl-9 text-sm bg-surface"
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
            <div className="space-y-3 rounded-card border border-dashed border-border p-12 text-center text-fg-muted">
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
                    className="group flex flex-col justify-between space-y-5 rounded-card border border-border bg-surface p-5 transition-colors duration-base hover:border-brand/40 sm:p-6"
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
                        <h3 className="text-lg font-semibold text-fg line-clamp-1">
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
                          <Button className="w-full bg-brand hover:bg-brand-hover text-brand-fg font-medium">
                            <Play className="mr-1.5 h-4 w-4" />
                            {tc("startPractice")}
                          </Button>
                        </Link>

                        {isTeacherOrAdmin && s.canEdit && <Button type="button" variant="outline" onClick={() => setEditSetId(s.id)}>{te("edit")}</Button>}
                        {isTeacherOrAdmin && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setBattleSetId(s.id)}
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

      {userRole === "student" && <VocabularyHistory />}

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

      
      {editSetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-surface">
            {editable.isPending && <p className="p-4" role="status">{te("loading")}</p>}
            {editable.isError && <p className="p-4" role="alert">{te("failed")} <Button onClick={() => setEditSetId("")}>{te("cancel")}</Button></p>}
            {editable.data && !editable.isError && <VocabularyBuilder key={editSetId} collection={editable.data}
              onSuccess={() => { setEditSetId(""); void fetchData(); }} onCancel={() => setEditSetId("")} />}
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
