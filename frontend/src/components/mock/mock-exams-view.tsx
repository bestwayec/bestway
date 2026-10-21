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
import { LiveExamPinCard } from "./live-exam-pin-card";
import { LiveExamRoomPanel } from "@/components/teacher/live-exam-room-panel";
import { useMe } from "@/hooks/use-me";
import { useStudentProgramScope } from '@/hooks/use-exam-programs';
import { ExamTrackSelector } from '@/components/profile/exam-track-selector';
import { ExamTrackRequired } from '@/components/exam-track/exam-track-required';
import type { MockAttemptSummary, MockExamListItem, MockSkill } from "@/lib/types";
import { formatMoney, formatPhone } from "@/lib/utils";
import { MultilevelReadiness } from "./multilevel-student-ui";
import { availablePracticeSkills } from "@/lib/mock-practice";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

type Tab = "exams" | "live" | "grading" | "purchases";

export function MockExamsView() {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const { data: me } = useMe();
  const role = me?.user.role;
  const isStaff = role === "teacher" || role === "admin" || role === "super_admin";
  const isOffice = role === "admin" || role === "super_admin";
  const isStudent = role === "student";
  const scope = useStudentProgramScope();
  const tt = useTranslations('examTrack');
  const [practiceLevel, setPracticeLevel] = React.useState<'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'all'>('all');

  const [tab, setTab] = React.useState<Tab>("exams");
  const examsQ = useMockExams(undefined, scope.program === 'MULTILEVEL' && practiceLevel !== 'all' ? practiceLevel : undefined);
  const attemptsQ = useMyMockAttempts();
  const purchase = usePurchaseMock();
  const deleteExam = useDeleteMockExam();

  const start = useStartMock();
  const router = useRouter();

  function onStart(examId: string, mode: MockAttemptMode, skills?: MockPracticeSkill[], simulatorMode?: ExamSimulatorMode) {
    start.mutate(
      { examId, mode, ...(skills ? { skills } : {}) },
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

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          isStaff ? (
            <Link href="/exam-builder/new">
              <Button size="sm">
                <Plus />
                {t("create")}
              </Button>
            </Link>
          ) : undefined
        }
      />

      {isStudent && (
        <div className="mb-5">
          <LiveExamPinCard />
        </div>
      )}
      {isStudent && <ExamTrackSelector />}
      {isStudent && scope.program === 'MULTILEVEL' && <label className="mb-4 block text-sm">{tt('practiceLevel')} <select aria-label={tt('practiceLevel')} value={practiceLevel} onChange={(e) => setPracticeLevel(e.target.value as typeof practiceLevel)} className="ml-2 rounded border border-border bg-surface p-2"><option value="all">{tt('allLevels')}</option>{(['A1','A2','B1','B2','C1'] as const).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>}
      {isStaff && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
          <TabsList>
            <TabsTrigger value="exams">{t("title")}</TabsTrigger>
            <TabsTrigger value="live">Live Exam Room (PIN)</TabsTrigger>
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
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : (examsQ.data?.length ?? 0) === 0 ? (
        <EmptyState icon={ClipboardCheck} title={t("noExams")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {examsQ.data!.map((e) => (
            <MockExamCard
              key={e.id}
              exam={e}
              isStaff={isStaff}
              isStudent={isStudent}
              attempts={attemptsQ.data ?? []}
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

      {/*
        Authoring lives solely in the unified Exam Builder (/exam-builder/new,
        /exam-builder/[id]). The legacy Mock*Dialog authoring path was removed;
        the shared question core in components/mock/exam-builder/
        (QuestionEditor.tsx, types.ts) is still live — imported by
        components/exam-builder/* — and is not dead code.
      */}
    </div>
  );
}

export function MockExamCard({
  exam,
  isStaff,
  isStudent,
  attempts,
  buying,
  onBuy,
  onStart,
  onDelete,
}: {
  exam: MockExamListItem;
  isStaff: boolean;
  isStudent: boolean;
  attempts: MockAttemptSummary[];
  buying: boolean;
  onBuy: () => void;
  onStart?: (mode: MockAttemptMode, skills?: MockPracticeSkill[], simulatorMode?: ExamSimulatorMode) => void;
  onDelete?: () => Promise<unknown> | void;
}) {
  const t = useTranslations("mock");
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
      toast.success("Imtihon muvaffaqiyatli o'chirildi");
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("unknownError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info">{t(`types.${exam.type}`)}</Badge>
        {exam.isDemo && <Badge variant="neutral">{t("demo")}</Badge>}
        {multilevel && <MultilevelReadiness ready={exam.ready} practiceReady={exam.practiceReady} />}
        {isStaff && (
          <Badge variant={exam.isPublished ? "success" : "warning"}>
            {exam.isPublished ? t("published") : t("draft")}
          </Badge>
        )}
        {exam.type === 'multilevel' && exam.profile === 'practice' ? exam.practiceLevel && <span className="text-xs text-fg-subtle">{exam.practiceLevel} practice</span> : exam.level && <span className="text-xs text-fg-subtle">{exam.level}</span>}
      </div>

      <h3 className="mt-3 line-clamp-2 font-semibold text-fg">{exam.title}</h3>
      {exam.description && (
        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{exam.description}</p>
      )}

      {multilevel && <p className="mt-3 text-sm font-medium text-fg-muted">Listening · Reading · Writing · Speaking</p>}
      <div className="mt-3 flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
        <span className="flex items-center gap-1.5">
          {exam.skills.map((s) => {
            const Icon = SKILL_ICON[s];
            return <Icon key={s} className="size-3.5" aria-label={t(`skills.${s}`)} />;
          })}
        </span>
        <span className="flex items-center gap-1">
          <FileQuestion className="size-3.5" />
          {exam.questionCount} {t("questions")}
        </span>
        {exam.durationMinutes != null && (
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {exam.durationMinutes} {t("minutes")}
          </span>
        )}
        {!exam.isDemo && exam.price > 0 && (
          <span className="font-semibold text-fg tabular-nums">
            {formatMoney(exam.price)} {tc("sum")}
          </span>
        )}
        {isStudent && <span>{examAttempts.length} {examAttempts.length === 1 ? "attempt" : "attempts"}</span>}
      </div>

      <div className="mt-4">
        {isStaff ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/mock/${exam.id}`}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              <ClipboardCheck className="size-4" />
              {t("manage")}
            </Link>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Imtihonni o'chirish"
              title="Imtihonni o'chirish"
              onClick={() => setConfirmDeleteOpen(true)}
              className="h-9 w-9 border-danger/30 text-danger hover:bg-danger/10"
            >
              <Trash2 className="size-4" />
            </Button>
            <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Imtihonni o&apos;chirishni tasdiqlang</DialogTitle>
                  <DialogDescription>
                    &ldquo;{exam.title}&rdquo; imtihonini butunlay o&apos;chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo&apos;lmaydi.
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
                    O&apos;chirish
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : multilevel && exam.ready === false && availablePracticeSkills(exam).length === 0 && !inProgress ? (
          <Button className="w-full" disabled>
            <Play className="fill-current" />
            Start Exam
          </Button>
        ) : inProgress ? (
          <>
            {availableSkills.length > 1 ? (
              <Button
                className="w-full bg-brand font-semibold text-white transition-colors hover:bg-brand-hover"
                onClick={() => setResumeOpen(true)}
              >
                <RefreshCw className="mr-1.5 size-4" />
                {t("resume")}
              </Button>
            ) : (
              <Link
                href={`/mock/attempt/${inProgress.id}`}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
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
                className="w-full bg-brand font-semibold text-white transition-colors hover:bg-brand-hover"
                onClick={() => setLauncherOpen(true)}
              >
                <Play className="size-4 fill-current mr-1.5" />
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
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              <Play className="size-4 fill-current mr-1.5" />
              {t("start")}
            </Link>
          )
        ) : exam.access === "pending" ? (
          <Badge variant="warning" className="w-full justify-center py-1.5">
            <Clock /> {t("pending")}
          </Badge>
        ) : isStudent ? (
          <Button variant="outline" size="sm" className="w-full" loading={buying} onClick={onBuy}>
            <ShoppingCart />
            {t("buy")}
          </Button>
        ) : (
          <Badge variant="neutral" className="w-full justify-center py-1.5">
            <Lock /> {t("locked")}
          </Badge>
        )}
      </div>
    </Card>
  );
}

function GradingPanel() {
  const t = useTranslations("mock");
  const ta = useTranslations("assessment");
  const [program, setProgram] = React.useState<'all' | 'IELTS' | 'MULTILEVEL'>('all');
  const [status, setStatus] = React.useState<'grading' | 'completed'>('grading');
  const { data, isLoading, isError } = useMockAttempts(status, program === 'all' ? undefined : program);
  const attempts = data ?? [];
  return (
    <div className="space-y-2">
      <label className="block text-sm">Exam program <select aria-label="Filter submissions by exam program" value={program} onChange={(event)=>setProgram(event.target.value as typeof program)} className="ml-2 rounded border border-border bg-surface p-2"><option value="all">All programs</option><option value="IELTS">IELTS</option><option value="MULTILEVEL">Multilevel</option></select></label>
      <label className="block text-sm">{ta("queueFilter")} <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="ml-2 rounded border border-border bg-surface p-2"><option value="grading">{ta("pendingReview")}</option><option value="completed">{ta("completedReview")}</option></select></label>
      {isLoading && <Skeleton className="h-16" />}
      {isError && <p role="alert">Could not load submissions.</p>}
      {!isLoading && !isError && attempts.length === 0 && <EmptyState icon={CheckCircle2} title={t("noAttempts")} />}
      {attempts.map((a) => (
        <Link key={a.id} href={`/mock/attempt/${a.id}#assessment-feedback`}>
          <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-surface-hover">
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{a.studentName ?? "—"}</p>
              <p className="truncate text-xs text-fg-muted">{a.examTitle}</p>
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
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (purchases.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("noPurchases")} />;
  }
  return (
    <div className="space-y-2">
      {purchases.map((p) => (
        <Card key={p.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{p.userName}</p>
            <p className="truncate text-xs text-fg-muted">
              {formatPhone(p.userPhone)} · {p.examTitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm text-fg-muted tabular-nums">{formatMoney(p.amount)}</span>
            <Button size="sm" loading={confirm.isPending} onClick={() => onConfirm(p.examId, p.userId)}>
              {t("confirm")}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
