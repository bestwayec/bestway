"use client";

import * as React from "react";
import {
  ArrowLeft,
  BookOpenText,
  Clock,
  FileQuestion,
  Headphones,
  Lock,
  Mic,
  PenLine,
  Play,
  RefreshCw,
  ShoppingCart,
  Timer,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import {
  useMockExam,
  useMyMockAttempts,
  usePurchaseMock,
  useStartMock,
} from "@/hooks/use-mock";
import type { MockAttemptMode, MockPracticeSkill, MockSkill } from "@/lib/types";
import { availablePracticeSkills } from "@/lib/mock-practice";
import { ExamResumeModal } from "./exam-resume-modal";
import { displayTotalMinutes } from "@/lib/mock-timing";
import { formatMoney } from "@/lib/utils";
import { MultilevelReadiness, studentStartMessage } from "./multilevel-student-ui";
import { useMe } from "@/hooks/use-me";
import { AttemptScoreSummary } from "./attempt-score-summary";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

export function MockExamDetailView({ examId }: { examId: string }) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const router = useRouter();
  const me = useMe();
  const staff = ["teacher", "admin", "super_admin"].includes(me.data?.user.role ?? "");
  const examQ = useMockExam(examId);
  const attemptsQ = useMyMockAttempts();
  const start = useStartMock();
  const purchase = usePurchaseMock();

  const searchParams = useSearchParams();
  const initialSkill = (searchParams?.get("section") || searchParams?.get("skill")) as MockPracticeSkill | null;
  const exam = examQ.data;
  const practiceSkills = exam ? availablePracticeSkills(exam) : [];
  const [selectedPractice, setSelectedPractice] = React.useState<MockPracticeSkill[] | null>(() =>
    initialSkill ? [initialSkill] : null
  );
  const [resumeOpen, setResumeOpen] = React.useState(false);
  React.useEffect(() => {
    if (initialSkill) setSelectedPractice([initialSkill]);
  }, [initialSkill]);
  const selectedSkills = practiceSkills.filter((skill) => selectedPractice === null || selectedPractice.includes(skill));
  const attempts = (attemptsQ.data ?? []).filter((a) => a.examId === examId);
  const inProgress = attempts.find((a) => a.status === "in_progress");
  const availableSkills: MockSkill[] = React.useMemo(() => {
    if (inProgress?.practiceScope?.skills && inProgress.practiceScope.skills.length > 0) {
      return inProgress.practiceScope.skills as MockSkill[];
    }
    if (exam?.sections && exam.sections.length > 0) {
      return exam.sections.map((s) => s.skill);
    }
    return ["writing", "speaking"];
  }, [inProgress, exam?.sections]);

  function onStart(mode: MockAttemptMode, skills?: MockPracticeSkill[]) {
    if (exam?.ready === false && !(skills?.length && practiceSkills.length)) {
      toast.error("Exam is not ready yet.");
      return;
    }
    start.mutate(
      { examId, mode, ...(skills ? { skills } : {}) },
      {
        onSuccess: (res) => router.push(`/mock/attempt/${res.attemptId}`),
        onError: (e) => toast.error(exam?.type === "multilevel" ? studentStartMessage(e) : (e instanceof Error ? e.message : tc("unknownError"))),
      },
    );
  }

  function onBuy() {
    purchase.mutate(examId, {
      onSuccess: () => toast.success(t("requestSent")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  if (examQ.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => examQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (examQ.isLoading || !exam) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const locked = exam.access === "locked";
  const pending = exam.access === "pending";
  const unavailable = exam.ready === false;
  const multilevel = exam.type === "multilevel";

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/mock"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {t("title")}
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{t(`types.${exam.type}`)}</Badge>
          {exam.isDemo && <Badge variant="neutral">{t("demo")}</Badge>}
          {exam.level && <span className="text-sm text-fg-subtle">{exam.level}</span>}
          {multilevel && <MultilevelReadiness ready={exam.ready} practiceReady={exam.practiceReady} />}
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-fg">{exam.title}</h1>
        {exam.description && <p className="mt-2 text-fg-muted">{exam.description}</p>}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-fg-muted">
          <span className="flex items-center gap-1.5">
            <FileQuestion className="size-4" />
            {exam.questionCount} {t("questions")}
          </span>
          {displayTotalMinutes(exam.sections) != null && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" />
              {displayTotalMinutes(exam.sections)} {t("minutes")}
            </span>
          )}
        </div>

        {multilevel && <p className="mt-4 text-sm font-medium text-fg-muted">Listening · Reading · Writing · Speaking</p>}

        {/* Bo'limlar */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {exam.sections.map((sec) => {
            const Icon = SKILL_ICON[sec.skill];
            const qCount = sec.groups.reduce((g, grp) => g + grp.questions.length, 0);
            return (
              <div
                key={sec.id}
                className="flex items-center gap-3 rounded-[10px] border border-border bg-bg-subtle px-3 py-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-subtle-fg">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{t(`skills.${sec.skill}`)}</p>
                  <p className="text-xs text-fg-muted">
                    {multilevel && (sec.skill === "writing" || sec.skill === "speaking") ? t(sec.skill === "writing" ? "authoredWritingTasks" : "authoredSpeakingParts", { count: sec.groups.length, questions: qCount }) : `${qCount} ${t("questions")}${sectionMinutes(sec.durationMinutes, exam.specification?.[sec.skill]?.durationSeconds) ? ` · ${sectionMinutes(sec.durationMinutes, exam.specification?.[sec.skill]?.durationSeconds)} ${t("minutes")}` : ""}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {!staff && !inProgress && exam.access === "granted" && practiceSkills.length > 0 && (
          <div className="mt-5 space-y-4 rounded-xl border border-brand/30 bg-brand-subtle/30 p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-fg">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">1</span>
                  Alohida bo&apos;lim topshirish (Single Skill)
                </h3>
                <p className="mt-1 text-xs text-fg-muted">{t("practiceSelectionHint")}</p>
              </div>
              <Badge variant="brand" className="text-xs">{t("practiceSelectionTitle")}</Badge>
            </div>

            <fieldset className="mt-2">
              <legend className="sr-only">{t("choosePracticeSkills")}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {practiceSkills.map((skill) => {
                  const isSelected = selectedSkills.includes(skill);
                  const sec = exam.sections.find((s) => s.skill === skill);
                  const qCount = sec ? sec.groups.reduce((g, grp) => g + grp.questions.length, 0) : null;
                  const emoji = skill === "listening" ? "🎧" : skill === "reading" ? "📖" : skill === "writing" ? "✍️" : "🎤";
                  return (
                    <div
                      key={skill}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPractice([skill])}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setSelectedPractice([skill]); } }}
                      className={`group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border p-3.5 text-center transition-all ${
                        isSelected
                          ? "border-brand bg-brand/10 text-brand shadow-xs ring-2 ring-brand/30"
                          : "border-border bg-surface text-fg hover:border-brand/40 hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-lg">{emoji}</span>
                        <label className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedPractice([...selectedSkills, skill]);
                              } else {
                                setSelectedPractice(selectedSkills.filter((item) => item !== skill));
                              }
                            }}
                            className="size-4 rounded accent-brand"
                          />
                        </label>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-sm font-semibold capitalize">{t(`skills.${skill}`)}</span>
                        {qCount != null && (
                          <span className="text-xs text-fg-muted">{qCount} {t("questions")}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            {exam.practiceQuestionCount != null && (
              <p className="text-xs text-fg-muted">{t("availablePracticeTasks", { count: exam.practiceQuestionCount })}</p>
            )}

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1 font-medium bg-surface hover:bg-surface-hover"
                disabled={selectedSkills.length === 0}
                loading={start.isPending && start.variables?.mode === "practice"}
                onClick={() => onStart("practice", selectedSkills)}
              >
                <Play className="fill-current text-brand" />
                {t("startSelectedPractice")} (Mashq)
              </Button>
              <Button
                className="flex-1 font-medium"
                disabled={selectedSkills.length === 0}
                loading={start.isPending && start.variables?.mode === "timed"}
                onClick={() => onStart("timed", selectedSkills)}
              >
                <Timer />
                {t("timed")} rejimida boshlash
              </Button>
            </div>
          </div>
        )}

        {/* Boshlash / sotib olish */}
        <div className="mt-6 border-t border-border pt-5">
          {staff ? (
            <Link href={`/exam-builder/${examId}`}><Button className="w-full" variant="outline">{t("manage")}</Button></Link>
          ) : inProgress ? (
            <>
              {availableSkills.length > 1 ? (
                <Button
                  className="w-full"
                  onClick={() => setResumeOpen(true)}
                >
                  <RefreshCw className="mr-2 size-4" />
                  {t("resume")}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  loading={start.isPending}
                  onClick={() => router.push(`/mock/attempt/${inProgress.id}`)}
                >
                  <RefreshCw />
                  {t("resume")}
                </Button>
              )}
              <ExamResumeModal
                open={resumeOpen}
                onOpenChange={setResumeOpen}
                attemptId={inProgress.id}
                skills={availableSkills}
                examTitle={exam.title}
              />
            </>
          ) : unavailable ? (
            <div className="space-y-2">
              <p className="text-sm text-fg-muted">This exam is still being prepared.</p>
              <Button className="w-full" disabled><Play className="fill-current" />Start Exam</Button>
            </div>
          ) : locked ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Lock className="size-4" />
                {exam.price > 0 && (
                  <span className="font-semibold text-fg tabular-nums">
                    {formatMoney(exam.price)} {tc("sum")}
                  </span>
                )}
              </p>
              <Button loading={purchase.isPending} onClick={onBuy}>
                <ShoppingCart />
                {t("buy")}
              </Button>
            </div>
          ) : pending ? (
            <Badge variant="warning" className="w-full justify-center py-2">
              <Clock /> {t("pending")}
            </Badge>
          ) : (
            <div className="space-y-3 rounded-xl border border-border bg-bg-subtle/40 p-4">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-fg">
                  <span className="flex size-5 items-center justify-center rounded-full bg-fg-muted/20 text-[11px] font-bold text-fg">2</span>
                  To&apos;liq imtihon (Full Mock)
                </h3>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Barcha bo&apos;limlarni rasmiy formatda ketma-ket topshirish
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1"
                variant="outline"
                loading={start.isPending && start.variables?.mode === "practice"}
                onClick={() => onStart("practice")}
              >
                <Play className="fill-current" />
                {t("practice")}
              </Button>
              <Button
                className="flex-1"
                loading={start.isPending && start.variables?.mode === "timed"}
                onClick={() => onStart("timed")}
              >
                <Timer />
                {t("timed")}
              </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Oldingi urinishlar */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-fg-muted">{t("myResults")}</h2>
        {attemptsQ.isLoading ? (
          <Skeleton className="h-16" />
        ) : attempts.filter((a) => a.status !== "in_progress").length === 0 ? (
          <EmptyState icon={FileQuestion} title={t("noAttempts")} />
        ) : (
          <div className="space-y-2">
            {attempts
              .filter((a) => a.status !== "in_progress")
              .map((a) => (
                <Link key={a.id} href={`/mock/attempt/${a.id}#assessment-feedback`}>
                  <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-surface-hover">
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={a.status === "completed" ? "success" : "warning"}
                      >
                        {t(`status.${a.status}`)}
                      </Badge>
                      <span className="text-sm text-fg-muted">
                        {new Date(a.startedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-right">
                      <AttemptScoreSummary attempt={a} />
                    </div>
                  </Card>
                </Link>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function sectionMinutes(savedMinutes: number | null, specificationSeconds: number | undefined): number | null {
  if (specificationSeconds != null) return Math.round(specificationSeconds / 60);
  return savedMinutes;
}
