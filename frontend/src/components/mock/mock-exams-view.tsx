"use client";

import * as React from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileQuestion,
  Headphones,
  Lock,
  Mic,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  BookOpenText,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import {
  useConfirmMockPurchase,
  useDeleteMockExam,
  useMockAttempts,
  useMockExams,
  useMyMockAttempts,
  useMockPurchases,
  usePurchaseMock,
  useStartMock,
} from "@/hooks/use-mock";
import type { ExamSimulatorMode, MockAttemptMode, MockPracticeSkill } from "@/lib/types";
import { ExamLauncherModal } from "./exam-launcher-modal";
import { ExamResumeModal } from "./exam-resume-modal";
import { LiveExamRoomPanel } from "@/components/teacher/live-exam-room-panel";
import { useMe } from "@/hooks/use-me";
import { useStudentProgramScope } from "@/hooks/use-exam-programs";
import { ExamTrackSelector } from "@/components/profile/exam-track-selector";
import { ExamTrackRequired } from "@/components/exam-track/exam-track-required";
import type { MockAttemptSummary, MockExamListItem, MockSkill } from "@/lib/types";
import { cn, formatMoney, formatPhone } from "@/lib/utils";
import { MultilevelReadiness } from "./multilevel-student-ui";
import { availablePracticeSkills } from "@/lib/mock-practice";
import { examProgress, matchesProgressFilter, type ExamProgress, type ProgressFilter } from "@/lib/exam-progress";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

const LEVELS = ["all", "A1", "A2", "B1", "B2", "C1"] as const;
type LevelFilter = (typeof LEVELS)[number];

type Tab = "exams" | "live" | "grading" | "purchases";

const PROGRESS_FILTERS: Array<{ id: ProgressFilter; key: "statusAll" | "statusNotStarted" | "statusInProgress" | "statusDone" }> = [
  { id: "all", key: "statusAll" },
  { id: "not_started", key: "statusNotStarted" },
  { id: "in_progress", key: "statusInProgress" },
  { id: "done", key: "statusDone" },
];

