"use client";

import * as React from "react";
import {
  ArrowLeft,
  Award,
  Check,
  X,
  RotateCcw,
  BookOpen,
  Lightbulb,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { useGradeAnswer, useStartTest } from "@/hooks/use-tests";
import { useMe } from "@/hooks/use-me";
import type { AttemptDetail, AttemptQuestion, TestSection } from "@/lib/types";
import { cn } from "@/lib/utils";

const MANUAL = new Set<string>(["writing", "speaking"]);
const SECTION_ORDER: TestSection[] = ["listening", "reading", "writing", "speaking"];

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  const v = t(key as never) as unknown;
  if (typeof v !== "string" || v === key || v.endsWith(`.${key}`)) return fallback;
  return v;
}

export function AttemptReview({ attempt }: { attempt: AttemptDetail }) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const router = useRouter();
  const { data: me } = useMe();
  const isStaff =
    me?.user.role === "teacher" || me?.user.role === "admin" || me?.user.role === "super_admin";
  const isStudent = me?.user.role === "student";
  const start = useStartTest();

  const totalMax = React.useMemo(() => attempt.questions.reduce((s, q) => s + q.maxScore, 0), [attempt.questions]);
  const totalScore = attempt.totalScore ?? attempt.questions.reduce((s, q) => s + (q.score ?? 0), 0);

  const perSection = React.useMemo(() => {
    const map = new Map<TestSection, { score: number; max: number; correct: number; total: number; graded: number }>();
    for (const q of attempt.questions) {
      const sec = q.section as TestSection;
      if (!map.has(sec)) map.set(sec, { score: 0, max: 0, correct: 0, total: 0, graded: 0 });
      const cur = map.get(sec)!;
      cur.max += q.maxScore;
      cur.total += 1;
      if (q.score !== null) {
        cur.score += q.score;
        cur.graded += 1;
        if (!MANUAL.has(q.section) && q.score > 0) cur.correct += 1;
        else if (!MANUAL.has(q.section) && q.score === 0) {
          // incorrect counted via not correct
        }
      }
    }
    return map;
  }, [attempt.questions]);

  const correctCount = attempt.questions.filter((q) => !MANUAL.has(q.section) && q.score !== null && q.score > 0).length;
  const autoTotal = attempt.questions.filter((q) => !MANUAL.has(q.section)).length;
  const progress = totalMax ? Math.round((totalScore / totalMax) * 100) : 0;

  function onRetake() {
    start.mutate(attempt.testId, {
      onSuccess: (res) => {
        toast.success(tFallback(t, "started", "Test started"));
        router.push(`/tests/attempt/${res.attemptId}`);
      },
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/tests"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {tFallback(t, "title", "Tests")}
      </Link>

      <PageHeader
        title={attempt.testTitle ?? tFallback(t, "result", "Result")}
        description={isStaff ? attempt.studentName : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {attempt.status === "completed" && isStudent && (
              <a
                href={`/api/backend/tests/attempts/${attempt.id}/certificate`}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-brand px-3 text-sm font-medium text-brand-fg hover:bg-brand-hover"
              >
                <Award className="size-4" />
                {tFallback(t, "certificate", "Certificate")}
              </a>
            )}
            {isStudent && (
              <Button variant="outline" size="sm" loading={start.isPending} onClick={onRetake}>
                <RotateCcw />
                {tFallback(t, "retake", "Retake")}
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href="/tests">{tFallback(t, "backToTests", "Back to tests")}</Link>
            </Button>
          </div>
        }
      />

      {/* Scores summary */}
      <Card className="mb-4 overflow-hidden">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge
                variant={
                  attempt.status === "completed" ? "success" : attempt.status === "grading" ? "warning" : "info"
                }
              >
                {tFallback(t, `statusLabel.${attempt.status}`, attempt.status)}
              </Badge>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-4xl font-bold tabular-nums text-fg">
                  {totalScore}
                  <span className="text-xl font-medium text-fg-subtle">/{totalMax}</span>
                </span>
                <span className="rounded-full bg-brand-subtle px-2.5 py-1 text-xs font-semibold text-brand-subtle-fg">
                  {progress}%
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
                {attempt.autoScore !== null && (
                  <span>
                    {tFallback(t, "autoScore", "Auto")}: <b className="text-fg">{attempt.autoScore}</b>
                  </span>
                )}
                {attempt.manualScore !== null && (
                  <span>
                    {tFallback(t, "manualScore", "Manual")}: <b className="text-fg">{attempt.manualScore}</b>
                  </span>
                )}
                {autoTotal > 0 && (
                  <span className="flex items-center gap-1">
                    <Trophy className="size-3.5" />
                    {correctCount}/{autoTotal} {tFallback(t, "correct", "Correct")}
                  </span>
                )}
                {isStaff && attempt.antiCheatCount > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <ShieldAlert className="size-3.5" />
                    {tFallback(t, "cheatFlags", "Suspicious")}: {attempt.antiCheatCount}
                  </span>
                )}
              </div>
            </div>

            {/* Circular progress visual */}
            <div className="hidden sm:flex size-20 shrink-0 items-center justify-center rounded-full border-4 border-brand-subtle bg-bg-subtle">
              <span className="text-lg font-bold text-brand tabular-nums">{progress}%</span>
            </div>
          </div>

          {/* progress bar */}
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                progress >= 70 ? "bg-success" : progress >= 50 ? "bg-brand" : "bg-warning",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* per-section */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SECTION_ORDER.filter((s) => perSection.has(s)).map((sec) => {
              const data = perSection.get(sec)!;
              const pct = data.max ? Math.round((data.score / data.max) * 100) : 0;
              return (
                <div key={sec} className="flex items-center justify-between rounded-[10px] border border-border bg-bg-subtle px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium capitalize text-fg">
                      {tFallback(t, `sections.${sec}`, sec)}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {data.graded}/{data.total} {tFallback(t, "graded", "graded")}
                      {sec === "listening" || sec === "reading" ? ` · ${data.correct}/${data.total - (MANUAL.has(sec) ? 0 : 0)} correct` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums text-fg">
                      {data.score}/{data.max}
                    </p>
                    <p className="text-xs font-medium text-fg-muted tabular-nums">{pct}%</p>
                  </div>
                </div>
              );
            })}
          </div>

          {attempt.status !== "completed" && (
            <p className="mt-3 flex items-center gap-1.5 rounded-[8px] bg-warning-bg px-3 py-2 text-xs text-warning">
              <Lightbulb className="size-3.5" />
              {tFallback(t, "gradingNotice", "Some sections (Writing/Speaking) are graded manually by your teacher. You’ll be notified when grading is complete.")}
            </p>
          )}
        </div>
      </Card>

      {/* Instructions / Tips */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <BookOpen className="size-4 text-brand" />
            {tFallback(t, "instructions", "Instructions")}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-fg-muted">
            <li>{tFallback(t, "tip1", "Review incorrect answers — correct answers are shown for auto-graded questions.")}</li>
            <li>{tFallback(t, "tip2", "For Writing/Speaking, check teacher feedback below each answer.")}</li>
          </ul>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Lightbulb className="size-4 text-warning" />
            {tFallback(t, "tips", "Tips")}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-fg-muted">
            <li>{tFallback(t, "tip3", "Retake the test to improve — your best score is saved in history.")}</li>
            <li>{tFallback(t, "tip4", "Download your certificate after completion (if available).")}</li>
          </ul>
        </Card>
      </div>

      {/* Questions review */}
      <div className="space-y-3">
        {attempt.questions.map((q) => (
          <QuestionReview key={q.questionId} q={q} attemptId={attempt.id} isStaff={!!isStaff} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/tests">{tFallback(t, "backToTests", "Back to tests")}</Link>
        </Button>
        {isStudent && (
          <Button loading={start.isPending} onClick={onRetake}>
            <RotateCcw />
            {tFallback(t, "retake", "Retake")}
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionReview({
  q,
  attemptId,
  isStaff,
}: {
  q: AttemptQuestion;
  attemptId: string;
  isStaff: boolean;
}) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const grade = useGradeAnswer(attemptId);
  const isManual = MANUAL.has(q.section);
  const [score, setScore] = React.useState(String(q.score ?? ""));
  const [comment, setComment] = React.useState(q.comment ?? "");

  const autoCorrect = !isManual && q.score !== null ? q.score > 0 : null;

  function submitGrade() {
    const s = Number(score);
    if (Number.isNaN(s) || s < 0 || s > q.maxScore) {
      toast.error(`${tFallback(t, "score", "Score")}: 0–${q.maxScore}`);
      return;
    }
    grade.mutate(
      { questionId: q.questionId, score: s, comment: comment.trim() || undefined },
      {
        onSuccess: () => toast.success(tFallback(t, "graded", "Graded")),
        onError: () => toast.error(tc("unknownError")),
      },
    );
  }

  const showCorrectBadge =
    autoCorrect !== null ? (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", autoCorrect ? "bg-success-bg text-success" : "bg-danger-bg text-danger")}>
        {autoCorrect ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        {autoCorrect ? tFallback(t, "correct", "Correct") : tFallback(t, "incorrect", "Incorrect")} · {q.score}/{q.maxScore}
      </span>
    ) : q.isGraded ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-brand-subtle-fg tabular-nums">
        <Check className="size-3.5" />
        {q.score}/{q.maxScore}
      </span>
    ) : isManual ? (
      <Badge variant="warning">{tFallback(t, "awaitingGrade", "Awaiting grade")}</Badge>
    ) : (
      <span className="text-xs text-fg-subtle tabular-nums">
        {q.score ?? "—"}/{q.maxScore}
      </span>
    );

  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-brand-subtle text-xs font-bold text-brand-subtle-fg tabular-nums">
            {q.order}
          </span>
          <Badge variant="neutral">{tFallback(t, `sections.${q.section}`, q.section)}</Badge>
          <span className="text-xs text-fg-subtle">{q.maxScore} pts</span>
        </div>
        {showCorrectBadge}
      </div>

      <p className="mb-2 whitespace-pre-wrap text-sm leading-relaxed text-fg">{q.prompt}</p>

      <div className={cn("rounded-[8px] px-3 py-2 text-sm", autoCorrect === false ? "bg-danger-bg/50" : "bg-bg-subtle")}>
        <span className="text-xs font-medium text-fg-subtle">{tFallback(t, "yourAnswer", "Your answer")}: </span>
        <span className={cn("font-medium", autoCorrect === false ? "text-danger" : "text-fg")}>
          {q.answer ? q.answer : <em className="font-normal text-fg-subtle">{tFallback(t, "noAnswer", "No answer")}</em>}
        </span>
      </div>

      {isStaff && q.correctAnswer && (
        <p className="mt-1.5 text-xs">
          <span className="font-medium text-success">{tFallback(t, "correctAnswer", "Correct answer")}:</span>{" "}
          <span className="text-success">{q.correctAnswer}</span>
        </p>
      )}
      {!isStaff && q.correctAnswer && autoCorrect === false && (
        <p className="mt-1.5 text-xs">
          <span className="font-medium text-success">{tFallback(t, "correctAnswer", "Correct answer")}:</span>{" "}
          <span className="font-medium text-success">{q.correctAnswer}</span>
        </p>
      )}

      {q.comment && (
        <div className="mt-2 rounded-[8px] border border-border bg-surface px-3 py-2">
          <p className="text-xs font-medium text-fg-muted">{tFallback(t, "comment", "Feedback")}:</p>
          <p className="mt-0.5 text-sm text-fg">{q.comment}</p>
        </div>
      )}

      {/* Teacher grading form */}
      {isStaff && isManual && (
        <div className="mt-4 rounded-[10px] border border-border bg-bg-subtle p-3">
          <p className="mb-2 text-xs font-semibold text-fg-muted">{tFallback(t, "gradeSection", "Grade this answer")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-24 shrink-0">
              <label className="text-xs text-fg-muted">
                {tFallback(t, "score", "Score")} (0–{q.maxScore})
              </label>
              <Input type="number" min={0} max={q.maxScore} step={0.5} value={score} onChange={(e) => setScore(e.target.value)} className="h-9" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-fg-muted">{tFallback(t, "comment", "Feedback")}</label>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tFallback(t, "commentPlaceholder", "Good structure, watch grammar...")} className="h-9" />
            </div>
            <Button size="sm" loading={grade.isPending && grade.variables?.questionId === q.questionId} onClick={submitGrade} className="shrink-0">
              {tFallback(t, "grade", "Grade")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
