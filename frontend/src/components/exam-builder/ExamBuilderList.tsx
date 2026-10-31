"use client";

import * as React from "react";
import { Copy, Eye, FilePlus2, FileUp, Globe, Pencil, Plus, Search, Trash2, X, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { PreviewDialog } from "@/components/exam-builder/PreviewDialog";
import { ConfirmDialog } from "@/components/exam-builder/ConfirmDialog";
import { JsonImportDialog } from "@/components/exam-builder/JsonImportDialog";
import { ExamQuestionsEditorDialog } from "@/components/exam-builder/ExamQuestionsEditorDialog";
import { Sparkles } from "lucide-react";
import {
  useCloneMockExam,
  useDeleteMockExam,
  useMockExams,
  useUpdateMockExamAny,
} from "@/hooks/use-mock";
import { useMe } from "@/hooks/use-me";
import { api, ApiError } from "@/lib/api-client";
import { BulkQuestionImporterModal } from "./BulkQuestionImporterModal";
import type { ParsedQuestionItem } from "./bulk-question-parser";
import type { MockExamListItem, MockExamType } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { EXAM_TYPE_LABEL, EXAM_TYPES, tx } from "./types";

type StatusTab = "all" | "drafts" | "published";

function err(e: unknown, fallback: string): string {
  return e instanceof ApiError ? `${e.message} (${e.code})` : fallback;
}

/** Exams needing content — derived from real list counts, never guessed readiness. */
function needsContent(e: MockExamListItem): boolean {
  return e.skills.length === 0 || e.questionCount === 0;
}

/**
 * Single admin exam-management surface: dense table over the real
 * GET /mock/exams payload (no pagination on the endpoint — the whole
 * staff-visible set is fetched once and filtered locally). No archive state
 * exists in the backend, so Draft/Published are the only statuses; delete is
 * permanent and confirmed as such.
 */
export function ExamBuilderList() {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const router = useRouter();
  const [tab, setTab] = React.useState<StatusTab>("all");
  const [typeFilter, setTypeFilter] = React.useState<"all" | MockExamType>("all");
  const [levelFilter, setLevelFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MockExamListItem | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [quickEditTarget, setQuickEditTarget] = React.useState<MockExamListItem | null>(null);
  const [bulkImportTarget, setBulkImportTarget] = React.useState<MockExamListItem | null>(null);

  const handleDirectBulkImport = async (
    questions: ParsedQuestionItem[],
    targetSkill: "reading" | "listening",
  ) => {
    if (!bulkImportTarget) return;
    try {
      const payload: Record<string, any> = {
        [targetSkill]: questions.map((q) => ({
          prompt: q.prompt.trim(),
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: 1,
        })),
      };
      await api.post(`/mock/exams/${bulkImportTarget.id}/quick-content`, payload);
      toast.success(
        `${questions.length} ta savol “${bulkImportTarget.title}” (${targetSkill}) ga muvaffaqiyatli saqlandi!`,
      );
      setBulkImportTarget(null);
      examsQ.refetch();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Savollarni saqlashda xatolik yuz berdi";
      toast.error(msg);
    }
  };
  const examsQ = useMockExams();
  const clone = useCloneMockExam();
  const del = useDeleteMockExam();
  const updateExam = useUpdateMockExamAny();

  function handleTogglePublish(e: MockExamListItem) {
    const nextState = !e.isPublished;
    updateExam.mutate(
      { id: e.id, input: { isPublished: nextState } },
      {
        onSuccess: () => {
          toast.success(
            nextState
              ? "Exam published — now visible on Dashboard and Exams"
              : "Exam unpublished — moved to Drafts",
          );
        },
        onError: (err) => {
          toast.error(
            err instanceof ApiError ? err.message : "Failed to update publish status",
          );
        },
      },
    );
  }
  const { data: me } = useMe();
  const canDelete =
    me?.user.role === "teacher" ||
    me?.user.role === "admin" ||
    me?.user.role === "super_admin";

  const all = React.useMemo(() => examsQ.data ?? [], [examsQ.data]);

  const levels = React.useMemo(() => {
    const set = new Set<string>();
    for (const e of all) {
      const lv = e.level?.trim();
      if (lv) set.add(lv);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [all]);

  const items = React.useMemo(() => {
    const byTab =
      tab === "all" ? all : all.filter((e) => (tab === "drafts" ? !e.isPublished : e.isPublished));
    const byType = typeFilter === "all" ? byTab : byTab.filter((e) => e.type === typeFilter);
    const byLevel =
      levelFilter === "all"
        ? byType
        : byType.filter((e) => (e.level?.trim() ?? "") === levelFilter);
    const s = search.trim().toLowerCase();
    if (!s) return byLevel;
    return byLevel.filter((e) =>
      [e.title, e.level ?? "", e.type].join(" ").toLowerCase().includes(s),
    );
  }, [all, tab, typeFilter, levelFilter, search]);

  const counts = React.useMemo(() => {
    return {
      all: all.length,
      drafts: all.filter((e) => !e.isPublished).length,
      published: all.filter((e) => e.isPublished).length,
    };
  }, [all]);

  function clearFilters() {
    setTab("all");
    setTypeFilter("all");
    setLevelFilter("all");
    setSearch("");
  }

  function handleDuplicate(id: string) {
    if (clone.isPending) return;
    clone.mutate(id, {
      onSuccess: (res) => {
        toast.success(tx(t, "duplicatedDraft", "Duplicated as a draft — audio and images are not copied."));
        router.push(`/exam-builder/${res.id}`);
      },
      onError: (e) => toast.error(err(e, tc("unknownError"))),
    });
  }

  return (
    <div>
      <PageHeader
        title={tx(t, "examsTitle", "Exams")}
        description={tx(
          t,
          "examsSubtitle",
          "Drafts and published exams in one place — create, edit, preview, duplicate.",
        )}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (items.length > 0) {
                  setBulkImportTarget(items[0]);
                } else if (all.length > 0) {
                  setBulkImportTarget(all[0]);
                } else {
                  toast.info(tx(t, "emptyHint", "Iltimos, avval imtihon yarating"));
                }
              }}
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-medium"
            >
              <Zap className="size-3.5 mr-1 text-emerald-400" aria-hidden />
              {tx(t, "bulkImportTitle", "⚡️ Tezkor Kiritish (Bulk Paste)")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp aria-hidden />
              {tx(t, "jsonImportTitle", "Import JSON")}
            </Button>
            <Link href="/exam-builder/new">
              <Button
                size="sm"
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold shadow-sm shadow-emerald-500/20"
              >
                <Plus aria-hidden />
                {tx(t, "createExam", "Create Exam")}
              </Button>
            </Link>
          </span>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)} className="w-full sm:w-auto">
          <TabsList className="grid w-full grid-cols-3 sm:flex sm:w-auto">
            <TabsTrigger value="all" className="min-h-9 truncate px-2 text-xs sm:text-sm">
              {tx(t, "tabAll", "All")} ({counts.all})
            </TabsTrigger>
            <TabsTrigger value="drafts" className="min-h-9 truncate px-2 text-xs sm:text-sm">
              {tx(t, "tabDrafts", "Drafts")} ({counts.drafts})
            </TabsTrigger>
            <TabsTrigger value="published" className="min-h-9 truncate px-2 text-xs sm:text-sm">
              {tx(t, "tabPublished", "Published")} ({counts.published})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | MockExamType)}>
            <SelectTrigger className="h-10 w-full min-w-0 sm:w-44" aria-label={tx(t, "filterType", "Filter by type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tx(t, "allTypes", "All types")}</SelectItem>
              {EXAM_TYPES.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {EXAM_TYPE_LABEL[ty]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="h-10 w-full min-w-0 sm:w-40" aria-label={tx(t, "filterLevel", "Filter by level")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tx(t, "allLevels", "All levels")}</SelectItem>
              {levels.map((lv) => (
                <SelectItem key={lv} value={lv}>
                  {lv}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tx(t, "searchExams", "Search by title…")}
          aria-label={tx(t, "searchExams", "Search by title…")}
          className="pl-9 pr-9"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-fg-muted hover:bg-surface-hover"
            aria-label={tx(t, "clearSearch", "Clear search")}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {examsQ.isError ? (
        <ErrorState
          title={tx(t, "examsLoadFailed", "Couldn't load exams.")}
          action={
            <Button variant="outline" size="sm" onClick={() => examsQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : examsQ.isLoading ? (
        <div className="overflow-hidden rounded-[12px] border border-border" aria-label={tx(t, "loading", "Loading")}>
          <div className="space-y-px bg-border/40" role="status">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-none" />
            ))}
          </div>
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={FilePlus2}
          title={tx(t, "createFirst", "Create your first exam.")}
          description={tx(t, "emptyHint", "Create your first exam — it starts as a draft, publish when ready.")}
          action={
            <Link href="/exam-builder/new">
              <Button size="sm">
                <Plus aria-hidden />
                {tx(t, "createExam", "Create Exam")}
              </Button>
            </Link>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Search}
          title={tx(t, "noFilterMatch", "No exams match your filters.")}
          action={
            <Button size="sm" variant="outline" onClick={clearFilters}>
              {tx(t, "clearFilters", "Clear filters")}
            </Button>
          }
        />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {items.map((e) => (
            <article key={e.id} className="min-w-0 rounded-[12px] border border-border bg-surface p-3">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg" title={e.title}>
                    {e.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {EXAM_TYPE_LABEL[e.type]} · {e.level?.trim() || "—"}
                  </p>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={e.isPublished ? "success" : "warning"}>
                    {e.isPublished ? tx(t, "published", "Published") : tx(t, "draft", "Draft")}
                  </Badge>
                  {e.imported && (
                    <Badge variant="info" title={`${e.imported.packageId} · r${e.imported.revision}`}>
                      {tx(t, "aiImported", "AI imported")}
                    </Badge>
                  )}
                  {needsContent(e) && (
                    <Badge variant="warning">{tx(t, "needsContent", "Needs content")}</Badge>
                  )}
                </span>
              </div>
              <p className="mt-2 text-xs text-fg-muted tabular-nums">
                {e.skills.length} {tx(t, "sections", "sections")} · {e.questionCount}{" "}
                {tx(t, "questions", "questions")}
                {e.durationMinutes != null && <span> · {e.durationMinutes} min</span>}
                <span> · {e.price > 0 ? formatMoney(e.price) : tx(t, "free", "Free")}</span>
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant={e.isPublished ? "outline" : "primary"}
                  className={e.isPublished ? "min-h-9 w-full justify-center text-xs" : "min-h-9 w-full justify-center text-xs bg-emerald-600 hover:bg-emerald-500 text-white"}
                  loading={updateExam.isPending && updateExam.variables?.id === e.id}
                  onClick={() => handleTogglePublish(e)}
                  title={e.isPublished ? tx(t, "unpublish", "Unpublish") : tx(t, "publish", "Publish")}
                >
                  <Globe className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{e.isPublished ? tx(t, "unpublish", "Unpublish") : tx(t, "publish", "Publish")}</span>
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  className="min-h-9 w-full justify-center text-xs border border-emerald-600/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50"
                  onClick={() => setQuickEditTarget(e)}
                  title={tx(t, "questionsTitle", "Questions")}
                >
                  <Sparkles className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
                  <span className="truncate">{tx(t, "questionsTitle", "Questions")}</span>
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  className="min-h-9 w-full justify-center text-xs border border-emerald-500/30 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-900/40"
                  onClick={() => setBulkImportTarget(e)}
                  title={tx(t, "bulkImportTitle", "⚡️ Tezkor Kiritish (Bulk Paste)")}
                >
                  <Zap className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
                  <span className="truncate">Bulk Paste</span>
                </Button>
                <Link href={`/exam-builder/${e.id}`} className="min-w-0">
                  <Button
                    size="sm"
                    aria-label={`${tx(t, "edit", "Edit")} — ${e.title}`}
                    className="min-h-9 w-full justify-center bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                  >
                    <Pencil className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{tx(t, "edit", "Edit")}</span>
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewId(e.id)}
                  aria-label={`${tx(t, "preview", "Preview")} — ${e.title}`}
                  className="min-h-9 w-full justify-center"
                >
                  <Eye className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{tx(t, "preview", "Preview")}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={`${tx(t, "duplicate", "Duplicate")} — ${e.title}`}
                  aria-label={`${tx(t, "duplicate", "Duplicate")} — ${e.title}`}
                  loading={clone.isPending && clone.variables === e.id}
                  onClick={() => handleDuplicate(e.id)}
                  className="min-h-9 w-full justify-center"
                >
                  <Copy className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{tx(t, "duplicate", "Duplicate")}</span>
                </Button>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title={`${tc("delete")} — ${e.title}`}
                    aria-label={`${tc("delete")} — ${e.title}`}
                    loading={del.isPending && del.variables === e.id}
                    onClick={() => setDeleteTarget(e)}
                    className="min-h-9 w-full justify-center"
                  >
                    <Trash2 className="size-4 shrink-0 text-danger" aria-hidden />
                    <span className="truncate">{tc("delete")}</span>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-[12px] border border-border md:block">
          <table className="w-full min-w-[900px] border-collapse bg-surface text-left text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-xs uppercase tracking-wide text-fg-subtle">
                <th scope="col" className="min-w-[260px] max-w-[340px] px-4 py-3 font-semibold">
                  EXAM TITLE
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">{tx(t, "colType", "Type")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{tx(t, "colLevel", "Level")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{tx(t, "colStatus", "Status")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{tx(t, "colSummary", "Summary")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">{tx(t, "colActions", "Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-hover"
                >
                  <td className="min-w-[260px] max-w-[340px] px-4 py-3">
                    <span className="block truncate font-medium text-fg" title={e.title}>
                      {e.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-mono text-fg-subtle">
                      ID: {e.id}
                    </span>
                    {e.isDemo && (
                      <span className="mt-0.5 inline-block text-[11px] text-fg-subtle">
                        {tx(t, "demoBadge", "Demo")}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-fg-muted">
                    {EXAM_TYPE_LABEL[e.type]}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-fg-muted">
                    {e.level?.trim() || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant={e.isPublished ? "success" : "warning"}>
                        {e.isPublished
                          ? tx(t, "published", "Published")
                          : tx(t, "draft", "Draft")}
                      </Badge>
                      {e.imported && (
                        <Badge variant="info" title={`${e.imported.packageId} · r${e.imported.revision}`}>
                          {tx(t, "aiImported", "AI imported")}
                        </Badge>
                      )}
                      {needsContent(e) && (
                        <Badge variant="warning">
                          {tx(t, "needsContent", "Needs content")}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-muted tabular-nums">
                    {e.skills.length} {tx(t, "sections", "sections")} · {e.questionCount}{" "}
                    {tx(t, "questions", "questions")}
                    {e.durationMinutes != null && <span> · {e.durationMinutes} min</span>}
                    <span> · {e.price > 0 ? formatMoney(e.price) : tx(t, "free", "Free")}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant={e.isPublished ? "outline" : "primary"}
                        className={e.isPublished ? "text-xs" : "text-xs bg-emerald-600 hover:bg-emerald-500 text-white"}
                        loading={updateExam.isPending && updateExam.variables?.id === e.id}
                        onClick={() => handleTogglePublish(e)}
                        title={e.isPublished ? tx(t, "unpublish", "Unpublish") : tx(t, "publish", "Publish")}
                      >
                        <Globe className="size-3.5 shrink-0" aria-hidden />
                        <span>{e.isPublished ? tx(t, "unpublish", "Unpublish") : tx(t, "publish", "Publish")}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        className="text-xs border border-emerald-600/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50"
                        onClick={() => setQuickEditTarget(e)}
                        title={tx(t, "questionsTitle", "Questions")}
                      >
                        <Sparkles className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
                        <span>{tx(t, "questionsTitle", "Questions")}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        className="text-xs border border-emerald-500/30 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-900/40"
                        onClick={() => setBulkImportTarget(e)}
                        title={tx(t, "bulkImportTitle", "⚡️ Tezkor Kiritish (Bulk Paste)")}
                      >
                        <Zap className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
                        <span>Bulk</span>
                      </Button>
                      <Link href={`/exam-builder/${e.id}`}>
                        <Button
                          size="sm"
                          aria-label={`${tx(t, "edit", "Edit")} — ${e.title}`}
                          className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          {tx(t, "edit", "Edit")}
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewId(e.id)}
                        aria-label={`${tx(t, "preview", "Preview")} — ${e.title}`}
                      >
                        <Eye className="size-3.5" aria-hidden />
                        {tx(t, "preview", "Preview")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`${tx(t, "duplicate", "Duplicate")} — ${e.title}`}
                        aria-label={`${tx(t, "duplicate", "Duplicate")} — ${e.title}`}
                        loading={clone.isPending && clone.variables === e.id}
                        onClick={() => handleDuplicate(e.id)}
                      >
                        <Copy className="size-4" aria-hidden />
                      </Button>
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`${tc("delete")} — ${e.title}`}
                          aria-label={`${tc("delete")} — ${e.title}`}
                          loading={del.isPending && del.variables === e.id}
                          onClick={() => setDeleteTarget(e)}
                        >
                          <Trash2 className="size-4 text-danger" aria-hidden />
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {previewId && <PreviewDialog examId={previewId} onClose={() => setPreviewId(null)} />}

      <JsonImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {quickEditTarget && (
        <ExamQuestionsEditorDialog
          open={!!quickEditTarget}
          onClose={() => setQuickEditTarget(null)}
          exam={quickEditTarget}
          onSuccess={() => examsQ.refetch()}
        />
      )}

      {bulkImportTarget && (
        <BulkQuestionImporterModal
          open={!!bulkImportTarget}
          onClose={() => setBulkImportTarget(null)}
          examId={bulkImportTarget.id}
          examTitle={bulkImportTarget.title}
          onQuestionsImported={handleDirectBulkImport}
        />
      )}

      <ConfirmDialog
        open={deleteTarget != null && canDelete}
        title={`${tc("delete")} — “${deleteTarget?.title ?? ""}”?`}
        description={tx(
          t,
          "deleteExamConfirm",
          "Permanently deletes this exam, its content, and its audio and images. This is not archiving and cannot be undone.",
        )}
        confirmLabel={tc("delete")}
        loading={del.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target || !canDelete) return;
          del.mutate(target.id, {
            onSuccess: () => {
              toast.success(tx(t, "deleted", "Exam deleted"));
              setDeleteTarget(null);
            },
            onError: (er) => toast.error(err(er, tc("unknownError"))),
          });
        }}
      />
    </div>
  );
}
