"use client";

import * as React from "react";
import { Award, Clock, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/** A demo question as the public API sends it: never with its answer. */
export type DemoQuestion = {
  id: string;
  section: string;
  type: string;
  prompt: string;
  options: string[] | null;
  maxScore: number;
  passageText?: string | null;
  instructions?: string | null;
  audioUrl?: string | null;
};

/** POST tests/demo/:id/submit — the server checks the answers. */
type DemoScore = {
  autoScore: number;
  autoMax: number;
  perQuestion: { questionId: string; isCorrect: boolean | null; isGraded: boolean }[];
  bySection: { section: string; score: number; max: number }[];
};

/**
 * Public demo test. Questions come from the server without answers, and the score comes
 * from the server after submitting: the browser never holds a key or a transcript.
 */
export default function DemoRunner({
  testId,
  title,
  durationMinutes,
  questions,
}: {
  testId: string;
  title: string;
  durationMinutes?: number | null;
  questions: DemoQuestion[];
}) {
  const t = useTranslations("marketing");
  const tc = useTranslations("tests");
  const duration = durationMinutes && durationMinutes > 0 ? durationMinutes : null;

  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [score, setScore] = React.useState<DemoScore | null>(null);
  const [remaining, setRemaining] = React.useState<number | null>(duration ? duration * 60 : null);
  const submitted = score !== null;

  const submit = React.useCallback(async () => {
    if (submitting || score) return;
    setSubmitting(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/tests/demo/${encodeURIComponent(testId)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: DemoScore } & DemoScore;
      const data = body.data ?? body;
      setScore(data);
      try {
        localStorage.setItem(`demo-result-${testId}`, JSON.stringify({ total: data.autoScore, max: data.autoMax, date: new Date().toISOString(), title }));
      } catch {}
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }, [answers, score, submitting, testId, title]);

  // One tick per second; the last tick submits (time is up).
  React.useEffect(() => {
    if (remaining === null || remaining <= 0 || submitted) return;
    const id = setTimeout(() => {
      setRemaining(remaining - 1);
      if (remaining - 1 <= 0) void submit();
    }, 1000);
    return () => clearTimeout(id);
  }, [remaining, submitted, submit]);

  const answeredCount = questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length;
  const progress = Math.round((answeredCount / Math.max(1, questions.length)) * 100);
  const verdict = new Map((score?.perQuestion ?? []).map((row) => [row.questionId, row]));
  // A section the server did not check automatically (Writing/Speaking) has no score here.
  const autoChecked = (section: string) =>
    questions.some((q) => q.section === section && verdict.get(q.id)?.isGraded);
  const confirmSubmit = () => {
    if (confirm(t("demoSubmitConfirm"))) void submit();
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="line-clamp-2 text-lg font-bold tracking-tight text-fg sm:text-xl">{title}</h1>
          <p className="mt-1 text-xs text-fg-muted">
            {questions.length} {tc("questions")}
            {duration ? ` · ${duration} ${tc("minutes")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {remaining !== null && !submitted && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-sm font-semibold tabular-nums",
                remaining < 60 ? "bg-danger-bg text-danger" : "bg-bg-subtle text-fg",
              )}
            >
              <Clock className="size-4" />
              {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
            </span>
          )}
          <Badge variant="neutral">
            {answeredCount}/{questions.length} {tc("answered")}
          </Badge>
          {!submitted && (
            <Button size="sm" onClick={confirmSubmit} disabled={submitting}>
              <Trophy className="size-4" />
              {t("demoSubmit")}
            </Button>
          )}
        </div>
      </Card>

      <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
        <div className="h-full bg-brand transition-all duration-300" style={{ width: `${progress}%` }} aria-hidden />
      </div>

      {failed && (
        <p role="alert" className="rounded-[10px] border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
          {t("demoSubmitFailed")}
        </p>
      )}

      <Card className="p-5">
        <div className="space-y-3">
          {questions.map((q, index) => {
            const value = answers[q.id] ?? "";
            const row = verdict.get(q.id);
            return (
              <div key={q.id} className="flex items-start gap-3 rounded-[10px] border border-border bg-surface p-3">
                <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-bold text-brand-subtle-fg">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  {q.instructions && <p className="text-xs text-fg-muted">{q.instructions}</p>}
                  {q.passageText && <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{q.passageText}</p>}
                  {q.audioUrl && <audio controls preload="none" className="w-full" src={`/api${q.audioUrl}`} />}
                  <p className="text-sm leading-relaxed text-fg">{q.prompt}</p>
                  {q.options && q.options.length > 0 ? (
                    <div className="space-y-1.5">
                      {q.options.map((opt, i) => (
                        <label
                          key={i}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-2 text-sm transition-colors",
                            value === opt ? "border-brand bg-brand-subtle/40 text-fg" : "border-border hover:bg-surface-hover",
                          )}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            checked={value === opt}
                            onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                            className="accent-brand"
                            disabled={submitted}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <Input
                      value={value}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      disabled={submitted}
                      aria-label={tc("answerFor", { number: index + 1 })}
                    />
                  )}
                  {row && (
                    <p
                      className={cn(
                        "text-xs font-medium",
                        row.isCorrect === null ? "text-fg-muted" : row.isCorrect ? "text-success" : "text-danger",
                      )}
                    >
                      {row.isCorrect === null ? t("demoNotAutoChecked") : row.isCorrect ? tc("correct") : tc("incorrect")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!submitted && (
          <div className="mt-6 flex justify-end">
            <Button onClick={confirmSubmit} disabled={submitting}>
              {t("demoSubmit")} · {answeredCount}/{questions.length}
            </Button>
          </div>
        )}
      </Card>

      {score && (
        <Card className="p-6" data-testid="demo-result">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-fg">{t("demoResultTitle")}</h3>
              <p className="mt-1 text-sm text-fg-muted">{t("demoResultSubtitle")}</p>
            </div>
            <Award className="size-6 text-brand" aria-hidden />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[12px] border border-border bg-bg-subtle p-4 text-center">
              <p className="text-xs tracking-wide text-fg-subtle uppercase">{t("demoTotalScore")}</p>
              <p className="mt-2 text-3xl font-bold text-fg">
                {score.autoScore} <span className="text-lg font-medium text-fg-muted">/ {score.autoMax}</span>
              </p>
              {score.autoMax > 0 && (
                <p className="mt-1 text-xs text-fg-muted">{Math.round((score.autoScore / score.autoMax) * 100)}%</p>
              )}
            </div>

            {score.bySection.length > 0 && (
              <div className="rounded-[12px] border border-border bg-surface p-4 sm:col-span-2">
                <p className="text-xs tracking-wide text-fg-subtle uppercase">{t("demoPerSection")}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {score.bySection.map((v) => (
                    <div key={v.section} className="rounded-[8px] bg-bg-subtle px-3 py-2">
                      <p className="text-xs font-medium text-fg-muted capitalize">{v.section}</p>
                      {autoChecked(v.section) ? (
                        <p className="text-sm font-semibold text-fg">
                          {v.score} / {v.max}
                        </p>
                      ) : (
                        <p className="text-xs text-fg-muted">{t("demoNotAutoChecked")}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-[12px] border border-brand/20 bg-brand-subtle/30 p-4">
            <p className="text-sm font-semibold text-fg">{t("demoLoginCta")}</p>
            <p className="mt-1 text-sm text-fg-muted">{t("demoLoginCtaHint")}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link href={`/login?next=${encodeURIComponent(`/demo/${testId}`)}`} className={cn(buttonVariants({ size: "lg" }), "flex-1 justify-center")}>
                {t("demoLogin")}
              </Link>
              <Link
                href={`/register?next=${encodeURIComponent(`/demo/${testId}`)}`}
                className={cn(buttonVariants({ size: "lg", variant: "outline" }), "flex-1 justify-center")}
              >
                {t("demoRegister")}
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
