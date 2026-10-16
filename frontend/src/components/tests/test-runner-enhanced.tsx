"use client";

import * as React from "react";
import { AlertTriangle, Check, Clock, Keyboard, Loader2, Send, ShieldCheck, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/app/page-header";
import { useSaveAnswer, useSubmitAttempt, useFlagCheat, useTest } from "@/hooks/use-tests";
import type { AttemptDetail, AttemptQuestion, TestSection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AudioPlayer, AudioscriptDetails, extractAudio } from "./audio-player";
import { QuestionNav } from "./question-nav";
import { WritingImageOcr } from "@/components/mock/writing-image-ocr";

const SECTION_ORDER: TestSection[] = ["listening", "reading", "writing", "speaking"];

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  const v = t(key as never) as unknown;
  if (typeof v !== "string" || v === key || v.endsWith(`.${key}`)) return fallback;
  return v;
}

export function TestRunnerEnhanced({ attempt }: { attempt: AttemptDetail }) {
  return <TestRunner attempt={attempt} />;
}

// Main export (also used as TestRunner)
export function TestRunner({ attempt }: { attempt: AttemptDetail }) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const testQ = useTest(attempt.testId);
  const save = useSaveAnswer(attempt.id);
  const submit = useSubmitAttempt(attempt.id);
  const flagCheat = useFlagCheat(attempt.id);

  const [answers, setAnswers] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(attempt.questions.map((q) => [q.questionId, q.answer ?? ""])),
  );
  const [cheatSeen, setCheatSeen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<TestSection>(() => {
    const first = SECTION_ORDER.find((s) => attempt.questions.some((q) => q.section === s));
    return (first ?? attempt.questions[0]?.section ?? "reading") as TestSection;
  });
  const [activeQid, setActiveQid] = React.useState<string | null>(attempt.questions[0]?.questionId ?? null);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);

  const questionRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  // Anti-cheat
  React.useEffect(() => {
    function onHidden() {
      if (document.hidden) {
        setCheatSeen(true);
        flagCheat.mutate("tab_switch");
      }
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [flagCheat]);

  // Timer
  const duration = testQ.data?.durationMinutes ?? null;
  const deadline = React.useMemo(
    () => (duration ? new Date(attempt.startedAt).getTime() + duration * 60_000 : null),
    [duration, attempt.startedAt],
  );
  const [remaining, setRemaining] = React.useState<number | null>(null);
  const submitRef = React.useRef(false);

  React.useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const doSubmit = React.useCallback(() => {
    if (submitRef.current) return;
    submitRef.current = true;
    submit.mutate(undefined, {
      onSuccess: () => toast.success(tFallback(t, "submitted", "Test submitted")),
      onError: () => {
        submitRef.current = false;
        toast.error(tc("unknownError"));
      },
    });
  }, [submit, t, tc]);

  React.useEffect(() => {
    if (remaining === 0 && deadline) doSubmit();
  }, [remaining, deadline, doSubmit]);

  function setAnswer(q: AttemptQuestion, value: string) {
    setAnswers((prev) => ({ ...prev, [q.questionId]: value }));
  }
  function persist(q: AttemptQuestion, value: string) {
    save.mutate(
      { questionId: q.questionId, answer: value },
      {
        onSuccess: () => setLastSavedAt(Date.now()),
        onError: () => toast.error(tc("saveFailed")),
      },
    );
  }

  const answeredCount = React.useMemo(
    () => attempt.questions.filter((q) => (answers[q.questionId] ?? "").trim()).length,
    [attempt.questions, answers],
  );
  const total = attempt.questions.length;
  const progress = total ? Math.round((answeredCount / total) * 100) : 0;

  const presentSections = React.useMemo(
    () => SECTION_ORDER.filter((s) => attempt.questions.some((q) => q.section === s)),
    [attempt.questions],
  );

  const activeQuestions = React.useMemo(
    () => attempt.questions.filter((q) => q.section === activeSection).sort((a, b) => a.order - b.order),
    [attempt.questions, activeSection],
  );

  // If activeSection became empty after filter (should not), fallback.
  // Render-phase adjustment (not an effect) so no cascading render.
  if (activeQuestions.length === 0 && presentSections.length > 0 && activeSection !== presentSections[0]) {
    setActiveSection(presentSections[0]);
  }

  function scrollTo(qid: string) {
    setActiveQid(qid);
    const el = questionRefs.current.get(qid);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // keyboard focus to input inside
    setTimeout(() => {
      const input = el?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea, [role='radio']");
      // don't steal focus aggressively
    }, 300);
  }

  const saveState: "idle" | "saving" | "saved" = save.isPending ? "saving" : lastSavedAt ? "saved" : "idle";

  const title = testQ.data?.title ?? tFallback(t, "title", "Test");

  return (
    <div className="mx-auto max-w-4xl pb-28">
      {/* Top sticky header */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:mx-0 sm:rounded-b-[12px] sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold tracking-tight text-fg sm:text-lg">{title}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <ShieldCheck className="size-3.5" />
                {answeredCount}/{total} {tFallback(t, "answered", "answered")} · {progress}%
              </span>
              {saveState === "saving" && (
                <span className="inline-flex items-center gap-1 text-fg-muted">
                  <Loader2 className="size-3 animate-spin" />
                  {tc("saving")}
                </span>
              )}
              {saveState === "saved" && !save.isPending && (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="size-3.5" />
                  {tc("saved")}
                </span>
              )}
              <span className="hidden items-center gap-1 sm:inline-flex">
                <Keyboard className="size-3.5" />
                {tFallback(t, "keyboardHint", "Tab to move · Click numbers to jump")}
              </span>
            </div>
            {/* progress bar thin */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {remaining !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums",
                  remaining < 60 ? "bg-danger-bg text-danger" : remaining < 300 ? "bg-warning-bg text-warning" : "bg-bg-subtle text-fg",
                )}
                aria-label={tFallback(t, "timeLeft", "Time left")}
                title={tFallback(t, "timeLeft", "Time left")}
              >
                <Clock className="size-4" />
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
              </span>
            )}
            <Button size="sm" loading={submit.isPending} onClick={() => setConfirmOpen(true)} className="hidden sm:inline-flex">
              <Send />
              {tFallback(t, "submit", "Submit")}
            </Button>
          </div>
        </div>

        {cheatSeen && (
          <div
            className="mt-3 flex items-center gap-2 rounded-[8px] border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning"
            role="alert"
          >
            <AlertTriangle className="size-4 shrink-0" />
            {tFallback(t, "tabSwitchWarning", "Note: switching windows during the test is logged.")}
          </div>
        )}
      </div>

      {/* Section tabs */}
      {presentSections.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Sections">
          {presentSections.map((sec) => {
            const count = attempt.questions.filter((q) => q.section === sec).length;
            const answeredInSec = attempt.questions.filter((q) => q.section === sec && (answers[q.questionId] ?? "").trim()).length;
            const isActive = sec === activeSection;
            return (
              <button
                key={sec}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveSection(sec)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20",
                  isActive
                    ? "bg-brand text-white shadow-sm"
                    : "border border-border bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                {tFallback(t, `sections.${sec}`, sec)}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    isActive ? "bg-white/20 text-white" : answeredInSec === count ? "bg-success-bg text-success" : "bg-bg-subtle text-fg-subtle",
                  )}
                >
                  {answeredInSec}/{count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Listening helpers */}
      {activeSection === "listening" && (
        <div className="mb-4 space-y-3">
          <AudioPlayer />
          <AudioscriptDetails />
          <div className="rounded-[10px] border border-dashed border-border bg-surface px-4 py-3 text-sm leading-relaxed text-fg-muted">
            <p className="font-medium text-fg">{tFallback(t, "instructions", "Instructions")}</p>
            <p className="mt-1">
              {tFallback(
                t,
                "listeningInstructions",
                "You will hear a recording. Complete the form below. Write ONE WORD for each answer.",
              )}
            </p>
            <p className="mt-1 text-xs text-brand">✎ {tFallback(t, "oneWordHint", "Write ONE WORD ONLY")}</p>
          </div>
        </div>
      )}

      {activeSection === "reading" && activeQuestions.some((q) => q.prompt.length > 300) && (
        <div className="mb-3 rounded-[8px] bg-info-bg px-3 py-2 text-xs text-info">
          {tFallback(t, "readingTip", "Tip: Read the passage carefully before answering. You can jump between questions using the numbers below.")}
        </div>
      )}

      {/* Questions */}
      <div className="space-y-4">
        {activeQuestions.map((q) => {
          const isActiveQ = activeQid === q.questionId;
          const answered = !!(answers[q.questionId] ?? "").trim();
          const { cleanPrompt, audioUrl, hasAudio } = extractAudio(q.prompt);
          const displayPrompt = cleanPrompt;
          const needsOneWord = q.type === "short_answer";

          return (
            <Card
              key={q.questionId}
              ref={(el) => {
                if (el) questionRefs.current.set(q.questionId, el);
                else questionRefs.current.delete(q.questionId);
              }}
              onClick={() => setActiveQid(q.questionId)}
              className={cn(
                "group p-4 transition-all sm:p-5",
                isActiveQ ? "border-brand/40 ring-1 ring-brand/10" : "hover:border-border-strong",
                answered ? "bg-surface" : "bg-surface",
              )}
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full text-xs font-bold tabular-nums transition-colors",
                    isActiveQ ? "bg-brand text-white" : answered ? "bg-success-bg text-success" : "bg-brand-subtle text-brand-subtle-fg",
                  )}
                  aria-hidden
                >
                  {answered && !isActiveQ ? <Check className="size-4" /> : q.order}
                </span>
                <Badge variant="neutral" className="capitalize">
                  {tFallback(t, `sections.${q.section}`, q.section)}
                </Badge>
                <Badge variant="neutral" className="text-[11px]">
                  {tFallback(t, `types.${q.type}`, q.type.replace("_", " "))}
                </Badge>
                <span className="ml-auto text-xs text-fg-subtle tabular-nums">
                  {q.maxScore} {tFallback(t, "score", "points")}
                </span>
              </div>

              {/* Per-question audio if prompt had [audio] */}
              {hasAudio && (
                <div className="mb-3">
                  <AudioPlayer src={audioUrl} title={`${tFallback(t, "question", "Question")} ${q.order}`} />
                </div>
              )}

              {/* Prompt */}
              <div className="mb-3">
                {needsOneWord && displayPrompt.includes("___") ? (
                  <InlinePromptWithInput
                    prompt={displayPrompt}
                    value={answers[q.questionId] ?? ""}
                    onChange={(v) => setAnswer(q, v)}
                    onBlur={(v) => persist(q, v)}
                    placeholder={tFallback(t, "yourAnswer", "Your answer")}
                    oneWordHint={tFallback(t, "oneWordHint", "Write ONE WORD ONLY")}
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{displayPrompt}</p>
                )}
                {needsOneWord && !displayPrompt.includes("___") && (
                  <p className="mt-1 text-xs font-medium tracking-wide text-brand">✎ {tFallback(t, "oneWordHint", "Write ONE WORD ONLY")}</p>
                )}
              </div>

              {/* Inputs */}
              {q.type === "multiple_choice" && Array.isArray(q.options) ? (
                <div className="space-y-2" role="radiogroup" aria-label={`Question ${q.order}`}>
                  {q.options.map((opt, i) => {
                    const selected = answers[q.questionId] === opt;
                    return (
                      <label
                        key={i}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-brand/20",
                          selected ? "border-brand bg-brand-subtle/40 text-fg ring-1 ring-brand/10" : "border-border bg-surface hover:bg-surface-hover",
                        )}
                      >
                        <input
                          type="radio"
                          name={q.questionId}
                          checked={selected}
                          onChange={() => {
                            setAnswer(q, opt);
                            persist(q, opt);
                            setActiveQid(q.questionId);
                          }}
                          className="size-4 accent-brand"
                          aria-checked={selected}
                        />
                        <span className="flex-1">{opt}</span>
                        {selected && <Check className="size-4 text-brand" />}
                      </label>
                    );
                  })}
                </div>
              ) : q.type === "short_answer" ? (
                // if we already rendered inline, don't duplicate; but if prompt has ___, we already have input inline. Still need fallback input? We handled via InlinePrompt. So only render if no inline.
                displayPrompt.includes("___") ? null : (
                  <div className="space-y-1.5">
                    <Input
                      value={answers[q.questionId] ?? ""}
                      onChange={(e) => setAnswer(q, e.target.value)}
                      onBlur={(e) => persist(q, e.target.value)}
                      placeholder={tFallback(t, "yourAnswer", "Answer")}
                      aria-label={`${tFallback(t, "question", "Question")} ${q.order}`}
                      className={cn(needsOneWord && (answers[q.questionId] ?? "").trim().split(/\s+/).filter(Boolean).length > 1 && "border-warning ring-warning/20")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {needsOneWord && (answers[q.questionId] ?? "").trim().split(/\s+/).filter(Boolean).length > 1 && (
                      <p className="text-xs text-warning">{tFallback(t, "oneWordError", "Please write one word only.")}</p>
                    )}
                  </div>
                )
              ) : (
                <div className="space-y-2.5">
                  {(q.type === "essay" || q.section === "writing") && (
                    <WritingImageOcr
                      attemptId={attempt.id}
                      questionId={q.questionId}
                      currentText={answers[q.questionId] ?? ""}
                      onExtractedText={(ocrText, mode) => {
                        const prev = answers[q.questionId] ?? "";
                        const nextText =
                          mode === "append" && prev.trim()
                            ? `${prev.trim()}\n\n${ocrText}`
                            : ocrText;
                        setAnswer(q, nextText);
                        persist(q, nextText);
                      }}
                    />
                  )}
                  <Textarea
                    value={answers[q.questionId] ?? ""}
                    onChange={(e) => setAnswer(q, e.target.value)}
                    onBlur={(e) => persist(q, e.target.value)}
                    placeholder={tFallback(t, "yourAnswer", "Your answer")}
                    className="min-h-32 resize-y"
                    aria-label={`${tFallback(t, "question", "Question")} ${q.order}`}
                  />
                  <div className="flex justify-between text-xs text-fg-subtle">
                    <span>
                      {q.type === "essay" || q.type === "speaking_prompt" ? tFallback(t, "essayHint", "Write as clearly as you can. Your answer is saved automatically.") : null}
                    </span>
                    <span className="tabular-nums">{(answers[q.questionId] ?? "").trim().split(/\s+/).filter(Boolean).length} words</span>
                  </div>
                </div>
              )}

              {/* Word count for essay inline? already */}
            </Card>
          );
        })}

        {activeQuestions.length === 0 && (
          <Card className="p-8 text-center text-sm text-fg-muted">
            {tFallback(t, "noQuestionsInSection", "No questions in this section.")}
          </Card>
        )}
      </div>

      {/* Bottom nav + actions */}
      <QuestionNav
        questions={attempt.questions}
        answers={answers}
        activeId={activeQid}
        activeSection={activeSection}
        onJump={scrollTo}
        onSectionChange={setActiveSection}
      />

      <div className="mt-4 flex justify-end gap-2 sm:hidden">
        <Button size="lg" className="w-full" loading={submit.isPending} onClick={() => setConfirmOpen(true)}>
          <Send />
          {tFallback(t, "submit", "Submit test")}
        </Button>
      </div>
      <div className="mt-6 hidden justify-end sm:flex">
        <Button size="lg" loading={submit.isPending} onClick={() => setConfirmOpen(true)}>
          <Send />
          {tFallback(t, "submit", "Submit test")}
        </Button>
      </div>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tFallback(t, "submitConfirmTitle", "Submit the test?")}</DialogTitle>
            <DialogDescription>
              {tFallback(
                t,
                "submitConfirm",
                "Submit the test? You can't change it afterwards.",
              )}{" "}
              <span className="mt-2 block text-xs">
                {answeredCount}/{total} answered. {total - answeredCount > 0 ? tFallback(t, "unansweredWarning", "Unanswered questions will be counted as 0.") : tFallback(t, "allAnswered", "All questions answered — great job!")}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              loading={submit.isPending}
              onClick={() => {
                setConfirmOpen(false);
                doSubmit();
              }}
            >
              <Send />
              {tFallback(t, "submit", "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accessibility: live region for timer warning */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {remaining !== null && remaining < 60 ? tFallback(t, "oneMinuteLeft", "One minute remaining") : null}
      </div>
    </div>
  );
}

function InlinePromptWithInput({
  prompt,
  value,
  onChange,
  onBlur,
  placeholder,
  oneWordHint,
}: {
  prompt: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
  placeholder: string;
  oneWordHint: string;
}) {
  const parts = prompt.split(/_{3,}/);
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  const hasError = words > 1;

  // If more than one blank, we render first input inline and hint that all blanks share same answer? Actually each blank would need own answer, but our model is one answer per question.
  // So we render prompt interleaved with the SAME input for each blank (mirrored) — or simply replace first blank with input and keep others as underscores.
  // Better: render first blank as input, others as static underscores to avoid confusion.
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-1 text-sm leading-relaxed text-fg">
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            <span className="whitespace-pre-wrap">{part}</span>
            {i < parts.length - 1 &&
              (i === 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={(e) => onBlur(e.target.value)}
                    placeholder={placeholder}
                    className={cn("h-8 w-36 sm:w-44", hasError && "border-warning ring-warning/20")}
                    aria-label={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </span>
              ) : (
                <span className="mx-1 inline-block h-4 w-16 border-b border-dashed border-border align-baseline" aria-hidden />
              ))}
          </React.Fragment>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium tracking-wide text-brand">✎ {oneWordHint}</p>
        {hasError && <p className="text-xs text-warning">One word only — please correct.</p>}
      </div>
    </div>
  );
}
