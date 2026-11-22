"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Flag, Play, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, formatDuration, useStudentHomework, type QuizAttempt, type QuizResult } from "@/lib/teacher-workspace";
import { cn } from "@/lib/utils";

type SaveState = "saving" | "saved" | "failed";

/** Website runner for a teacher's classroom quiz. Everything authoritative (timer, grading, attempts) is the server's:
 *  this screen only renders the issued questions, saves each answer immediately and shows the stored result. */
export function QuizRunner({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("tw");
  const list = useStudentHomework();
  const item = list.data?.find((i) => i.kind === "quiz" && i.id === assignmentId);
  const [attempt, setAttempt] = React.useState<QuizAttempt | null>(null);
  const [result, setResult] = React.useState<QuizResult | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadResult = React.useCallback(async (attemptId: string) => {
    setResult(await api.get<QuizResult>(`/class-quiz-attempts/${attemptId}/result`));
  }, []);

  // Resume an attempt in progress automatically (lost connection / reload): the server returns the same attempt.
  React.useEffect(() => {
    if (item?.activeAttemptId && !attempt && !result) {
      api.get<QuizAttempt | QuizResult>(`/class-quiz-attempts/${item.activeAttemptId}`)
        .then((r) => (r.status === "submitted" ? setResult(r as QuizResult) : setAttempt(r as QuizAttempt)))
        .catch((e) => setError(e instanceof ApiError ? e.message : t("common.loadError")));
    }
  }, [item?.activeAttemptId, attempt, result, t]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      setAttempt(await api.post<QuizAttempt>(`/class-quiz-assignments/${assignmentId}/start`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.loadError"));
    } finally {
      setStarting(false);
    }
  }

  if (list.isError || (list.data && !item)) {
    return <Shell><ErrorState title={list.isError ? t("common.loadError") : t("run.notFound")} action={<Button asChild variant="outline" size="sm"><Link href="/homework">{t("my.title")}</Link></Button>} /></Shell>;
  }
  if (!item) return <Shell><Skeleton className="h-64" /></Shell>;
  if (result) return <Shell><ResultView result={result} canRetry={!!item.attemptsLeft && item.canStart} onRetry={() => { setResult(null); void list.refetch(); }} /></Shell>;
  if (attempt) return <Shell><Runner attempt={attempt} onFinished={setResult} /></Shell>;

  return (
    <Shell>
      <Card className="p-5">
        <h1 className="text-xl font-bold text-fg">{item.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{item.groupName}{item.teacherName ? ` · ${item.teacherName}` : ""}</p>
        <ul className="mt-4 space-y-1 text-sm text-fg">
          <li>• {t("hw.questions", { n: item.questionCount ?? 0 })}</li>
          <li>• {item.timeLimitMinutes ? t("run.limit", { n: item.timeLimitMinutes }) : t("run.noLimit")}</li>
          <li>• {t("res.deadline")}: {formatDateTime(item.deadline)}</li>
          <li>• {t("run.serverTimer")}</li>
        </ul>
        {error && <p className="mt-3 rounded-control bg-danger-bg p-3 text-sm text-danger" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {item.canStart && <Button size="lg" onClick={start} loading={starting} data-testid="quiz-start"><Play />{t("run.start")}</Button>}
          {item.lastAttemptId && <Button size="lg" variant="outline" onClick={() => loadResult(item.lastAttemptId!)}>{t("my.viewResult")}</Button>}
          {!item.canStart && !item.lastAttemptId && <p className="text-sm text-fg-muted">{t("run.closed")}</p>}
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("tw");
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Link href="/homework" className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />{t("my.title")}</Link>
      {children}
    </div>
  );
}

function Runner({ attempt, onFinished }: { attempt: QuizAttempt; onFinished: (r: QuizResult) => void }) {
  const t = useTranslations("tw");
  const qc = useQueryClient();
  const questions = attempt.questions;
  const [index, setIndex] = React.useState(attempt.nextIndex ?? 0);
  const [answers, setAnswers] = React.useState<Record<string, string>>(attempt.savedAnswers);
  const [saving, setSaving] = React.useState<Record<string, SaveState>>(() => Object.fromEntries(Object.keys(attempt.savedAnswers).map((k) => [k, "saved" as SaveState])));
  const [confirm, setConfirm] = React.useState(false);
  const [finishing, setFinishing] = React.useState(false);
  // Server-authoritative clock: the local timer only counts down from the server's secondsLeft.
  const [deadline] = React.useState(() => Date.now() + attempt.secondsLeft * 1000);
  const [left, setLeft] = React.useState(attempt.secondsLeft);
  const q = questions[index];

  const finish = React.useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const r = await api.post<QuizResult>(`/class-quiz-attempts/${attempt.attemptId}/finish`);  // idempotent on the server
      await qc.invalidateQueries({ queryKey: ["student", "homework"] });
      onFinished(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.saveError"));
      setFinishing(false);
    }
  }, [attempt.attemptId, finishing, onFinished, qc, t]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      const s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { window.clearInterval(id); void finish(); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadline, finish]);

  // One request in flight per question; a newer choice made meanwhile is sent after it (never out of order).
  const inflight = React.useRef<Record<string, boolean>>({});
  const latest = React.useRef<Record<string, string>>({});
  async function save(questionId: string, response: string) {
    latest.current[questionId] = response;
    if (inflight.current[questionId]) return;
    inflight.current[questionId] = true;
    setSaving((s) => ({ ...s, [questionId]: "saving" }));
    let sent: string | undefined;
    try {
      do {
        sent = latest.current[questionId];
        const body = { questionId, response: questions.find((x) => x.id === questionId)?.type === "text" ? sent : Number(sent) };
        await api.post(`/class-quiz-attempts/${attempt.attemptId}/answer`, body);
      } while (latest.current[questionId] !== sent);
      setSaving((s) => ({ ...s, [questionId]: "saved" }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "TIME_UP") { void finish(); return; }
      setSaving((s) => ({ ...s, [questionId]: "failed" }));
    } finally {
      inflight.current[questionId] = false;
    }
  }

  function choose(value: string) {
    setAnswers((a) => ({ ...a, [q.id]: value }));
    void save(q.id, value);
  }

  const failed = Object.entries(saving).filter(([, v]) => v === "failed").map(([k]) => k);
  const answered = questions.filter((x) => (answers[x.id] ?? "") !== "").length;

  function retryFailed() {
    for (const id of failed) void save(id, answers[id] ?? "");
  }

  if (confirm) {
    return (
      <Card className="p-5">
        <p className="text-lg font-semibold text-fg">{t("run.confirmTitle")}</p>
        <p className="mt-1 text-sm text-fg-muted">{t("run.confirmBody", { a: answered, n: questions.length })}</p>
        {failed.length > 0 && <p className="mt-2 text-sm text-danger">{t("run.unsaved", { n: failed.length })}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" onClick={finish} loading={finishing} data-testid="quiz-confirm-finish"><Flag />{t("run.finishNow")}</Button>
          <Button size="lg" variant="outline" onClick={() => setConfirm(false)}>{t("run.keepGoing")}</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-card border border-border bg-surface-elevated p-3 shadow-e1">
        <span className="text-sm font-semibold text-fg">{t("run.question", { i: index + 1, n: questions.length })}</span>
        <span className="text-xs text-fg-muted">{t("run.answered", { a: answered, n: questions.length })}</span>
        <span className={cn("flex items-center gap-1 text-sm font-semibold tabular-nums", left < 60 ? "text-danger" : "text-fg")} aria-live="off" data-testid="quiz-timer">
          <Clock className="size-4" />{formatDuration(left)}
        </span>
      </div>
      {failed.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-danger-border bg-danger-bg p-3 text-sm text-danger">
          <span className="flex items-center gap-1.5"><WifiOff className="size-4" />{t("run.saveFailed", { n: failed.length })}</span>
          <Button size="sm" variant="outline" onClick={retryFailed}>{t("common.retry")}</Button>
        </div>
      )}
      <Card className="p-5">
        <p className="whitespace-pre-line text-base font-medium text-fg" data-testid="quiz-prompt">{q.prompt}</p>
        {q.type === "text" ? (
          <div className="mt-4">
            <input
              aria-label={t("run.yourAnswer")}
              className="h-12 w-full rounded-field border border-input-border bg-surface px-3 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              onBlur={(e) => e.target.value.trim() && save(q.id, e.target.value)}
              maxLength={500}
              autoComplete="off"
            />
          </div>
        ) : (
          <div role="radiogroup" aria-label={t("run.yourAnswer")} className="mt-4 grid gap-2">
            {q.options.map((option, i) => (
              <button key={i} type="button" role="radio" aria-checked={answers[q.id] === String(i)} onClick={() => choose(String(i))} data-testid="quiz-option"
                className={cn("min-h-12 rounded-control border p-3 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  answers[q.id] === String(i) ? "border-brand bg-brand-subtle font-semibold text-fg" : "border-border-strong bg-surface text-fg hover:bg-surface-hover")}>
                <span className="mr-2 font-semibold text-fg-muted">{String.fromCharCode(65 + i)})</span>{option}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 h-4 text-xs text-fg-subtle" aria-live="polite">{saving[q.id] === "saving" ? t("run.saving") : saving[q.id] === "saved" ? t("run.saved") : ""}</p>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="lg" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}><ArrowLeft />{t("run.prev")}</Button>
        {index < questions.length - 1 ? (
          <Button size="lg" onClick={() => setIndex(index + 1)} data-testid="quiz-next">{t("run.next")}<ArrowRight /></Button>
        ) : (
          <Button size="lg" onClick={() => setConfirm(true)} data-testid="quiz-finish"><Flag />{t("run.finish")}</Button>
        )}
      </div>
      <nav aria-label={t("run.jump")} className="flex flex-wrap gap-1.5">
        {questions.map((x, i) => (
          <button key={x.id} type="button" onClick={() => setIndex(i)} aria-current={i === index ? "step" : undefined} aria-label={t("run.question", { i: i + 1, n: questions.length })}
            className={cn("size-9 rounded-chip border text-xs font-semibold tabular-nums",
              i === index ? "border-brand bg-brand text-brand-fg" : (answers[x.id] ?? "") !== "" ? "border-brand/40 bg-brand-subtle text-fg" : "border-border bg-surface text-fg-muted")}>
            {i + 1}
          </button>
        ))}
      </nav>
    </div>
  );
}

function ResultView({ result, canRetry, onRetry }: { result: QuizResult; canRetry: boolean; onRetry: () => void }) {
  const t = useTranslations("tw");
  const wrong = (result.review ?? []).filter((r) => !r.isCorrect);
  return (
    <div className="space-y-3">
      <Card className="p-5 text-center" data-testid="quiz-result">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <p className="mt-2 text-sm text-fg-muted">{result.title}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-fg">{result.percent}%</p>
        <p className="text-sm text-fg">{t("run.correct", { c: result.correct, n: result.total })} · {t("run.time", { t: formatDuration(result.durationSeconds) })}</p>
        {result.autoSubmitted && <p className="mt-1 text-xs text-warning">{t("run.autoSubmitted")}</p>}
        <p className="mt-1 text-xs text-fg-subtle">{t("run.notBand")}</p>
        {canRetry && <Button className="mt-4" variant="outline" onClick={onRetry}>{t("my.retry")}</Button>}
      </Card>
      {wrong.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-fg">{t("res.mistakes", { n: wrong.length })}</h2>
          {!result.keysVisible && <p className="mb-2 text-sm text-fg-muted">{t("run.keysLater")}</p>}
          <ul className="space-y-2">
            {wrong.map((r) => (
              <li key={r.questionId} className="rounded-control border border-border p-3 text-sm">
                <p className="font-medium text-fg">{r.index + 1}. {r.prompt}</p>
                <p className="mt-1 text-danger">✗ {r.yourAnswer || t("res.noAnswer")}</p>
                {r.correctAnswer && <p className="text-success">✓ {r.correctAnswer}</p>}
                {r.explanation && <p className="mt-1 text-xs text-fg-muted">💡 {r.explanation}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
