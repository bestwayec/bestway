"use client";

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Copy,
  Eye,
  Loader2,
  Rocket,
  Save,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PreviewDialog } from "@/components/exam-builder/PreviewDialog";
import { ImportProvenanceDialog } from "@/components/exam-builder/ImportProvenanceDialog";
import {
  useCloneMockExam,
  useExamImportProvenance,
  useMockExam,
  useResolveImportIssue,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail } from "@/lib/types";
import { examClientChecks, groupIssueCount } from "./checks";
import { GroupEditor } from "./GroupEditor";
import { ListeningPartEditor } from "./ListeningPartEditor";
import { ListeningSectionPanel } from "./ListeningSectionPanel";
import { ReadingPassageEditor } from "./ReadingPassageEditor";
import { ReadingSectionPanel } from "./ReadingSectionPanel";
import { SpeakingSectionPanel } from "./SpeakingSectionPanel";
import { SpeakingTaskEditor } from "./SpeakingTaskEditor";
import { WritingSectionPanel } from "./WritingSectionPanel";
import { WritingTaskEditor } from "./WritingTaskEditor";
import { OverviewPanel } from "./OverviewPanel";
import { ReviewPanel } from "./ReviewPanel";
import { SectionPanel } from "./SectionPanel";
import { Sidebar } from "./Sidebar";
import { SKILL_META, selectionKey, tx, type Selection } from "./types";

type ItemStatus = "ready" | "attention" | "empty";

function groupStatus(issues: number, questionCount: number): ItemStatus {
  if (issues > 0) return "attention";
  if (questionCount === 0) return "empty";
  return "ready";
}

function StatusChip({ status, issueCount }: { status: ItemStatus; issueCount?: number }) {
  if (status === "ready")
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" aria-hidden />
        Ready
      </Badge>
    );
  if (status === "attention")
    return (
      <Badge variant="danger">
        <XCircle className="size-3" aria-hidden />
        {issueCount && issueCount > 1 ? `${issueCount} issues` : "Needs attention"}
      </Badge>
    );
  return <Badge variant="warning">Empty</Badge>;
}

/** Slim context bar: WHAT am I editing + secondary question info. Never just "Edit". */
function EditorContextBar({ detail, selection }: { detail: MockExamDetail; selection: Selection }) {
  const t = useTranslations("examBuilder");
  if (selection.kind === "overview") {
    return (
      <ContextShell
        primary={tx(t, "overview", "Overview")}
        secondary={`${tx(t, "examSettings", "Exam settings")} · ${detail.questionCount} ${tx(t, "questions", "questions")}`}
      />
    );
  }
  if (selection.kind === "review") {
    return (
      <ContextShell
        primary={tx(t, "review", "Review")}
        secondary={tx(t, "reviewHint", "Automatic checks before publishing. Fix every error, then publish.")}
      />
    );
  }
  if (selection.kind === "publish") {
    return (
      <ContextShell
        primary={tx(t, "publish", "Publish")}
        secondary={`${detail.title} · ${detail.questionCount} ${tx(t, "questions", "questions")}`}
        trailing={
          <Badge variant={detail.isPublished ? "success" : "warning"}>
            {detail.isPublished ? tx(t, "published", "Published") : tx(t, "draft", "Draft")}
          </Badge>
        }
      />
    );
  }
  if (selection.kind === "section") {
    const s = detail.sections.find((x) => x.id === selection.sectionId);
    if (!s) return null;
    const meta = SKILL_META[s.skill];
    const qs = s.groups.reduce((a, g) => a + g.questions.length, 0);
    const issues = s.groups.reduce((a, g) => a + groupIssueCount(g, s.skill), 0);
    const status: ItemStatus = s.groups.length === 0 ? "empty" : groupStatus(issues, qs);
    return (
      <ContextShell
        primary={<span className="capitalize">{s.skill}</span>}
        secondary={`${s.groups.length} ${meta.units.toLowerCase()} · ${qs} ${tx(t, "questions", "questions")}`}
        trailing={<StatusChip status={status} issueCount={issues} />}
      />
    );
  }
  // group
  for (const s of detail.sections) {
    const gi = s.groups.findIndex((g) => g.id === selection.groupId);
    if (gi < 0) continue;
    const g = s.groups[gi];
    const meta = SKILL_META[s.skill];
    const label = g.title?.trim() || `${meta.unit} ${gi + 1}`;
    const issues = groupIssueCount(g, s.skill);
    const nums = g.questions.map((q) => q.number).sort((a, b) => a - b);
    const range =
      nums.length > 1
        ? `${tx(t, "questionsTitle", "Questions")} ${nums[0]}–${nums[nums.length - 1]}`
        : nums.length === 1
          ? `${tx(t, "questionsTitle", "Questions")} ${nums[0]}`
          : tx(t, "noQuestionsHint", "No questions yet — add one manually or use Import to paste many at once.");
    return (
      <ContextShell
        primary={
          <>
            <span className="font-normal capitalize text-fg-muted">{s.skill}</span>
            <span aria-hidden className="font-normal text-fg-subtle">
              {" / "}
            </span>
            {label}
          </>
        }
        secondary={`${g.questions.length} ${tx(t, "questions", "questions")} · ${range}`}
        trailing={<StatusChip status={groupStatus(issues, g.questions.length)} issueCount={issues} />}
      />
    );
  }
  return null;
}

