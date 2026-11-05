"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  AudioLines,
  BookOpen,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Headphones,
  Mic,
  PenLine,
  Plus,
  Search,
  Square,
  Trash2,
  ListChecks,
  Layers,
  Sparkles,
  ClipboardPaste,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { QuestionFormDialog } from "@/components/tests/question-form-dialog";
import { BulkQuestionImportDialog } from "@/components/tests/bulk-question-import-dialog";
import { GapFillBuilder } from "@/components/tests/gap-fill-builder";
import { useTest, useDeleteQuestion, useAddQuestion } from "@/hooks/use-tests";
import type { TestSection, TestQuestionFull } from "@/lib/types";
import { cn } from "@/lib/utils";

const SECTION_ORDER: TestSection[] = ["listening", "reading", "writing", "speaking"];
const SECTION_ICON: Record<TestSection, React.ElementType> = {
  listening: Headphones,
  reading: BookOpen,
  writing: PenLine,
  speaking: Mic,
};

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  try {
    const v = t(key as never) as unknown;
    if (typeof v !== "string" || !v || v === key || v.endsWith(`.${key}`)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

function getAudioSrc(q: TestQuestionFull): string | null {
  const any = q as unknown as { audioUrl?: string | null; hasAudio?: boolean };
  if (any.audioUrl) {
    const url = any.audioUrl;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/api")) return url;
    // sanitized returns "/v1/tests/..." — proxy expects "/tests/..." (API_URL already includes /v1)
    if (url.startsWith("/v1/")) return `/api/backend${url.slice(3)}`;
    if (url.startsWith("/v1")) return `/api/backend${url}`;
    // storage key — use canonical endpoint
    return `/api/backend/tests/questions/${q.id}/audio`;
  }
  if (any.hasAudio) return `/api/backend/tests/questions/${q.id}/audio`;
  return null;
}

export function TestManageView({ testId }: { testId: string }) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const { data: test, isLoading, isError, refetch } = useTest(testId);
  const del = useDeleteQuestion(testId);
  const add = useAddQuestion(testId);

  const [addOpen, setAddOpen] = React.useState(false);
  const [gapOpen, setGapOpen] = React.useState(false);
  const [bulkImportOpen, setBulkImportOpen] = React.useState(false);
  const [editQuestion, setEditQuestion] = React.useState<TestQuestionFull | null>(null);
  const [search, setSearch] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<TestSection>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // local order override per section
  const [orderedIds, setOrderedIds] = React.useState<string[] | null>(null);

  const questions = React.useMemo(() => test?.questions ?? [], [test?.questions]);

  const effectiveOrderedIds = React.useMemo(() => {
    if (!orderedIds) return null;
    const ids = questions.map((q) => q.id);
    const stillValid = orderedIds.every((id) => ids.includes(id)) && orderedIds.length === ids.length;
    return stillValid ? orderedIds : null;
  }, [questions, orderedIds]);

  const displayQuestions: TestQuestionFull[] = React.useMemo(() => {
    if (!effectiveOrderedIds) return questions;
    const map = new Map(questions.map((q) => [q.id, q]));
    const ordered: TestQuestionFull[] = [];
    for (const id of effectiveOrderedIds) {
      const q = map.get(id);
      if (q) ordered.push(q);
    }
    // append any new not in orderedIds (should not happen)
    for (const q of questions) if (!effectiveOrderedIds.includes(q.id)) ordered.push(q);
    return ordered;
  }, [questions, effectiveOrderedIds]);

  const filtered = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return displayQuestions;
    return displayQuestions.filter((q) => {
      const hay = [
        q.prompt,
        q.correctAnswer ?? "",
        q.options?.join(" ") ?? "",
        (q as unknown as { passageText?: string | null }).passageText ?? "",
        (q as unknown as { instructions?: string | null }).instructions ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [displayQuestions, search]);

  const bySection = React.useMemo(() => {
    const m = new Map<TestSection, TestQuestionFull[]>();
    for (const s of SECTION_ORDER) {
      const arr = filtered.filter((q) => q.section === s);
      if (arr.length) m.set(s, arr);
    }
    // include empty sections for show? only filtered present
    return m;
  }, [filtered]);

  const totalScore = React.useMemo(() => filtered.reduce((s, q) => s + q.maxScore, 0), [filtered]);

  function toggleCollapse(sec: TestSection) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(sec)) n.delete(sec);
      else n.add(sec);
      return n;
    });
  }
  function expandAll() {
    setCollapsed(new Set());
  }
  function collapseAll() {
    setCollapsed(new Set(SECTION_ORDER as TestSection[]));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleSelectAllInSection(secQs: TestQuestionFull[]) {
    const allSelected = secQs.every((q) => selected.has(q.id));
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) secQs.forEach((q) => n.delete(q.id));
      else secQs.forEach((q) => n.add(q.id));
      return n;
    });
  }
  function clearSelect() {
    setSelected(new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(tFallback(t, "bulkDeleteConfirm", `Delete ${ids.length} selected questions?`))) return;
    let ok = 0;
    for (const id of ids) {
      try {
        await new Promise<void>((resolve, reject) => {
          del.mutate(id, { onSuccess: () => resolve(), onError: () => reject(new Error("delete fail")) });
        });
        ok++;
      } catch {}
    }
    if (ok) toast.success(tFallback(t, "bulkDeleted", `${ok} questions deleted`));
    else toast.error(tc("unknownError"));
    clearSelect();
  }

  function move(q: TestQuestionFull, dir: -1 | 1) {
    const sectionQs = displayQuestions.filter((x) => x.section === q.section);
    const idx = sectionQs.findIndex((x) => x.id === q.id);
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= sectionQs.length) return;
    const target = sectionQs[targetIdx];
    // build new global order by swapping these two within that section's subsequence
    const globalIds = displayQuestions.map((x) => x.id);
    const aPos = globalIds.indexOf(q.id);
    const bPos = globalIds.indexOf(target.id);
    const next = [...globalIds];
    [next[aPos], next[bPos]] = [next[bPos], next[aPos]];
    setOrderedIds(next);
    toast.success(tFallback(t, "reordered", "Reordered (local preview)"));
  }

  function copyText(q: TestQuestionFull) {
    const opts = q.options?.join("\n") ?? "";
    const clip = [
      `Section: ${q.section} | Type: ${q.type} | Score: ${q.maxScore}`,
      `Prompt: ${q.prompt}`,
      opts ? `Options:\n${opts}` : "",
      q.correctAnswer ? `Answer: ${q.correctAnswer}` : "",
      (q as unknown as { instructions?: string | null }).instructions ? `Instructions: ${(q as unknown as { instructions?: string }).instructions}` : "",
      (q as unknown as { passageText?: string | null }).passageText ? `Passage:\n${(q as unknown as { passageText?: string }).passageText}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(clip).then(
      () => toast.success(tFallback(t, "copied", "Copied to clipboard")),
      () => toast.error(tc("unknownError")),
    );
  }

  function duplicate(q: TestQuestionFull) {
    const payload = {
      section: q.section,
      type: q.type,
      prompt: q.prompt,
      options: q.options ?? undefined,
      correctAnswer: q.correctAnswer ?? undefined,
      maxScore: q.maxScore,
      passageText: (q as unknown as { passageText?: string | null }).passageText ?? undefined,
      instructions: (q as unknown as { instructions?: string | null }).instructions ?? undefined,
    } as never;
    add.mutate(payload, {
      onSuccess: () => toast.success(tFallback(t, "duplicated", "Question duplicated")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  function onDelete(id: string) {
    if (!confirm(tFallback(t, "deleteConfirm", "Delete this question?"))) return;
    del.mutate(id, {
      onSuccess: () => toast.success(tc("saved")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (isLoading || !test) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const presentSections = SECTION_ORDER.filter((s) => questions.some((q) => q.section === s));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/tests" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
        <ArrowLeft className="size-4" />
        {tFallback(t, "title", "Tests")}
      </Link>

      {/* Header */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand">{test.type.toUpperCase()}</Badge>
            {test.isDemo && <Badge variant="info">{tFallback(t, "demo", "Demo")}</Badge>}
            {test.level && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-fg-muted">
                <Sparkles className="size-3" /> {test.level}
              </span>
            )}
            {test.durationMinutes && (
              <span className="text-xs text-fg-muted flex items-center gap-1">
                <Headphones className="size-3" /> {test.durationMinutes} {tFallback(t, "minutes", "min")}
              </span>
            )}
            {!test.isActive && <Badge variant="warning">{tFallback(t, "inactive", "Hidden")}</Badge>}
          </div>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight text-fg">{test.title}</h1>
          <p className="mt-1 text-xs text-fg-muted flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3.5" /> {questions.length} {tFallback(t, "questions", "questions")}
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5" /> {questions.reduce((s, q) => s + q.maxScore, 0)} {tFallback(t, "score", "points")} total
            </span>
            {presentSections.length > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1">
                <ListChecks className="size-3.5" /> {presentSections.map((s) => tFallback(t, `sections.${s}`, s)).join(" · ")}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={expandAll} className="hidden sm:inline-flex">
            <ChevronDown className="size-4" /> {tFallback(t, "expandAll", "Expand")}
          </Button>
          <Button size="sm" variant="outline" onClick={collapseAll} className="hidden sm:inline-flex">
            <ChevronUp className="size-4" /> {tFallback(t, "collapseAll", "Collapse")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setGapOpen(true)}>
            <Layers />
            {tFallback(t, "gapFill", "Gap-fill")}
          </Button>
          <Button size="sm" onClick={() => setBulkImportOpen(true)}>
            <ClipboardPaste />
            {tFallback(t, "bulkImport", "Smart paste")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus />
            {tFallback(t, "addQuestion", "Add question")}
          </Button>
        </div>
      </div>

      {/* Comfort bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tFallback(t, "searchQuestions", "Search prompt, options or answer…")}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-surface-hover text-fg-muted"
              aria-label="Clear"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="hidden sm:inline">
            {filtered.length} {tFallback(t, "shown", "shown")} • {totalScore} pts
          </span>
          {effectiveOrderedIds && (
            <Button variant="ghost" size="sm" onClick={() => setOrderedIds(null)} className="h-7 text-xs">
              {tFallback(t, "resetOrder", "Reset order")}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-brand/20 bg-brand-subtle px-3 py-2">
          <span className="text-sm font-medium text-brand-subtle-fg flex items-center gap-1.5">
            <CheckSquare className="size-4" /> {selected.size} {tFallback(t, "selected", "selected")}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelect}>
              {tFallback(tc, "cancel", "Clear")}
            </Button>
            <Button variant="danger" size="sm" onClick={bulkDelete} loading={del.isPending}>
              <Trash2 /> {tFallback(t, "deleteSelected", "Delete selected")}
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        questions.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={tFallback(tc, "empty", "No data")}
            description={tFallback(t, "noQuestions", "No questions yet — add your first one")}
            action={
              <>
                <Button size="sm" variant="outline" onClick={() => setGapOpen(true)}>
                  <Layers />
                  {tFallback(t, "gapFill", "Gap-fill")}
                </Button>
                <Button size="sm" onClick={() => setBulkImportOpen(true)}>
                  <ClipboardPaste /> {tFallback(t, "bulkImport", "Smart paste")}
                </Button>
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus /> {tFallback(t, "addQuestion", "Add question")}
                </Button>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={Search}
            title={tFallback(t, "noSearchResults", "No matches")}
            description={tFallback(t, "noSearchHint", "Try a different keyword or clear the search")}
            action={
              <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                {tFallback(tc, "clear", "Clear")}
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          {Array.from(bySection.entries()).map(([section, qs]) => {
            const isCollapsed = collapsed.has(section);
            const Icon = SECTION_ICON[section];
            const count = qs.length;
            const scoreSum = qs.reduce((s, q) => s + q.maxScore, 0);
            const allSel = qs.every((q) => selected.has(q.id));
            return (
              <Card key={section} className="overflow-hidden">
                <CardHeader
                  className={cn(
                    "flex flex-row items-center justify-between gap-3 py-3 px-4 sm:px-5 cursor-pointer select-none",
                    "hover:bg-surface-hover/50 transition-colors",
                  )}
                  onClick={() => toggleCollapse(section)}
                >
                  <CardTitle className="text-sm flex items-center gap-2.5">
                    <span className="grid size-7 place-items-center rounded-full bg-brand-subtle text-brand-subtle-fg">
                      <Icon className="size-4" />
                    </span>
                    <span>{tFallback(t, `sections.${section}`, section)}</span>
                    <Badge variant="neutral" className="ml-1 tabular-nums">
                      {count}
                    </Badge>
                    <span className="hidden sm:inline text-xs font-normal text-fg-muted">
                      • {qs.length === filtered.length ? questions.filter((q) => q.section === section).length : count} total • {scoreSum} pts
                    </span>
                  </CardTitle>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => toggleSelectAllInSection(qs)}
                      className={cn(
                        "hidden sm:inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                        allSel ? "border-brand bg-brand-subtle text-brand-subtle-fg" : "border-border text-fg-muted hover:bg-surface-hover",
                      )}
                      aria-label="Select all in section"
                    >
                      {allSel ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
                      {allSel ? tFallback(t, "deselectAll", "Deselect") : tFallback(t, "selectAll", "Select all")}
                    </button>
                    <span className="text-fg-muted">
                      {isCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
                    </span>
                  </div>
                </CardHeader>
                {!isCollapsed && (
                  <CardContent className="divide-y divide-border p-0">
                    {qs.map((q, idx) => {
                      const audioSrc = getAudioSrc(q);
                      const passage = (q as unknown as { passageText?: string | null }).passageText?.trim();
                      const instr = (q as unknown as { instructions?: string | null }).instructions?.trim();
                      const isSel = selected.has(q.id);
                      return (
                        <div key={q.id} className={cn("group p-4 sm:px-5", isSel && "bg-brand-subtle/30")}>
                          <div className="flex items-start gap-3">
                            <button
                              aria-label="Select"
                              onClick={() => toggleSelect(q.id)}
                              className={cn(
                                "mt-1 grid size-5 place-items-center rounded-[6px] border shrink-0 transition-colors",
                                isSel ? "bg-brand border-brand text-brand-fg" : "border-border bg-surface hover:border-border-strong",
                              )}
                            >
                              {isSel && <CheckSquare className="size-3.5" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="neutral" className="text-[11px] capitalize">
                                  {tFallback(t, `types.${q.type}`, q.type.replace("_", " "))}
                                </Badge>
                                <span className="text-xs text-fg-subtle tabular-nums">
                                  {q.maxScore} {tFallback(t, "score", "points")}
                                </span>
                                <span className="text-xs text-fg-subtle">• #{idx + 1}</span>
                                {audioSrc && (
                                  <span className="inline-flex items-center gap-1 text-xs text-brand font-medium">
                                    <AudioLines className="size-3" /> audio
                                  </span>
                                )}
                                {q.correctAnswer && (
                                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-success font-medium">✓ {q.correctAnswer.slice(0, 24)}</span>
                                )}
                              </div>

                              {instr && (
                                <div className="mt-2 rounded-[8px] border border-info/20 bg-info-bg px-3 py-2 text-xs leading-relaxed text-info">
                                  <p className="font-semibold">{tFallback(t, "instructions", "Instructions")}</p>
                                  <p className="mt-0.5 opacity-90">{instr}</p>
                                </div>
                              )}
                              {passage && (
                                <div className="mt-2 rounded-[8px] border border-border bg-bg-subtle px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-fg-muted max-h-28 overflow-y-auto">
                                  <p className="font-medium text-fg text-[11px] uppercase tracking-wide mb-1">{tFallback(t, "passage", "Passage")}</p>
                                  {passage}
                                </div>
                              )}
                              {audioSrc && (
                                <div className="mt-2">
                                  <audio controls src={audioSrc} preload="none" className="h-9 w-full" />
                                </div>
                              )}

                              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-fg">{q.prompt}</p>

                              {Array.isArray(q.options) && q.options.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                  {q.options.map((o, i) => (
                                    <li key={i} className="flex gap-2 text-xs">
                                      <span className="mt-0.5 grid size-5 place-items-center rounded-full bg-bg-subtle text-[11px] font-medium text-fg-muted shrink-0">
                                        {String.fromCharCode(65 + i)}
                                      </span>
                                      <span className="text-fg-muted leading-relaxed">{o}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {q.correctAnswer && (
                                <p className="mt-2 text-xs text-success sm:hidden">✓ {tFallback(t, "correctAnswer", "Correct")}: {q.correctAnswer}</p>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-center">
                              {/* reorder */}
                              <div className="flex sm:flex-col gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Move up"
                                  disabled={idx === 0}
                                  onClick={() => move(q, -1)}
                                  className="size-7"
                                >
                                  <ArrowUp className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Move down"
                                  disabled={idx === qs.length - 1}
                                  onClick={() => move(q, 1)}
                                  className="size-7"
                                >
                                  <ArrowDown className="size-3.5" />
                                </Button>
                              </div>
                              <div className="h-px w-full bg-border sm:h-6 sm:w-px sm:mx-1" />
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tFallback(tc, "edit", "Edit")}
                                onClick={() => setEditQuestion(q)}
                                className="size-7"
                              >
                                <PenLine className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tFallback(t, "copy", "Copy")}
                                onClick={() => copyText(q)}
                                className="size-7"
                              >
                                <Copy className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tFallback(t, "duplicate", "Duplicate")}
                                onClick={() => duplicate(q)}
                                className="size-7"
                                title={tFallback(t, "duplicate", "Duplicate")}
                              >
                                <Layers className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tc("delete")}
                                onClick={() => onDelete(q.id)}
                                className="size-7"
                              >
                                <Trash2 className="size-3.5 text-danger" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <QuestionFormDialog open={addOpen} onClose={() => setAddOpen(false)} testId={testId} />
      <GapFillBuilder open={gapOpen} onClose={() => setGapOpen(false)} testId={testId} />
      <BulkQuestionImportDialog open={bulkImportOpen} onClose={() => setBulkImportOpen(false)} testId={testId} />
      <QuestionFormDialog
        open={!!editQuestion}
        onClose={() => setEditQuestion(null)}
        testId={testId}
        question={editQuestion}
      />
    </div>
  );
}