export function MockExamsView() {
  const t = useTranslations("mock");
  const tCat = useTranslations("mock.catalog");
  const tc = useTranslations("common");
  const { data: me } = useMe();
  const role = me?.user.role;
  const isStaff = role === "teacher" || role === "admin" || role === "super_admin";
  const isOffice = role === "admin" || role === "super_admin";
  const isStudent = role === "student";
  const scope = useStudentProgramScope();

  const [levelFilter, setLevelFilter] = React.useState<LevelFilter>("all");
  const [progressFilter, setProgressFilter] = React.useState<ProgressFilter>("all");
  const [tab, setTab] = React.useState<Tab>("exams");

  const examsQ = useMockExams(
    undefined,
    scope.program === "MULTILEVEL" && levelFilter !== "all" ? (levelFilter as any) : undefined
  );
  const attemptsQ = useMyMockAttempts();
  const purchase = usePurchaseMock();
  const deleteExam = useDeleteMockExam();

  const start = useStartMock();
  const router = useRouter();

  function onStart(
    examId: string,
    mode: MockAttemptMode,
    skills?: MockPracticeSkill[],
    simulatorMode?: ExamSimulatorMode
  ) {
    start.mutate(
      {
        examId,
        mode,
        ...(skills && skills.length > 0 ? { skills } : { flow: "full_test" }),
      },
      {
        onSuccess: (res) =>
          router.push(
            `/mock/attempt/${res.attemptId}${simulatorMode ? `?simulator=${simulatorMode}` : ""}`
          ),
        onError: (e) => toast.error(e instanceof Error ? e.message : tc("unknownError")),
      }
    );
  }

  function onBuy(id: string) {
    purchase.mutate(id, {
      onSuccess: () => toast.success(t("requestSent")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  // Filter exams by selected level
  const levelExams = React.useMemo(() => {
    const list = examsQ.data ?? [];
    if (levelFilter === "all") return list;
    return list.filter((e) => {
      const targetLvl = levelFilter.toUpperCase();
      const examLvl = (e.level || e.practiceLevel || "").toUpperCase();
      if (examLvl.includes(targetLvl)) return true;
      if (e.title.toUpperCase().includes(targetLvl)) return true;
      return false;
    });
  }, [examsQ.data, levelFilter]);

  // The student's own progress per exam, from their attempts only (no attempts data -> no chips, no filter).
  const myAttempts = attemptsQ.data;
  const progressById = React.useMemo(() => {
    const map = new Map<string, ExamProgress>();
    if (!isStudent || !myAttempts) return map;
    for (const e of levelExams) map.set(e.id, examProgress(myAttempts, e.id));
    return map;
  }, [isStudent, myAttempts, levelExams]);
  const showProgress = isStudent && !!myAttempts && myAttempts.length > 0;
  const progressCounts = React.useMemo(() => {
    const counts: Record<ProgressFilter, number> = { all: 0, not_started: 0, in_progress: 0, done: 0 };
    for (const p of progressById.values()) {
      counts.all += 1;
      for (const f of ["not_started", "in_progress", "done"] as const) if (matchesProgressFilter(p, f)) counts[f] += 1;
    }
    return counts;
  }, [progressById]);
  const displayedExams = React.useMemo(() => {
    if (!showProgress || progressFilter === "all") return levelExams;
    return levelExams.filter((e) => matchesProgressFilter(progressById.get(e.id) ?? "not_started", progressFilter));
  }, [levelExams, progressById, progressFilter, showProgress]);
  // Levels only mean something when exams carry one (Multilevel); IELTS lists hide the row.
  const showLevels = levelFilter !== "all" || (examsQ.data ?? []).some((e) => e.level || e.practiceLevel);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          isStaff ? (
            <Link href="/exam-builder/new">
              <Button size="sm" className="min-h-[44px]">
                <Plus />
                {t("create")}
              </Button>
            </Link>
          ) : undefined
        }
      />

      {isStudent && <ExamTrackSelector />}

      {/* Daraja filtri (A1–C1) */}
      {showLevels && (
      <div role="group" aria-label={tCat("levelFilter")} className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg mr-1">{tCat("level")}</span>
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            type="button"
            aria-pressed={levelFilter === lvl}
            onClick={() => setLevelFilter(lvl)}
            className={cn(
              "min-h-[44px] px-4 rounded-[8px] border text-sm font-medium transition-colors",
              levelFilter === lvl
                ? "border-brand bg-brand text-brand-fg"
                : "border-border bg-surface text-fg hover:border-brand/40"
            )}
          >
            {lvl === "all" ? tc("all") : lvl}
          </button>
        ))}
      </div>
      )}

      {/* Talabaning o'z natijasi bo'yicha filtr: faqat serverdagi urinishlardan */}
      {showProgress && tab === "exams" && !scope.needsProgramSelection && (
        <div role="group" aria-label={tCat("statusFilter")} className="flex gap-2 overflow-x-auto pb-1">
          {PROGRESS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={progressFilter === f.id}
              onClick={() => setProgressFilter(f.id)}
              className={cn(
                "min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-medium tabular-nums transition-colors",
                progressFilter === f.id
                  ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                  : "border-border bg-surface text-fg-muted hover:border-brand/40 hover:text-fg"
              )}
            >
              {tCat(f.key, { count: progressCounts[f.id] })}
            </button>
          ))}
        </div>
      )}

      {isStaff && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
          <TabsList>
            <TabsTrigger value="exams">{t("title")}</TabsTrigger>
            <TabsTrigger value="live">{tCat("liveTab")}</TabsTrigger>
            <TabsTrigger value="grading">{t("grading")}</TabsTrigger>
            {isOffice && <TabsTrigger value="purchases">{t("purchases")}</TabsTrigger>}
          </TabsList>
        </Tabs>
      )}

      {tab === "live" && isStaff ? (
        <LiveExamRoomPanel />
      ) : tab === "grading" && isStaff ? (
        <GradingPanel />
      ) : tab === "purchases" && isOffice ? (
        <PurchasesPanel />
      ) : isStudent && scope.needsProgramSelection ? (
        <ExamTrackRequired />
      ) : examsQ.isError ? (
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => examsQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : examsQ.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-[12px]" />
          ))}
        </div>
      ) : displayedExams.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={levelFilter !== "all" || (showProgress && progressFilter !== "all") ? tCat("noMatch") : t("noExams")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayedExams.map((e) => (
            <MockExamCard
              key={e.id}
              exam={e}
              isStaff={isStaff}
              isStudent={isStudent}
              attempts={attemptsQ.data ?? []}
              progress={progressById.get(e.id)}
              buying={purchase.isPending && purchase.variables === e.id}
              onBuy={() => onBuy(e.id)}
              onStart={(mode, skills, simulatorMode) => onStart(e.id, mode, skills, simulatorMode)}
              onDelete={async () => {
                await deleteExam.mutateAsync(e.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MockExamCard({
  exam,
  isStaff,
  isStudent,
  attempts,
  progress,
  buying,
  onBuy,
  onStart,
  onDelete,
}: {
  exam: MockExamListItem;
  isStaff: boolean;
  isStudent: boolean;
  attempts: MockAttemptSummary[];
  /** Student's own progress (from their attempts); undefined -> no chip. */
  progress?: ExamProgress;
  buying: boolean;
  onBuy: () => void;
  onStart?: (mode: MockAttemptMode, skills?: MockPracticeSkill[], simulatorMode?: ExamSimulatorMode) => void;
  onDelete?: () => Promise<unknown> | void;
}) {
  const t = useTranslations("mock");
  const tCat = useTranslations("mock.catalog");
  const tc = useTranslations("common");
  const [launcherOpen, setLauncherOpen] = React.useState(false);
  const [resumeOpen, setResumeOpen] = React.useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const multilevel = exam.type === "multilevel";
  const examAttempts = attempts.filter((attempt) => attempt.examId === exam.id);
  const inProgress = examAttempts.find((attempt) => attempt.status === "in_progress");

  const availableSkills: MockSkill[] = React.useMemo(() => {
    if (inProgress?.practiceScope?.skills && inProgress.practiceScope.skills.length > 0) {
      return inProgress.practiceScope.skills as MockSkill[];
    }
    if (exam.skills && exam.skills.length > 0) {
      return exam.skills;
    }
    return ["writing", "speaking"];
  }, [inProgress, exam.skills]);

  async function handleConfirmDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      toast.success(tCat("deleted"));
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("unknownError"));
    } finally {
      setDeleting(false);
    }
  }

  const levelTag = exam.level || (exam.profile === "practice" ? exam.practiceLevel : null);

  return (
    <Card
      className="flex h-full flex-col justify-between rounded-[12px] border border-border bg-surface p-5"
      data-testid={`mock-card-${exam.id}`}
    >
      <div className="space-y-3">
        {/* Yuqori teglari */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-sm">
            {multilevel ? "Multi-Level" : "IELTS"}
          </Badge>
          {levelTag && (
            <Badge variant="brand" className="text-sm">
              {levelTag}
            </Badge>
          )}
          {exam.isDemo && <Badge variant="neutral">{t("demo")}</Badge>}
          {progress === "in_progress" && <Badge variant="info">{tCat("chipInProgress")}</Badge>}
          {progress === "checking" && <Badge variant="warning">{tCat("chipChecking")}</Badge>}
          {progress === "completed" && <Badge variant="success">{tCat("chipCompleted")}</Badge>}
          {multilevel && <MultilevelReadiness ready={exam.ready} practiceReady={exam.practiceReady} />}
          {isStaff && (
            <Badge variant={exam.isPublished ? "success" : "warning"}>
              {exam.isPublished ? t("published") : t("draft")}
            </Badge>
          )}
        </div>

        {/* 1. Nomi */}
        <h3 className="text-xl font-semibold tracking-tight text-fg line-clamp-2">
          {exam.title}
        </h3>

        {/* 2. Davomiyligi va savollar soni */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
          {exam.durationMinutes != null && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4 shrink-0" />
              {exam.durationMinutes} {t("minutes")}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <FileQuestion className="size-4 shrink-0" />
            {exam.questionCount} {t("questions")}
          </span>
          {!exam.isDemo && exam.price > 0 && (
            <span className="font-semibold text-fg tabular-nums">
              {formatMoney(exam.price)} {tc("sum")}
            </span>
          )}
        </div>

        {/* 3. Bo'limlari */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
          {exam.skills.map((s) => {
            const Icon = SKILL_ICON[s];
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-[6px] border border-border bg-surface-elevated px-2 py-1 text-sm text-fg-muted"
              >
                <Icon className="size-3.5" />
                {t(`skills.${s}`)}
              </span>
            );
          })}
        </div>
      </div>

      {/* 4. Bitta asosiy tugma */}
      <div className="mt-5 pt-3">
        {isStaff ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/mock/${exam.id}`}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-border bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-elevated"
            >
              <ClipboardCheck className="size-4" />
              {t("manage")}
            </Link>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={tCat("deleteLabel")}
              title={tCat("deleteLabel")}
              onClick={() => setConfirmDeleteOpen(true)}
              className="min-h-[44px] min-w-[44px] border-danger/30 text-danger hover:bg-danger/10"
            >
              <Trash2 className="size-4" />
            </Button>
            <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{tCat("deleteTitle")}</DialogTitle>
                  <DialogDescription>
                    {tCat("deleteBody", { title: exam.title })}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmDeleteOpen(false)}
                    disabled={deleting}
                  >
                    {tc("cancel")}
                  </Button>
                  <Button
                    variant="danger"
                    loading={deleting}
                    onClick={() => void handleConfirmDelete()}
                  >
                    {tc("delete")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : multilevel && exam.ready === false && availablePracticeSkills(exam).length === 0 && !inProgress ? (
          <Button className="w-full min-h-[44px]" disabled>
            <Play className="fill-current mr-1.5 size-4" />
            {tCat("preparing")}
          </Button>
        ) : inProgress ? (
          <>
            {availableSkills.length > 1 ? (
              <Button
                className="w-full min-h-[44px] bg-brand hover:bg-brand/90 font-medium text-brand-fg text-base"
                onClick={() => setResumeOpen(true)}
              >
                <RefreshCw className="mr-2 size-4" />
                {t("resume")}
              </Button>
            ) : (
              <Link
                href={`/mock/attempt/${inProgress.id}`}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[8px] bg-brand hover:bg-brand/90 text-base font-medium text-brand-fg transition-colors"
              >
                <RefreshCw className="size-4" />
                {t("resume")}
              </Link>
            )}
            <ExamResumeModal
              open={resumeOpen}
              onOpenChange={setResumeOpen}
              attemptId={inProgress.id}
              skills={availableSkills}
              examTitle={exam.title}
            />
          </>
        ) : exam.access === "granted" ? (
          onStart ? (
            <>
              <Button
                className="w-full min-h-[44px] bg-brand hover:bg-brand/90 font-medium text-brand-fg text-base"
                onClick={() => setLauncherOpen(true)}
              >
                <Play className="size-4 fill-current mr-2" />
                {t("start")}
              </Button>
              <ExamLauncherModal
                open={launcherOpen}
                onOpenChange={setLauncherOpen}
                exam={exam}
                onStart={onStart}
              />
            </>
          ) : (
            <Link
              href={`/mock/${exam.id}`}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[8px] bg-brand hover:bg-brand/90 text-base font-medium text-brand-fg transition-colors"
            >
              <Play className="size-4 fill-current mr-2" />
              {t("start")}
            </Link>
          )
        ) : exam.access === "pending" ? (
          <Badge variant="warning" className="w-full justify-center min-h-[44px] text-sm">
            <Clock className="mr-1.5 size-4" /> {t("pending")}
          </Badge>
        ) : isStudent ? (
          <Button
            variant="outline"
            className="w-full min-h-[44px] text-base"
            loading={buying}
            onClick={onBuy}
          >
            <ShoppingCart className="mr-2 size-4" />
            {t("buy")}
          </Button>
        ) : (
          <Badge variant="neutral" className="w-full justify-center min-h-[44px] text-sm">
            <Lock className="mr-1.5 size-4" /> {t("locked")}
          </Badge>
        )}
      </div>
    </Card>
  );
}

function GradingPanel() {
  const t = useTranslations("mock");
  const tCat = useTranslations("mock.catalog");
  const ta = useTranslations("assessment");
  const [program, setProgram] = React.useState<"all" | "IELTS" | "MULTILEVEL">("all");
  const [status, setStatus] = React.useState<"grading" | "completed">("grading");
  const { data, isLoading, isError } = useMockAttempts(
    status,
    program === "all" ? undefined : program
  );
  const attempts = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">
          {tCat("gradingProgram")}
          <select
            aria-label={tCat("gradingProgramLabel")}
            value={program}
            onChange={(e) => setProgram(e.target.value as typeof program)}
            className="ml-2 rounded-[8px] border border-border bg-surface p-2 text-sm"
          >
            <option value="all">{tCat("gradingProgramAll")}</option>
            <option value="IELTS">IELTS</option>
            <option value="MULTILEVEL">Multilevel</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          {ta("queueFilter")}:
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="ml-2 rounded-[8px] border border-border bg-surface p-2 text-sm"
          >
            <option value="grading">{ta("pendingReview")}</option>
            <option value="completed">{ta("completedReview")}</option>
          </select>
        </label>
      </div>

      {isLoading && <Skeleton className="h-16 rounded-[12px]" />}
      {isError && <p role="alert" className="text-sm text-danger">{tCat("gradingLoadFailed")}</p>}
      {!isLoading && !isError && attempts.length === 0 && (
        <EmptyState icon={CheckCircle2} title={t("noAttempts")} />
      )}
      {attempts.map((a) => (
        <Link key={a.id} href={`/mock/attempt/${a.id}#assessment-feedback`}>
          <Card className="flex items-center justify-between gap-3 p-4 rounded-[12px] border border-border bg-surface transition-colors hover:bg-surface-elevated">
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{a.studentName ?? "—"}</p>
              <p className="truncate text-sm text-fg-muted">{a.examTitle}</p>
            </div>
            <Badge variant="warning">{t(`status.${a.status}`)}</Badge>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function PurchasesPanel() {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const { data, isLoading } = useMockPurchases("pending_confirmation");
  const confirm = useConfirmMockPurchase();
  const purchases = data ?? [];

  function onConfirm(examId: string, userId: string) {
    confirm.mutate(
      { examId, userId },
      {
        onSuccess: () => toast.success(t("confirmed")),
        onError: () => toast.error(tc("unknownError")),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-[12px]" />
        ))}
      </div>
    );
  }
  if (purchases.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("noPurchases")} />;
  }
  return (
    <div className="space-y-3">
      {purchases.map((p) => (
        <Card key={p.id} className="flex items-center justify-between gap-3 p-4 rounded-[12px] border border-border bg-surface">
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{p.userName}</p>
            <p className="truncate text-sm text-fg-muted">
              {formatPhone(p.userPhone)} · {p.examTitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm font-semibold text-fg tabular-nums">{formatMoney(p.amount)}</span>
            <Button
              size="sm"
              className="min-h-[44px]"
              loading={confirm.isPending}
              onClick={() => onConfirm(p.examId, p.userId)}
            >
              {t("confirm")}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