function ContextShell({
  primary,
  secondary,
  trailing,
}: {
  primary: React.ReactNode;
  secondary: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-2.5 sm:gap-x-3">
      <h2 className="min-w-0 max-w-full flex-1 truncate text-[15px] font-bold text-fg sm:flex-none">{primary}</h2>
      <span className="shrink-0">{trailing}</span>
      <p className="w-full min-w-0 break-words text-xs text-fg-muted sm:ml-auto sm:w-auto sm:max-w-[60%] sm:truncate sm:text-right">
        {secondary}
      </p>
    </div>
  );
}

/**
 * Unified desktop builder shell: persistent outline sidebar + main editor +
 * compact sticky top toolbar. Server-backed editing — every Save persists
 * immediately, the exam stays DRAFT (unpublished) until Publish passes validation.
 */
export function ExamBuilder({ examId }: { examId: string }) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const examQ = useMockExam(examId);
  const [selection, setSelection] = React.useState<Selection>({ kind: "overview" });
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [provenanceOpen, setProvenanceOpen] = React.useState(false);
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [pendingSel, setPendingSel] = React.useState<Selection | null>(null);
  const [pendingExit, setPendingExit] = React.useState(false);
  const saveRef = React.useRef<(() => Promise<boolean>) | null>(null);
  const topAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const firstRenderRef = React.useRef(true);

  const detail = examQ.data;
  const router = useRouter();
  const clone = useCloneMockExam();
  const provQ = useExamImportProvenance(examId, true);
  const resolveMut = useResolveImportIssue(examId);

  function handleResolveIssue(issueId: string) {
    if (resolveMut.isPending) return;
    setResolvingId(issueId);
    resolveMut.mutate(issueId, {
      onSuccess: () => {
        setResolvingId(null);
        toast.success(tx(t, "issueResolvedToast", "Issue resolved."));
      },
      onError: (e) => {
        setResolvingId(null);
        toast.error(e instanceof ApiError ? `${e.message} (${e.code})` : tc("unknownError"));
      },
    });
  }
  const blockers = React.useMemo(
    () =>
      examClientChecks(detail?.sections ?? [], detail?.profile ?? "practice", detail?.type).filter(
        (c) => c.level === "error",
      ).length + (provQ.data?.openIssues ?? 0),
    [detail, provQ.data?.openIssues],
  );

  // Clone is the only manage-view action missing here (ported during the
  // legacy-dialog removal so /exam-builder stays the single authoring path).
  function handleClone() {
    if (clone.isPending) return;
    clone.mutate(examId, {
      onSuccess: (res) => {
        toast.success(tx(t, "duplicatedDraft", "Duplicated as a draft; the original exam remains unchanged."));
        router.push(`/exam-builder/${(res as { id: string }).id}`);
      },
      onError: () => toast.error(tc("unknownError")),
    });
  }

  // Selection points at a deleted entity → fall back to overview (render-time, no effect).
  let effective: Selection = selection;
  if (detail) {
    if (selection.kind === "section" && !detail.sections.some((s) => s.id === selection.sectionId)) {
      effective = { kind: "overview" };
    }
    if (
      selection.kind === "group" &&
      !detail.sections.some((s) => s.groups.some((g) => g.id === selection.groupId))
    ) {
      effective = { kind: "overview" };
    }
  }
  const effKey = selectionKey(effective);

  // Switching documents scrolls the editor back to top; the shell stays mounted.
  React.useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    topAnchorRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [effKey]);

  // Protect sustained work from accidental tab close / reload.
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const registerSave = React.useCallback((fn: (() => Promise<boolean>) | null) => {
    saveRef.current = fn;
  }, []);

  const handleDirty = React.useCallback(
    (d: boolean) => {
      setDirty(d);
      if (d) setSaveError(null);
    },
    [],
  );

  async function handleSaveDraft(): Promise<boolean> {
    if (saving) return false;
    if (!saveRef.current) {
      toast.success(tx(t, "draftSavedIdle", "Draft saved — nothing pending."));
      return true;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await saveRef.current();
      if (ok) {
        setDirty(false);
        setLastSavedAt(new Date());
        toast.success(tx(t, "draftSaved", "Draft saved."));
        return true;
      }
      // Validation or server rejection: edits stay intact in the panel, the
      // indicator switches to the failure state with a Retry action.
      setSaveError(tx(t, "saveFailedDetail", "Changes could not be saved."));
      return false;
    } catch (e) {
      const { ApiError } = await import("@/lib/api-client");
      const raw = e instanceof ApiError ? e.message : e instanceof Error ? e.message : null;
      // Never surface raw fetch/network strings to the user as primary copy.
      const looksTechnical =
        !!raw &&
        (raw.includes("Failed to fetch") || raw.startsWith("AxiosError") || raw.includes("NetworkError"));
      const msg = e instanceof ApiError ? raw! : looksTechnical ? tx(t, "saveFailedDetail", "Changes could not be saved.") : raw ?? tc("unknownError");
      setSaveError(msg);
      toast.error(looksTechnical ? tx(t, "saveFailedDetail", "Changes could not be saved.") : msg);
      if (looksTechnical) console.error("[exam-builder] save failed", e);
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Navigation guard: never silently drop unsaved editor changes. */
  function requestSelect(next: Selection) {
    if (selectionKey(next) === effKey) return;
    if (dirty) {
      setPendingSel(next);
      return;
    }
    setSelection(next);
  }

  if (examQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <div className="flex gap-4">
          <Skeleton className="hidden h-96 w-60 shrink-0 md:block" />
          <Skeleton className="h-96 min-w-0 flex-1" />
        </div>
      </div>
    );
  }
  if (examQ.isError || !detail) {
    return (
      <ErrorState
        title={tc("error")}
        action={
          <Button variant="outline" size="sm" onClick={() => examQ.refetch()}>
            {tc("retry")}
          </Button>
        }
      />
    );
  }

  const activeSection =
    effective.kind === "section"
      ? (detail.sections.find((s) => s.id === effective.sectionId) ?? null)
      : null;
  const activeGroup =
    effective.kind === "group"
      ? (detail.sections.flatMap((s) => s.groups.map((g) => ({ s, g }))).find((x) => x.g.id === effective.groupId) ?? null)
      : null;

  const saveState = saving ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted" role="status">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {tx(t, "saving", "Saving…")}
    </span>
  ) : saveError ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger" role="alert">
      <XCircle className="size-3.5" aria-hidden />
      <span title={tx(t, "saveFailedDetail", "Changes could not be saved.")}>
        {tx(t, "saveFailed", "Save failed")}
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={() => void handleSaveDraft()}
        className="underline underline-offset-2 hover:no-underline disabled:opacity-50"
        aria-label={tx(t, "retrySave", "Retry saving changes")}
      >
        {tx(t, "retry", "Retry")}
      </button>
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning" role="status">
      <span className="size-2 rounded-full bg-warning" aria-hidden />
      {tx(t, "unsaved", "Unsaved changes")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success" role="status">
      <CheckCircle2 className="size-3.5" aria-hidden />
      {lastSavedAt
        ? `${tx(t, "saved", "Saved")} · ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : tx(t, "saved", "Saved")}
    </span>
  );

  return (
    <div className="-mx-4 -mt-6 min-w-0 max-w-full overflow-x-clip px-4 pt-6 sm:-mx-6 sm:px-6">
      <div ref={topAnchorRef} className="scroll-mt-20" />

      {/* Compact sticky top toolbar (sits under the app topbar: h-16 + z-20). */}
      <div className="sticky top-16 z-10 -mx-4 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={tx(t, "backToList", "Back to exams")}
              onClick={() => {
                if (dirty) {
                  setPendingExit(true);
                  return;
                }
                router.push("/exam-builder");
              }}
              className="shrink-0"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="min-w-0 flex-1 truncate text-[15px] font-bold text-fg sm:flex-none sm:basis-auto">
                  {detail.title}
                </h1>
                <Badge variant={detail.isPublished ? "success" : "warning"} className="shrink-0">
                  {detail.isPublished ? tx(t, "published", "Published") : tx(t, "draft", "Draft")}
                </Badge>
                {provQ.data && (
                  <button
                    type="button"
                    onClick={() => setProvenanceOpen(true)}
                    className="shrink-0 rounded-full"
                    aria-label={tx(t, "provenanceTitle", "AI import details")}
                  >
                    <Badge variant="info">
                      {tx(t, "aiImported", "AI imported")}
                      {provQ.data.openIssues > 0 ? ` · ${provQ.data.openIssues}` : ""}
                    </Badge>
                  </button>
                )}
                <span className="shrink-0">{saveState}</span>
              </div>
              <p className="truncate text-xs text-fg-muted">
                {detail.questionCount} {tx(t, "questions", "questions")} · {detail.sections.length}{" "}
                {tx(t, "sections", "sections")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:ml-auto sm:flex sm:shrink-0 sm:flex-wrap sm:items-center">
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} className="min-h-9 justify-center max-sm:w-full sm:min-h-0">
              <Eye className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "preview", "Preview")}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={clone.isPending}
              onClick={handleClone}
              aria-label={tx(t, "duplicate", "Duplicate")}
              className="min-h-9 justify-center max-sm:w-full sm:min-h-0"
            >
              <Copy className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "duplicate", "Duplicate")}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => requestSelect({ kind: "review" })}
              aria-label={
                blockers > 0
                  ? `${tx(t, "review", "Review")} — ${blockers} ${tx(t, "blockers", "blockers")}`
                  : tx(t, "review", "Review")
              }
              className="min-h-9 justify-center max-sm:w-full sm:min-h-0"
            >
              <ClipboardList className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "review", "Review")}</span>
              {blockers > 0 && (
                <Badge variant="danger" className="ml-0.5 shrink-0">
                  {blockers}
                </Badge>
              )}
            </Button>
            <Button size="sm" variant="outline" loading={saving} onClick={() => void handleSaveDraft()} className="min-h-9 justify-center max-sm:w-full sm:min-h-0">
              <Save className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "saveDraft", "Save Draft")}</span>
            </Button>
            <Button size="sm" onClick={() => requestSelect({ kind: "publish" })} className="col-span-2 min-h-9 justify-center sm:col-span-1 sm:min-h-0">
              <Rocket className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "publish", "Publish")}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Live-edit warning (ported from the removed legacy manage view):
          published exams serve students immediately. */}
      {detail.isPublished && (
        <p className="mt-3 rounded-[8px] border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
          {tx(
            t,
            "liveEditWarning",
            "Published — edits affect live students immediately. Unpublish first for structural changes.",
          )}
        </p>
      )}

      <div className="flex min-w-0 items-start gap-4 pt-4">
        <div className="hidden shrink-0 md:block">
          <Sidebar
            examId={examId}
            detail={detail}
            selection={effective}
            onSelect={requestSelect}
            blockers={blockers}
          />
        </div>

        <div className="min-w-0 flex-1">
          {/* Small widths: outline select keeps every section reachable, no overlap. */}
          <div className="mb-3 md:hidden">
            <label htmlFor="builder-outline" className="sr-only">
              {tx(t, "outline", "Exam outline")}
            </label>
            <select
              id="builder-outline"
              value={effKey}
              onChange={(e) => {
                const found = outlineOptions(detail, (k, f) => tx(t, k, f)).find(
                  (o) => o.key === e.target.value,
                );
                if (found) requestSelect(found.sel);
              }}
              className="h-10 w-full min-w-0 rounded-[8px] border border-border bg-surface px-2 text-sm text-fg"
            >
              {outlineOptions(detail, (k, f) => tx(t, k, f)).map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <EditorContextBar detail={detail} selection={effective} />

          <main className="min-w-0" aria-live="off">
            {effective.kind === "overview" && (
              <OverviewPanel
                examId={examId}
                detail={detail}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "section" && activeSection && activeSection.skill === "listening" && detail.type !== 'multilevel' && (
              <ListeningSectionPanel
                key={activeSection.id}
                examId={examId}
                detail={detail}
                sectionId={activeSection.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "section" && activeSection && activeSection.skill === "reading" && detail.type !== 'multilevel' && (
              <ReadingSectionPanel
                key={activeSection.id}
                examId={examId}
                detail={detail}
                sectionId={activeSection.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "section" && activeSection && activeSection.skill === "writing" && detail.type !== 'multilevel' && (
              <WritingSectionPanel
                key={activeSection.id}
                examId={examId}
                detail={detail}
                sectionId={activeSection.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "section" && activeSection && activeSection.skill === "speaking" && detail.type !== 'multilevel' && (
              <SpeakingSectionPanel
                key={activeSection.id}
                examId={examId}
                detail={detail}
                sectionId={activeSection.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "section" && activeSection && (detail.type === 'multilevel' || (activeSection.skill !== "listening" && activeSection.skill !== "reading" && activeSection.skill !== "writing" && activeSection.skill !== "speaking")) && (
              <SectionPanel
                key={activeSection.id}
                examId={examId}
                detail={detail}
                sectionId={activeSection.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "group" && activeGroup && activeGroup.s.skill === "listening" && detail.type !== 'multilevel' && (
              <ListeningPartEditor
                key={activeGroup.g.id}
                examId={examId}
                detail={detail}
                sectionId={activeGroup.s.id}
                groupId={activeGroup.g.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "group" && activeGroup && activeGroup.s.skill === "reading" && detail.type !== 'multilevel' && (
              <ReadingPassageEditor
                key={activeGroup.g.id}
                examId={examId}
                detail={detail}
                sectionId={activeGroup.s.id}
                groupId={activeGroup.g.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "group" && activeGroup && activeGroup.s.skill === "writing" && detail.type !== 'multilevel' && (
              <WritingTaskEditor
                key={activeGroup.g.id}
                examId={examId}
                detail={detail}
                sectionId={activeGroup.s.id}
                groupId={activeGroup.g.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "group" && activeGroup && activeGroup.s.skill === "speaking" && detail.type !== 'multilevel' && (
              <SpeakingTaskEditor
                key={activeGroup.g.id}
                examId={examId}
                detail={detail}
                sectionId={activeGroup.s.id}
                groupId={activeGroup.g.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "group" && activeGroup && (detail.type === 'multilevel' || (activeGroup.s.skill !== "listening" && activeGroup.s.skill !== "reading" && activeGroup.s.skill !== "writing" && activeGroup.s.skill !== "speaking")) && (
              <GroupEditor
                key={activeGroup.g.id}
                examId={examId}
                detail={detail}
                sectionId={activeGroup.s.id}
                groupId={activeGroup.g.id}
                onSelect={requestSelect}
                registerSave={registerSave}
                onDirty={handleDirty}
              />
            )}
            {effective.kind === "review" && (
              <ReviewPanel
                examId={examId}
                detail={detail}
                mode="checks"
                onFix={requestSelect}
                onPreview={() => setPreviewOpen(true)}
                onSaveDraft={() => void handleSaveDraft()}
              />
            )}
            {effective.kind === "publish" && (
              <ReviewPanel
                examId={examId}
                detail={detail}
                mode="publish"
                onFix={requestSelect}
                onPreview={() => setPreviewOpen(true)}
                onSaveDraft={() => void handleSaveDraft()}
                dirty={dirty}
              />
            )}
          </main>
        </div>
      </div>

      {previewOpen && <PreviewDialog examId={examId} onClose={() => setPreviewOpen(false)} />}

      {detail && (
        <ImportProvenanceDialog
          open={provenanceOpen}
          onClose={() => setProvenanceOpen(false)}
          detail={detail}
          provenance={provQ.data}
          loading={provQ.isLoading}
          onSelect={requestSelect}
          onResolve={handleResolveIssue}
          resolvingId={resolvingId}
        />
      )}

      {/* Unsaved-changes navigation guard (in-builder moves and leaving the exam) */}
      <Dialog
        open={pendingSel != null || pendingExit}
        onOpenChange={(o) => {
          if (!o) {
            setPendingSel(null);
            setPendingExit(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingExit
                ? tx(t, "unsavedChangesTitle", "You have unsaved changes.")
                : tx(t, "unsavedTitle", "Discard unsaved changes?")}
            </DialogTitle>
            <DialogDescription>
              {pendingExit
                ? tx(
                    t,
                    "unsavedExitDesc",
                    "Leave without saving? Your edits will be lost. Save first to keep them.",
                  )
                : tx(
                    t,
                    "unsavedDesc",
                    "You have unsaved edits in this panel. Switching now will lose them. Save first, or discard to continue.",
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingSel(null);
                setPendingExit(false);
              }}
            >
              {pendingExit ? tx(t, "stay", "Stay") : tx(t, "keepEditing", "Keep editing")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={saving}
              onClick={() => {
                void (async () => {
                  const ok = await handleSaveDraft();
                  if (!ok) return;
                  const next = pendingSel;
                  const exit = pendingExit;
                  setPendingSel(null);
                  setPendingExit(false);
                  if (exit) router.push("/exam-builder");
                  else if (next) setSelection(next);
                })();
              }}
            >
              <Save className="size-4" aria-hidden />
              {tx(t, "saveDraft", "Save Draft")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const next = pendingSel;
                const exit = pendingExit;
                setPendingSel(null);
                setPendingExit(false);
                setDirty(false);
                setSaveError(null);
                if (exit) router.push("/exam-builder");
                else if (next) setSelection(next);
              }}
            >
              {pendingExit
                ? tx(t, "leaveWithoutSaving", "Leave without saving")
                : tx(t, "discard", "Discard changes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function outlineOptions(
  detail: MockExamDetail,
  L: (key: string, fallback: string) => string,
): Array<{ key: string; label: string; sel: Selection }> {
  const opts: Array<{ key: string; label: string; sel: Selection }> = [
    { key: "overview", label: L("overview", "Overview"), sel: { kind: "overview" } },
  ];
  for (const s of detail.sections) {
    const name = s.skill.charAt(0).toUpperCase() + s.skill.slice(1);
    opts.push({ key: `section:${s.id}`, label: name, sel: { kind: "section", sectionId: s.id } });
    s.groups.forEach((g, gi) => {
      opts.push({
        key: `group:${g.id}`,
        label: `— ${g.title?.trim() || `Block ${gi + 1}`}`,
        sel: { kind: "group", groupId: g.id },
      });
    });
  }
  opts.push({ key: "review", label: L("review", "Review"), sel: { kind: "review" } });
  opts.push({ key: "publish", label: L("publish", "Publish"), sel: { kind: "publish" } });
  return opts;
}
