"use client";

import * as React from "react";
import {
  CheckCircle2,
  Eye,
  RefreshCw,
  TriangleAlert,
  Undo2,
  Wrench,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";
import {
  useExamImportProvenance,
  useMockReadiness,
  useResolveImportIssue,
  useUpdateMockExam,
  type MockReadinessItem,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type {
  MockExamDetail,
  MockGroup,
  MockQuestion,
  MockSection,
  MockSkill,
  MockExamImportProvenance,
} from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { examClientChecks, type Check } from "./checks";
import { issueSelection } from "./ImportProvenanceDialog";
import {
  clusterReadingPassages,
  type ReadingPassageCluster,
} from "./reading-passage-clusters";
import { reviewBlockerCount } from "./review-blockers";
import { tx, type Selection } from "./types";

const SKILLS: MockSkill[] = ["listening", "reading", "writing", "speaking"];

const SKILL_NAME: Record<MockSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

const MANUAL_TYPES: ReadonlySet<string> = new Set(["essay_task1", "essay_task2", "speaking_task"]);

function isAutoQuestion(q: MockQuestion, skill: MockSkill): boolean {
  if (MANUAL_TYPES.has(q.type)) return false;
  return skill === "listening" || skill === "reading";
}

function sortedGroups(section: MockSection): MockGroup[] {
  const groups = [...section.groups];
  if (section.skill === "listening") {
    groups.sort((a, b) => (a.partNumber ?? a.sortOrder + 1) - (b.partNumber ?? b.sortOrder + 1));
  } else {
    groups.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return groups;
}

/** Stable display name per unit: Part N / Passage N / Task 1·2 / Part N. */
function groupDisplayName(skill: MockSkill, groups: MockGroup[], g: MockGroup): string {
  const idx = groups.findIndex((x) => x.id === g.id);
  const title = g.title?.trim() ?? "";
  if (skill === "listening") {
    const no = g.partNumber ?? idx + 1;
    return title && title !== `Part ${no}` ? `Part ${no} · ${title}` : `Part ${no}`;
  }
  if (skill === "reading") {
    const no = idx + 1;
    return title && title !== `Passage ${no}` ? `Passage ${no} · ${title}` : `Passage ${no}`;
  }
  if (skill === "writing") {
    if (g.questions.some((q) => q.type === "essay_task1")) return "Task 1";
    if (g.questions.some((q) => q.type === "essay_task2")) return "Task 2";
    return title || `Task ${idx + 1}`;
  }
  return title || `Part ${idx + 1}`;
}

/**
 * Turn a technical check label into a short human problem phrase.
 * Unknown labels pass through untouched (they are already human-readable —
 * never backend codes).
 */
function humanizeProblem(label: string): string {
  let m = label.match(/Q(\d+): question text is empty/);
  if (m) return `Question ${m[1]} has no text.`;
  m = label.match(/Q(\d+): answer key is missing/);
  if (m) return `Question ${m[1]} is missing its answer key.`;
  m = label.match(/Q(\d+): choice questions need at least 2 options/);
  if (m) return `Question ${m[1]} needs at least 2 options.`;
  m = label.match(/Q(\d+): word limit must be 1 or more/);
  if (m) return `Question ${m[1]} has an invalid word limit.`;
  if (/— audio missing$/.test(label)) return "Audio file missing.";
  if (/— passage text missing$/.test(label)) return "Passage text missing.";
  if (/has no questions$/.test(label)) return "No questions yet.";
  if (/has no duration$/.test(label)) return "No duration set.";
  if (/Writing is missing Task 1/.test(label)) return "Task 1 is not configured.";
  if (/Writing is missing Task 2/.test(label)) return "Task 2 is not configured.";
  if (/Speaking has no tasks/.test(label)) return "No speaking tasks yet.";
  return label;
}

function serverItem(key: string, items: MockReadinessItem[]): MockReadinessItem | undefined {
  return items.find((i) => i.key === key);
}

function serverProblemTitle(key: string): string {
  const labels: Record<string, string> = {
    has_content: "Exam content is missing.",
    answer_keys: "Answer keys are incomplete.",
    manual_points: "Manual question points are invalid.",
    duplicate_numbers: "Question numbers are duplicated.",
    total_questions: "The exam has no questions.",
    listening_audio: "Listening audio is incomplete.",
    listening_parts: "Listening parts are incomplete.",
    reading_passage: "Reading passage text is incomplete.",
    writing_tasks: "Writing tasks are incomplete.",
    writing_content: "Writing content is incomplete.",
    speaking_content: "Speaking content is incomplete.",
  };
  return labels[key] ?? key.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function firstGroupWith(
  detail: MockExamDetail,
  pred: (q: MockQuestion, skill: MockSkill, g: MockGroup) => boolean,
): Selection | null {
  for (const s of detail.sections)
    for (const g of s.groups) {
      if (g.questions.some((q) => pred(q, s.skill, g))) return { kind: "group", groupId: g.id };
    }
  return null;
}

/** Precise Fix target for a server readiness item (exact part/passage/group). */
function readinessFixTarget(
  key: string,
  detail: MockExamDetail,
): Selection {
  const sectionOf = (skill: MockSkill): Selection | null => {
    const s = detail.sections.find((x) => x.skill === skill);
    return s ? ({ kind: "section", sectionId: s.id } as Selection) : null;
  };
  if (key === "has_content") return { kind: "overview" };
  if (key === "writing_content") return sectionOf("writing") ?? { kind: "overview" };
  if (key === "speaking_content") return sectionOf("speaking") ?? { kind: "overview" };
  if (key === "listening_audio") {
    for (const s of detail.sections) {
      if (s.skill !== "listening") continue;
      const g = s.groups.find((x) => x.questions.length > 0 && !x.hasAudio);
      if (g) return { kind: "group", groupId: g.id };
    }
    return sectionOf("listening") ?? { kind: "overview" };
  }
  if (key === "listening_parts") return sectionOf("listening") ?? { kind: "overview" };
  if (key === "writing_tasks") return sectionOf("writing") ?? { kind: "overview" };
  if (key === "answer_keys") {
    return (
      firstGroupWith(detail, (q, skill) => isAutoQuestion(q, skill) && (q.correctAnswers ?? []).filter((a) => a.trim() !== "").length === 0) ??
      sectionOf("listening") ?? { kind: "overview" }
    );
  }
  if (key === "manual_points") {
    return (
      firstGroupWith(detail, (q, skill) => !isAutoQuestion(q, skill) && q.points !== 9) ??
      sectionOf("writing") ?? { kind: "overview" }
    );
  }
  if (key === "total_questions") return { kind: "overview" };
  const m = key.match(/^(listening|reading|writing|speaking)_section$/);
  if (m) return { kind: "overview" };
  if (key.includes("speaking")) return sectionOf("speaking") ?? { kind: "overview" };
  if (key.includes("reading")) return sectionOf("reading") ?? { kind: "overview" };
  if (key.includes("writing")) return sectionOf("writing") ?? { kind: "overview" };
  if (key.includes("listening")) return sectionOf("listening") ?? { kind: "overview" };
  return { kind: "overview" };
}

function Row({
  icon,
  title,
  detail,
  fix,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  fix?: () => void;
  tone: "ok" | "error" | "warning";
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-[8px] border px-3 py-2 min-[480px]:flex-row min-[480px]:items-start min-[480px]:gap-2.5 ${
        tone === "ok"
          ? "border-success/25 bg-success/5"
          : tone === "error"
            ? "border-danger-border bg-danger-bg"
            : "border-warning/25 bg-warning/5"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-fg">{title}</p>
          {detail && <p className="break-words text-xs text-fg-muted">{detail}</p>}
        </div>
      </div>
      {fix && (
        <Button size="sm" variant="outline" onClick={fix} aria-label={`Fix: ${title}`} className="min-h-9 w-full shrink-0 justify-center min-[480px]:ml-auto min-[480px]:w-auto">
          <Wrench className="size-3.5 shrink-0" aria-hidden />
          Fix
        </Button>
      )}
    </div>
  );
}

function FixButton({ onFix, label }: { onFix: () => void; label: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onFix}
      aria-label={`Fix: ${label}`}
      className="min-h-9 w-full shrink-0 justify-center min-[480px]:ml-auto min-[480px]:w-auto"
    >
      <Wrench className="size-3.5 shrink-0" aria-hidden />
      Fix
    </Button>
  );
}

/**
 * Review & validation screen + Publish gate.
 * Server readiness is authoritative; client checks add exact per-question
 * targets. Every problem carries a Fix button jumping to the exact editor.
 */
export function ReviewPanel({
  examId,
  detail,
  mode,
  onFix,
  onPreview,
  onSaveDraft,
  dirty,
}: {
  examId: string;
  detail: MockExamDetail;
  mode: "checks" | "publish";
  onFix: (s: Selection) => void;
  onPreview: () => void;
  onSaveDraft: () => void;
  /** Unsaved shell edits — publishing would not include them. */
  dirty?: boolean;
}) {
  const t = useTranslations("examBuilder");
  const readinessQ = useMockReadiness(examId);
  const provenanceQ = useExamImportProvenance(examId, true);
  const resolveIssue = useResolveImportIssue(examId);
  const qc = useQueryClient();
  const [resolvingIssueId, setResolvingIssueId] = React.useState<string | null>(null);

  const client = React.useMemo(
    () => examClientChecks(detail.sections, detail.profile, detail.type),
    [detail],
  );
  const errors = client.filter((c) => c.level === "error");
  const warnings = client.filter((c) => c.level === "warning");
  const serverItems = readinessQ.data?.items ?? [];
  const openImportIssues = (provenanceQ.data?.issues ?? []).filter((issue) => issue.status !== "resolved");
  const blockers = reviewBlockerCount(
    errors.length,
    serverItems,
    provenanceQ.data ? openImportIssues.length : null,
    readinessQ.isError,
  );
  const totalQ = detail.questionCount;

  const serverLoading = readinessQ.isLoading && !readinessQ.data;
  const serverError = readinessQ.isError;
  const rechecking = readinessQ.isFetching && !readinessQ.isLoading;

  async function handleRefresh() {
    await qc.invalidateQueries({ queryKey: ["mock-exam"] });
    await qc.invalidateQueries({ queryKey: ["mock-import-provenance", examId] });
    await readinessQ.refetch();
  }

  function handleResolveImportIssue(issueId: string) {
    if (resolveIssue.isPending) return;
    setResolvingIssueId(issueId);
    resolveIssue.mutate(issueId, {
      onSuccess: () => {
        setResolvingIssueId(null);
        toast.success(tx(t, "issueResolvedToast", "Issue resolved."));
      },
      onError: (error) => {
        setResolvingIssueId(null);
        toast.error(error instanceof ApiError ? `${error.message} (${error.code})` : tx(t, "unknownError", "Unknown error"));
      },
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-fg">
          {mode === "publish" ? tx(t, "publish", "Publish") : tx(t, "reviewExam", "Review exam")}
        </h2>
        <p className="text-sm text-fg-muted">
          {mode === "publish"
            ? tx(t, "publishHint", "Publishing makes the exam visible to students. Blockers must be zero.")
            : tx(t, "reviewHint", "Automatic checks before publishing. Fix every error, then publish.")}
        </p>
      </div>

      {mode === "checks" && (
        <ReviewChecks
          detail={detail}
          client={client}
          warnings={warnings}
          serverItems={serverItems}
          provenance={provenanceQ.data}
          provenanceLoading={provenanceQ.isLoading}
          resolvingIssueId={resolvingIssueId}
          blockers={blockers}
          serverLoading={serverLoading}
          serverError={serverError}
          rechecking={rechecking}
          onFix={onFix}
          onRefresh={() => void handleRefresh()}
          onSaveDraft={onSaveDraft}
          onPreview={onPreview}
          onRetry={() => void readinessQ.refetch()}
          onResolveImportIssue={handleResolveImportIssue}
        />
      )}

      {mode === "publish" && (
        <PublishRelease
          examId={examId}
          detail={detail}
          blockers={blockers}
          blockerDetail={
            openImportIssues.length > 0
              ? `${openImportIssues[0].message}${openImportIssues.length > 1 ? ` (+${openImportIssues.length - 1} more)` : ""}`
              : undefined
          }
          totalQ={totalQ}
          dirty={!!dirty}
          onFix={onFix}
          onPreview={onPreview}
          onSaveDraft={onSaveDraft}
        />
      )}
    </div>
  );
}

/** Access summary from the actual model fields — no new semantics. */
function accessLines(
  detail: MockExamDetail,
  sumWord: string,
  t: ReturnType<typeof useTranslations>,
): string[] {
  const lines: string[] = [];
  if (detail.isDemo) lines.push(tx(t, "accessDemo", "Visible as a public demo"));
  if (detail.price > 0) {
    lines.push(`${tx(t, "accessPaid", "Paid")} — ${formatMoney(detail.price)} ${sumWord}`);
    if (detail.isFreeForApproved)
      lines.push(tx(t, "accessApprovedFree", "Free for enrolled students"));
  } else {
    lines.push(tx(t, "accessFree", "Free for everyone"));
  }
  return lines;
}

/**
 * Deliberate release action: blocked with reasons, otherwise a rechecked
 * confirmation (title, readiness, access, consequences) before the single
 * existing PATCH. Published state, failure state, and next actions included.
 */
function PublishRelease({
  examId,
  detail,
  blockers,
  blockerDetail,
  totalQ,
  dirty,
  onFix,
  onPreview,
  onSaveDraft,
}: {
  examId: string;
  detail: MockExamDetail;
  blockers: number;
  blockerDetail?: string;
  totalQ: number;
  dirty: boolean;
  onFix: (s: Selection) => void;
  onPreview: () => void;
  onSaveDraft: () => void;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const router = useRouter();
  const qc = useQueryClient();
  const update = useUpdateMockExam(examId);
  const readinessQ = useMockReadiness(examId);

  const [checking, setChecking] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [staleBlockers, setStaleBlockers] = React.useState<number | null>(null);
  const [celebrated, setCelebrated] = React.useState(false);

  const publishing = update.isPending;
  const access = accessLines(detail, tc("sum"), t);

  /** Pre-publish check against fresh server data — never trust stale state. */
  async function handlePublishClick() {
    if (checking || publishing) return;
    setPublishError(null);
    setStaleBlockers(null);
    setChecking(true);
    try {
      await qc.invalidateQueries({ queryKey: ["mock-exam"] });
      const fresh = await readinessQ.refetch();
      if (fresh.isError || !fresh.data) {
        setPublishError(tx(t, "readinessCheckFailed", "Could not check exam readiness."));
        return;
      }
      const items = fresh.data?.items ?? [];
      const serverBad = items.filter((i) => !i.ok).length;
      const examData = qc.getQueryData<MockExamDetail>(["mock-exam"]);
      const clientBad = examClientChecks(
        examData?.sections ?? detail.sections,
        examData?.profile ?? detail.profile,
        examData?.type ?? detail.type,
      ).filter((c) => c.level === "error").length;
      const total = serverBad + clientBad;
      if (total > 0) {
        setStaleBlockers(total);
        return;
      }
      setConfirmOpen(true);
    } finally {
      setChecking(false);
    }
  }

  function handleConfirmPublish() {
    if (publishing) return;
    setPublishError(null);
    update.mutate(
      { isPublished: true },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setCelebrated(true);
          setStaleBlockers(null);
          toast.success(tx(t, "publishedToast", "Exam published successfully."));
        },
        onError: (e) => {
          const msg = e instanceof ApiError ? e.message : tx(t, "publishFailed", "Publishing failed. Please try again.");
          setPublishError(msg);
        },
      },
    );
  }

  function handleUnpublish() {
    update.mutate(
      { isPublished: false },
      {
        onSuccess: () => {
          setCelebrated(false);
          toast.success(tx(t, "unpublished", "Exam is back to draft."));
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  const publishLabel = publishing
    ? tx(t, "publishing", "Publishing…")
    : checking
      ? tx(t, "checkingReadiness", "Checking readiness…")
      : detail.isPublished
        ? tx(t, "published", "Published")
        : tx(t, "publishNow", "Publish now");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{tx(t, "publish", "Publish")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={detail.isPublished ? "success" : "warning"}>
              {detail.isPublished ? tx(t, "published", "Published") : tx(t, "draft", "Draft")}
            </Badge>
            <span className="text-sm text-fg-muted">
              {detail.title} · {totalQ} {tx(t, "questions", "questions")}
            </span>
          </div>

          {detail.isPublished ? (
            <Row
              tone="ok"
              icon={<CheckCircle2 className="size-4 text-success" />}
              title={
                celebrated
                  ? tx(t, "publishedSuccess", "Exam published successfully.")
                  : tx(t, "publishedLive", "Published — students can see it now.")
              }
              detail={tx(
                t,
                "liveEditNote",
                "This exam is live — saved edits apply immediately, no republish needed.",
              )}
            />
          ) : blockers > 0 ? (
            <Row
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={
                blockers === 1
                  ? tx(t, "publishBlockedOne", "1 issue must be fixed before this exam can be published.")
                  : tx(t, "publishBlockedMany", "{n} issues must be fixed before this exam can be published.").replace(
                      "{n}",
                      String(blockers),
                    )
              }
              detail={blockerDetail ?? tx(t, "publishBlockedHint", "Open Review, fix every error, then come back.")}
              fix={() => onFix({ kind: "review" })}
            />
          ) : (
            <Row
              tone="ok"
              icon={<CheckCircle2 className="size-4 text-success" />}
              title={tx(t, "readyToPublish", "Ready to publish — no blocking issues.")}
            />
          )}

          {staleBlockers != null && staleBlockers > 0 && !detail.isPublished && (
            <Row
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={tx(t, "noLongerReady", "This exam is no longer ready to publish.")}
              detail={`${staleBlockers} ${tx(t, "issuesFound", "issues found on recheck.")}`}
              fix={() => onFix({ kind: "review" })}
            />
          )}

          {publishError && (
            <p role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {publishError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onSaveDraft}>
              {tx(t, "saveDraft", "Save Draft")}
            </Button>
            <Button size="sm" variant="outline" onClick={onPreview}>
              <Eye className="size-4" aria-hidden />
              {tx(t, "preview", "Preview")}
            </Button>
            {detail.isPublished ? (
              <>
                <Button size="sm" variant="outline" onClick={() => router.push("/exam-builder")}>
                  {tx(t, "backToExams", "Return to exams")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={publishing}
                  onClick={handleUnpublish}
                  className="ml-auto"
                >
                  <Undo2 className="size-4" aria-hidden />
                  {tx(t, "unpublish", "Unpublish")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                loading={checking || publishing}
                disabled={blockers > 0 || checking || publishing}
                title={
                  blockers > 0
                    ? tx(t, "publishDisabledReason", "Resolve every blocking issue first.")
                    : undefined
                }
                aria-describedby={blockers > 0 ? "publish-blockers" : undefined}
                onClick={() => void handlePublishClick()}
              >
                {publishLabel}
              </Button>
            )}
          </div>
          <span id="publish-blockers" className="sr-only">
            {blockers > 0
              ? tx(t, "publishDisabledReason", "Resolve every blocking issue first.")
              : ""}
          </span>
        </CardContent>
      </Card>

      {/* Deliberate confirmation — never instant. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !publishing && setConfirmOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx(t, "publishConfirmTitle", "Publish exam?")}</DialogTitle>
            <DialogDescription>
              {tx(t, "publishConfirmHint", "This makes the exam visible according to its access settings.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 py-2 text-sm">
            <p className="text-fg">
              <span className="font-semibold">{tx(t, "examLabel", "Exam")}: </span>
              {detail.title}
            </p>
            <p className="text-fg">
              <span className="font-semibold">{tx(t, "statusLabel", "Status")}: </span>
              {tx(t, "readyToPublishShort", "Ready to publish")} · {totalQ}{" "}
              {tx(t, "questions", "questions")}
            </p>
            <div className="text-fg">
              <p className="font-semibold">{tx(t, "accessLabel", "Access")}:</p>
              <ul className="list-disc pl-5 text-fg-muted">
                {access.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-fg-muted">
              {tx(
                t,
                "publishConsequence",
                "Publishing will make this exam available according to its configured access settings.",
              )}
            </p>
            {dirty && (
              <div className="rounded-[8px] border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-fg">
                <p>
                  {tx(
                    t,
                    "publishDirtyNote",
                    "You have unsaved changes — they won't be included. Save first, then publish.",
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={publishing}
                  className="mt-1.5"
                  onClick={() => {
                    onSaveDraft();
                    // Saved content needs its own recheck — start over.
                    setConfirmOpen(false);
                  }}
                >
                  {tx(t, "saveDraft", "Save Draft")}
                </Button>
              </div>
            )}
            {publishError && (
              <p role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
                {publishError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={publishing} onClick={() => setConfirmOpen(false)}>
              {tx(t, "cancel", "Cancel")}
            </Button>
            <Button loading={publishing} onClick={handleConfirmPublish}>
              {publishing ? tx(t, "publishing", "Publishing…") : tx(t, "publishExam", "Publish Exam")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Dedicated Review workspace: overall readiness + per-skill checklists. */
function ReviewChecks({
  detail,
  client,
  warnings,
  serverItems,
  provenance,
  provenanceLoading,
  resolvingIssueId,
  blockers,
  serverLoading,
  serverError,
  rechecking,
  onFix,
  onRefresh,
  onSaveDraft,
  onPreview,
  onRetry,
  onResolveImportIssue,
}: {
  detail: MockExamDetail;
  client: Check[];
  warnings: Check[];
  serverItems: MockReadinessItem[];
  provenance: MockExamImportProvenance | null | undefined;
  provenanceLoading: boolean;
  resolvingIssueId: string | null;
  blockers: number;
  serverLoading: boolean;
  serverError: boolean;
  rechecking: boolean;
  onFix: (s: Selection) => void;
  onRefresh: () => void;
  onSaveDraft: () => void;
  onPreview: () => void;
  onRetry: () => void;
  onResolveImportIssue: (issueId: string) => void;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");

  const answerKeysItem = serverItem("answer_keys", serverItems);
  const manualPointsItem = serverItem("manual_points", serverItems);
  const totalItem = serverItem("total_questions", serverItems);
  const listeningPartsItem = serverItem("listening_parts", serverItems);
  const hasContentItem = serverItem("has_content", serverItems);
  const writingContentItem = serverItem("writing_content", serverItems);
  const speakingContentItem = serverItem("speaking_content", serverItems);
  const importIssuesItem = serverItem("import_issues", serverItems);
  const openImportIssues = (provenance?.issues ?? []).filter((issue) => issue.status !== "resolved");
  const exactServerErrors = serverItems.filter((item) => !item.ok && item.key !== "import_issues");
  // Full Mock only: required-but-absent sections (practice never emits these).
  const missingSectionItems = serverItems.filter(
    (i) => !i.ok && /^(listening|reading|writing|speaking)_section$/.test(i.key),
  );

  const missingKeyCount = React.useMemo(() => {
    let n = 0;
    for (const s of detail.sections)
      for (const g of s.groups)
        for (const q of g.questions) {
          if (
            isAutoQuestion(q, s.skill) &&
            (q.correctAnswers ?? []).filter((a) => a.trim() !== "").length === 0
          ) {
            n += 1;
          }
        }
    return n;
  }, [detail]);

  const manualPointsCount = React.useMemo(() => {
    let n = 0;
    for (const s of detail.sections)
      for (const g of s.groups)
        for (const q of g.questions) {
          if (!isAutoQuestion(q, s.skill) && q.points !== 9) n += 1;
        }
    return n;
  }, [detail]);

  return (
    <div className="space-y-4">
      {/* Overall readiness — decisive, no giant statistics. */}
      {serverLoading ? (
        <div className="space-y-2" role="status" aria-label="Checking exam readiness">
          <Skeleton className="h-14" />
        </div>
      ) : serverError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2"
        >
          <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              {tx(t, "readinessCheckFailed", "Could not check exam readiness.")}
            </p>
            <p className="text-xs text-fg-muted">
              {tx(
                t,
                "readinessCheckFailedHint",
                "The server check failed — nothing below is marked ready because of it. Your content list is still shown from saved data.",
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0">
            {tc("retry")}
          </Button>
        </div>
      ) : blockers > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2"
        >
          <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              {tx(t, "cannotPublish", "Cannot publish")}
              {rechecking && (
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  {tx(t, "rechecking", "Rechecking…")}
                </span>
              )}
            </p>
            <p className="text-xs text-fg-muted">
              {tx(t, "fixBeforePublish", "Fix {n} errors before publishing.", { n: blockers })}
            </p>
          </div>
        </div>
      ) : warnings.length > 0 ? (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-warning/25 bg-warning/5 px-3 py-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              {tx(t, "needsAttention", "Needs attention")}
              {rechecking && (
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  {tx(t, "rechecking", "Rechecking…")}
                </span>
              )}
            </p>
            <p className="text-xs text-fg-muted">
              {tx(
                t,
                "warningsNoBlock",
                "{n} warnings — publishing stays available once errors are fixed.",
              ).replace("{n}", String(warnings.length))}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-success/25 bg-success/5 px-3 py-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              {tx(t, "ready", "Ready")}
              {rechecking && (
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  {tx(t, "rechecking", "Rechecking…")}
                </span>
              )}
            </p>
            <p className="text-xs text-fg-muted">
              {tx(t, "readyHint", "No blocking issues — you can publish.")}
            </p>
          </div>
        </div>
      )}

      {blockers > 0 && !serverLoading && !serverError && (
        <section className="space-y-2" aria-labelledby="exact-blockers-title">
          <div>
            <h3 id="exact-blockers-title" className="text-sm font-bold text-fg">
              {tx(t, "exactBlockingIssues", "Exact blocking issues")}
            </h3>
            <p className="text-xs text-fg-muted">
              {tx(t, "exactBlockingIssuesHint", "Each message below is an exact reason publication is blocked.")}
            </p>
          </div>

          {client.filter((check) => check.level === "error").map((check, index) => (
            <Row
              key={`exact-client-${index}`}
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={humanizeProblem(check.label)}
              detail={check.detail}
              fix={() => onFix(check.target)}
            />
          ))}

          {exactServerErrors.map((item) => (
            <Row
              key={`exact-server-${item.key}`}
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={serverProblemTitle(item.key)}
              detail={item.detail || undefined}
              fix={() => onFix(readinessFixTarget(item.key, detail))}
            />
          ))}

          {provenanceLoading && importIssuesItem && !importIssuesItem.ok && (
            <div className="flex items-center gap-2 rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-fg-muted">
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              {tx(t, "loadingImportIssues", "Loading exact import issues…")}
            </div>
          )}

          {!provenanceLoading && openImportIssues.map((issue) => {
            const target = provenance ? issueSelection(detail, provenance, issue) : null;
            return (
              <div
                key={`exact-import-${issue.id}`}
                className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2"
              >
                <div className="flex items-start gap-2.5">
                  <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-fg">{issue.message}</p>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-fg-muted">
                      {issue.code} · {issue.path}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {target && (
                    <Button size="sm" variant="outline" onClick={() => onFix(target)}>
                      <Wrench className="size-3.5" aria-hidden />
                      {tx(t, "openLocation", "Open location")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    loading={resolvingIssueId === issue.id}
                    onClick={() => onResolveImportIssue(issue.id)}
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {tx(t, "markResolved", "Mark resolved")}
                  </Button>
                </div>
              </div>
            );
          })}

          {!provenanceLoading && importIssuesItem && !importIssuesItem.ok && openImportIssues.length === 0 && (
            <Row
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={tx(t, "importReviewIssue", "An import review issue is still open.")}
              detail={importIssuesItem.detail || undefined}
            />
          )}
        </section>
      )}

      {/* Refresh — server result is authoritative. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          loading={rechecking}
          aria-label={tx(t, "refreshReadiness", "Refresh readiness checks")}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {tx(t, "refresh", "Refresh")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onSaveDraft}>
          {tx(t, "saveDraft", "Save Draft")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onPreview}>
          <Eye className="size-4" aria-hidden />
          {tx(t, "preview", "Preview")}
        </Button>
        <p className="w-full text-[11px] text-fg-subtle sm:ml-auto sm:w-auto">
          {tx(
            t,
            "readinessStaleNote",
            "Readiness reflects saved data — save your drafts, then refresh.",
          )}
        </p>
      </div>

      {/* Cross-cutting server results (counts from actual data, no key contents). */}
      {!serverLoading && !serverError && answerKeysItem && !answerKeysItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title={
            missingKeyCount === 1
              ? "1 question is missing its answer key."
              : `${missingKeyCount} questions are missing answer keys.`
          }
          fix={() => {
            const target = readinessFixTarget("answer_keys", detail);
            if (target) onFix(target);
          }}
        />
      )}
      {!serverLoading && !serverError && manualPointsItem && !manualPointsItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title={
            manualPointsCount === 1
              ? "1 Writing/Speaking question is not set to 9 points."
              : `${manualPointsCount} Writing/Speaking questions are not set to 9 points.`
          }
          detail="Teacher-graded questions must be 9 points — open the task editor and save."
          fix={() => {
            const target = readinessFixTarget("manual_points", detail);
            if (target) onFix(target);
          }}
        />
      )}
      {!serverLoading && !serverError && listeningPartsItem && !listeningPartsItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title="Listening needs 4 parts."
          detail={listeningPartsItem.detail || undefined}
          fix={() => {
            const target = readinessFixTarget("listening_parts", detail);
            if (target) onFix(target);
          }}
        />
      )}
      {!serverLoading && !serverError && totalItem && !totalItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title="This exam has no questions yet."
          fix={() => onFix({ kind: "overview" })}
        />
      )}
      {!serverLoading && !serverError && hasContentItem && !hasContentItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title={tx(t, "noContent", "No content yet.")}
          detail={tx(
            t,
            "noContentHint",
            "Add at least one section with a group and a question.",
          )}
          fix={() => onFix({ kind: "overview" })}
        />
      )}
      {!serverLoading &&
        !serverError &&
        missingSectionItems.map((item) => {
          const skill = item.key.split("_")[0];
          const name = skill.charAt(0).toUpperCase() + skill.slice(1);
          return (
            <Row
              key={item.key}
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={`${name} section is missing.`}
              detail="Full Mock requires every section — add it from the overview."
              fix={() => onFix({ kind: "overview" })}
            />
          );
        })}
      {!serverLoading && !serverError && writingContentItem && !writingContentItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title="Writing has no essay task yet."
          detail={writingContentItem.detail || undefined}
          fix={() => {
            const target = readinessFixTarget("writing_content", detail);
            if (target) onFix(target);
          }}
        />
      )}
      {!serverLoading && !serverError && speakingContentItem && !speakingContentItem.ok && (
        <Row
          tone="error"
          icon={<XCircle className="size-4 text-danger" />}
          title="Speaking has no tasks yet."
          detail={speakingContentItem.detail || undefined}
          fix={() => {
            const target = readinessFixTarget("speaking_content", detail);
            if (target) onFix(target);
          }}
        />
      )}

      {/* Per-skill checklists. */}
      {detail.sections.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Row
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title="No sections yet."
              detail="Add Listening, Reading, Writing and Speaking from the sidebar."
              fix={() => onFix({ kind: "overview" })}
            />
          </CardContent>
        </Card>
      ) : (
        SKILLS.filter((skill) => detail.sections.some((s) => s.skill === skill)).map((skill) => (
          <SkillChecklist
            key={skill}
            skill={skill}
            detail={detail}
            client={client}
            serverItems={serverItems}
            serverReady={!serverLoading && !serverError}
            onFix={onFix}
          />
        ))
      )}
    </div>
  );
}

function SkillChecklist({
  skill,
  detail,
  client,
  serverItems,
  serverReady,
  onFix,
}: {
  skill: MockSkill;
  detail: MockExamDetail;
  client: Check[];
  serverItems: MockReadinessItem[];
  serverReady: boolean;
  onFix: (s: Selection) => void;
}) {
  const profile = detail.profile ?? "practice";
  const section = detail.sections.find((s) => s.skill === skill);
  const name = SKILL_NAME[skill];

  // Only configured sections get a checklist — unchosen skills are not errors.
  if (!section) return null;

  const sectionItem = serverReady ? serverItem(`${skill}_section`, serverItems) : undefined;
  const sectionMissing = sectionItem && !sectionItem.ok;

  const groups = section ? sortedGroups(section) : [];
  const readingPassages =
    skill === "reading" ? clusterReadingPassages(groups) : [];
  const groupChecks = (groupId: string) => client.filter((c) => c.target.kind === "group" && c.target.groupId === groupId);
  const sectionChecks = section
    ? client.filter((c) => c.target.kind === "section" && c.target.sectionId === section.id)
    : [];
  const sectionErrors = sectionChecks.filter((c) => c.level === "error");
  const sectionWarnings = sectionChecks.filter((c) => c.level === "warning");

  const groupErrorCount = groups.reduce(
    (n, g) => n + groupChecks(g.id).filter((c) => c.level === "error").length,
    0,
  );
  const issueCount = groupErrorCount + sectionErrors.length + (sectionMissing ? 1 : 0);

  let summary = "";
  if (skill === "listening") {
    if (groups.length === 0) {
      summary = "No parts yet";
    } else {
      const audioReady = groups.filter((g) => g.hasAudio).length;
      summary = `${groups.length} parts · ${audioReady}/${groups.length} audio ready`;
    }
  } else if (skill === "reading") {
    if (readingPassages.length === 0) {
      summary = "No passages yet";
    } else {
      const complete = readingPassages.filter(
        (passage) =>
          passage.questions.length > 0 &&
          (passage.passageText?.trim() ?? "") !== "" &&
          passage.groups.every(
            (group) => groupChecks(group.id).filter((c) => c.level === "error").length === 0,
          ),
      ).length;
      summary = `${readingPassages.length} passages · ${complete}/${readingPassages.length} complete`;
    }
  } else if (skill === "writing") {
    const t1 = groups.some((g) => g.questions.some((q) => q.type === "essay_task1"));
    const t2 = groups.some((g) => g.questions.some((q) => q.type === "essay_task2"));
    summary = `Task 1 ${t1 ? "ready" : "missing"} · Task 2 ${t2 ? "ready" : "missing"}`;
  } else {
    const qs = groups.reduce((a, g) => a + g.questions.length, 0);
    summary = `${groups.length} tasks · ${qs} questions`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {issueCount > 0 ? (
            <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          )}
          {name}
          <span className="text-xs font-normal text-fg-muted">{summary}</span>
          {issueCount > 0 && (
            <span className="ml-auto text-xs font-normal text-danger">
              {issueCount === 1 ? "1 error" : `${issueCount} errors`}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sectionMissing && (
          <Row
            tone="error"
            icon={<XCircle className="size-4 text-danger" />}
            title={`${name} section is missing.`}
            detail="Full Mock requires every section."
            fix={() => onFix({ kind: "overview" })}
          />
        )}
        {groups.length === 0 && (
          <Row
            tone="error"
            icon={<XCircle className="size-4 text-danger" />}
            title={`${name} has no ${skill === "listening" ? "parts" : skill === "reading" ? "passages" : "tasks"} yet.`}
            detail="Add the first one to start this section."
            fix={() => onFix({ kind: "section", sectionId: section.id })}
          />
        )}
        {skill === "reading"
          ? readingPassages.map((passage) => (
              <ReadingPassageCheckRow
                key={passage.groups[0].id}
                passage={passage}
                checksForGroup={groupChecks}
                onFix={onFix}
              />
            ))
          : groups.map((g) => (
              <GroupCheckRow
                key={g.id}
                skill={skill}
                groups={groups}
                group={g}
                checks={groupChecks(g.id)}
                onFix={onFix}
              />
            ))}
        {skill === "writing" &&
          profile === "full_mock" &&
          groups.length > 0 &&
          (() => {
            const rows: React.ReactNode[] = [];
            const t1 = groups.find((g) => g.questions.some((q) => q.type === "essay_task1"));
            const t2 = groups.find((g) => g.questions.some((q) => q.type === "essay_task2"));
            if (!t1) {
              rows.push(
                <Row
                  key="missing-t1"
                  tone="error"
                  icon={<XCircle className="size-4 text-danger" />}
                  title="Task 1 is not configured."
                  fix={() => onFix({ kind: "section", sectionId: section.id })}
                />,
              );
            }
            if (!t2) {
              rows.push(
                <Row
                  key="missing-t2"
                  tone="error"
                  icon={<XCircle className="size-4 text-danger" />}
                  title="Task 2 is not configured."
                  fix={() => onFix({ kind: "section", sectionId: section.id })}
                />,
              );
            }
            return rows;
          })()}
        {sectionErrors
          .filter((c) => !/missing Task [12]/.test(c.label))
          .filter((c) => !(groups.length === 0 && /has no (parts|passages|tasks)$/.test(c.label)))
          .map((c, i) => (
            <Row
              key={`se${i}`}
              tone="error"
              icon={<XCircle className="size-4 text-danger" />}
              title={humanizeProblem(c.label)}
              detail={c.detail}
              fix={() => onFix(c.target)}
            />
          ))}
        {sectionWarnings.map((c, i) => (
          <Row
            key={`sw${i}`}
            tone="warning"
            icon={<TriangleAlert className="size-4 text-warning" />}
            title={humanizeProblem(c.label)}
            detail={c.detail}
            fix={() => onFix(c.target)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ReadingPassageCheckRow({
  passage,
  checksForGroup,
  onFix,
}: {
  passage: ReadingPassageCluster<MockGroup>;
  checksForGroup: (groupId: string) => Check[];
  onFix: (s: Selection) => void;
}) {
  const checks = passage.groups.flatMap((group) =>
    checksForGroup(group.id).map((check) => ({ check, group })),
  );
  const errors = checks.filter(({ check }) => check.level === "error");
  const warnings = checks.filter(({ check }) => check.level === "warning");
  const title =
    passage.title && passage.title !== `Passage ${passage.ordinal}`
      ? `Passage ${passage.ordinal} · ${passage.title}`
      : `Passage ${passage.ordinal}`;
  const firstTarget =
    errors[0]?.check.target ??
    warnings[0]?.check.target ?? { kind: "group" as const, groupId: passage.groups[0].id };

  return (
    <div
      className={`min-w-0 rounded-[8px] border px-3 py-2 ${
        errors.length > 0 ? "border-danger-border bg-danger-bg" : "border-border"
      }`}
    >
      <div className="flex min-w-0 flex-col gap-2 min-[480px]:flex-row min-[480px]:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {errors.length > 0 ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          ) : warnings.length > 0 ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-fg">{title}</p>
            <p className="break-words text-[11px] text-fg-muted">
              {passage.questions.length} questions · {passage.groups.length} question sets · {passage.rangeLabel ? `Q${passage.rangeLabel}` : "no range"} · {passage.passageText?.trim() ? "passage ready" : "passage missing"}
            </p>
          </div>
        </div>
        <FixButton onFix={() => onFix(firstTarget)} label={title} />
      </div>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
          {[...errors, ...warnings].map(({ check, group }, index) => {
            const numbers = group.questions.map((question) => question.number);
            const range =
              numbers.length === 0
                ? "Question set"
                : Math.min(...numbers) === Math.max(...numbers)
                  ? `Q${numbers[0]}`
                  : `Q${Math.min(...numbers)}–${Math.max(...numbers)}`;
            return (
              <li
                key={`${check.level}-${group.id}-${index}`}
                className={`text-xs ${check.level === "error" ? "text-danger" : "text-warning"}`}
              >
                {range}: {humanizeProblem(check.label)}
                {check.detail && <span className="block text-fg-muted">{check.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupCheckRow({
  skill,
  groups,
  group,
  checks,
  onFix,
}: {
  skill: MockSkill;
  groups: MockGroup[];
  group: MockGroup;
  checks: Check[];
  onFix: (s: Selection) => void;
}) {
  const name = groupDisplayName(skill, groups, group);
  const errs = checks.filter((c) => c.level === "error");
  const warns = checks.filter((c) => c.level === "warning");

  let facts = "";
  if (skill === "listening") {
    facts = `${group.questions.length} questions · ${group.hasAudio ? "audio ready" : "audio missing"}`;
  } else if (skill === "reading") {
    facts = `${group.questions.length} questions · ${(group.passageText?.trim() ?? "") !== "" ? "passage ready" : "passage missing"}`;
  } else if (skill === "writing") {
    const prompt = group.questions.some((q) => q.prompt.trim() !== "");
    facts = prompt ? "Prompt ready · teacher graded" : "Prompt missing · teacher graded";
  } else {
    const prompt = group.questions.some((q) => q.prompt.trim() !== "");
    facts = `${group.questions.length} prompt${group.questions.length === 1 ? "" : "s"} · ${prompt ? "configured" : "prompt missing"}`;
  }

  return (
    <div
      className={`min-w-0 rounded-[8px] border px-3 py-2 ${
        errs.length > 0 ? "border-danger-border bg-danger-bg" : "border-border"
      }`}
    >
      <div className="flex min-w-0 flex-col gap-2 min-[480px]:flex-row min-[480px]:items-start min-[480px]:gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {errs.length > 0 ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          ) : warns.length > 0 ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-fg">{name}</p>
            <p className="break-words text-[11px] text-fg-muted">{facts}</p>
          </div>
        </div>
        <FixButton onFix={() => onFix({ kind: "group", groupId: group.id })} label={name} />
      </div>
      {(errs.length > 0 || warns.length > 0) && (
        <ul className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
          {errs.map((c, i) => (
            <li key={`e${i}`} className="text-xs text-danger">
              {humanizeProblem(c.label)}
              {c.detail && <span className="block text-fg-muted">{c.detail}</span>}
            </li>
          ))}
          {warns.map((c, i) => (
            <li key={`w${i}`} className="text-xs text-warning">
              {humanizeProblem(c.label)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
