"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  EyeOff,
  FileText,
  Flag,
  Highlighter,
  Info,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button-variants";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/common/error-boundary";
import type {
  MockExamDetail,
  MockGroup,
  MockQuestion,
} from "@/lib/types";

type FontSize = "s" | "m" | "l";
const FONT_CLASS: Record<FontSize, string> = {
  s: "text-sm",
  m: "text-[15px]",
  l: "text-lg",
};

interface FlatGroup {
  sectionId: string;
  skill: string;
  group: MockGroup;
  startIndex: number;
  endIndex: number;
}

function flattenGroups(exam: MockExamDetail): FlatGroup[] {
  const out: FlatGroup[] = [];
  let n = 0;
  for (const s of (exam?.sections || [])) {
    const groups = s?.groups || (s as any)?.parts || [];
    for (const g of groups) {
      const questions = g?.questions || [];
      const count = questions.length;
      out.push({
        sectionId: s.id,
        skill: s.skill,
        group: g,
        startIndex: n,
        endIndex: n + Math.max(0, count - 1),
      });
      n += count;
    }
  }
  return out;
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function formatLeft(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Split "Write ___ here" into text / blank segments for inline inputs. */
function splitBlank(prompt?: string | null): (string | null)[] {
  if (!prompt || typeof prompt !== "string") return [""];
  if (!prompt.includes("___")) return [prompt];
  return prompt.split("___") as (string | null)[];
}

/**
 * Full-screen split exam view (reference: IELTS on-computer layout),
 * restyled in BestWay brand. Left pane = context (audio + script/passage
 * with highlighter), right pane = current part's questions with numbered
 * badges and inline blanks. Answers are local-only demo state.
 */
export function CdExamView({ exam }: { exam: MockExamDetail }) {
  const t = useTranslations("marketing");
  const tc = useTranslations("common");

  const parts = React.useMemo(() => flattenGroups(exam), [exam]);
  const totalMinutes = React.useMemo(
    () => (exam?.sections || []).reduce((sum, s) => sum + (s.durationMinutes ?? (s as any).timeLimit ?? 0), 0),
    [exam],
  );
  const totalQuestions = parts.length > 0 ? parts[parts.length - 1].endIndex + 1 : 0;

  const [partIdx, setPartIdx] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [flagged, setFlagged] = React.useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = React.useState<FontSize>("m");
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(totalMinutes * 60);
  const [savedHtml, setSavedHtml] = React.useState<Record<string, string>>({});
  const leftRef = React.useRef<HTMLDivElement | null>(null);
  const rightRef = React.useRef<HTMLDivElement | null>(null);

  // Live countdown — display only (demo never auto-submits).
  React.useEffect(() => {
    if (totalMinutes <= 0) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [totalMinutes]);

  const part = parts[partIdx];

  function goPart(i: number) {
    const clamped = Math.max(0, Math.min(i, parts.length - 1));
    // Persist passage highlights of the outgoing part.
    if (leftRef.current && part) {
      const root = leftRef.current.querySelector("[data-passage]");
      if (root) setSavedHtml((h) => ({ ...h, [part.group.id]: root.innerHTML }));
    }
    setPartIdx(clamped);
    rightRef.current?.scrollTo({ top: 0 });
    leftRef.current?.scrollTo({ top: 0 });
  }

  // Restore saved highlights when the part mounts.
  React.useEffect(() => {
    if (!part) return;
    const root = leftRef.current?.querySelector("[data-passage]");
    const html = savedHtml[part.group.id];
    if (root && html) root.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partIdx]);

  function highlightSelection() {
    const root = leftRef.current?.querySelector("[data-passage]");
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || !root.contains(sel.anchorNode)) return;
    try {
      const range = sel.getRangeAt(0);
      const mark = document.createElement("mark");
      mark.className = "cd-mark";
      range.surroundContents(mark);
      sel.removeAllRanges();
    } catch {
      sel.removeAllRanges();
    }
  }

  function clearHighlights() {
    const root = leftRef.current?.querySelector("[data-passage]");
    if (!root) return;
    root.querySelectorAll("mark.cd-mark").forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  function toggleFlag(id: string) {
    setFlagged((f) => ({ ...f, [id]: !f[id] }));
  }

  if (!part) {
    return (
      <div className="flex min-h-[500px] w-full items-center justify-center bg-bg p-8 text-center">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <h2 className="text-lg font-bold text-fg">Imtihon topshiriqlari tayyorlanmoqda...</h2>
          <p className="mt-2 text-xs text-fg-muted">Agar bir necha soniyada ochilmasa, iltimos sahifani yangilang.</p>
        </div>
      </div>
    );
  }

  const urgent = totalMinutes > 0 && secondsLeft <= 5 * 60 && secondsLeft > 0;
  const warn = totalMinutes > 0 && secondsLeft <= 10 * 60 && secondsLeft > 5 * 60;
  const expired = totalMinutes > 0 && secondsLeft === 0;

  return (
    <div className={cn(FONT_CLASS[fontSize])}>
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-30 border-y border-border bg-bg/95 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-2 px-3 py-2 sm:px-5">
          <Link
            href="/demo"
            aria-label="Back to demo tests"
            title="Back to demo tests"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{exam.title}</p>
          {totalMinutes > 0 && (
            <p
              role="timer"
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm font-bold tabular-nums",
                expired
                  ? "border-danger bg-danger-bg text-danger"
                  : urgent
                    ? "anim-glow border-danger/60 bg-danger-bg text-danger"
                    : warn
                      ? "anim-glow border-warning/60 bg-warning-bg text-warning"
                      : "border-border bg-surface text-fg",
              )}
            >
              <Clock className="size-4" aria-hidden />
              {formatLeft(secondsLeft)}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-1">
            <div className="hidden items-center rounded-full border border-border p-0.5 sm:flex" role="group" aria-label="Text size">
              {(["s", "m", "l"] as FontSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFontSize(s)}
                  aria-pressed={fontSize === s}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-bold uppercase transition-colors",
                    fontSize === s ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg",
                  )}
                >
                  A{s}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)} aria-label="Help">
              <Info className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHidden(true)} aria-label="Hide screen">
              <EyeOff className="size-4" />
            </Button>
          </div>
        </div>
        {expired && (
          <p className="px-3 pb-1 text-center text-xs font-medium text-danger">
            Time is up — this is a demo preview, your selections are kept on screen.
          </p>
        )}
      </div>

      {/* ── Split panes ── */}
      <ErrorBoundary fallbackTitle={`Part ${partIdx + 1} ni yuklashda xatolik yuz berdi`}>
        <div className="grid w-full gap-0 px-3 sm:px-5 lg:grid-cols-2 lg:gap-5">
        {/* Left: context */}
        <div ref={leftRef} className="min-w-0 py-4 lg:h-[calc(100dvh-150px)] lg:overflow-y-auto lg:py-5 lg:pr-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold tracking-wide text-fg uppercase">
              Part {partIdx + 1}
              <span className="ml-2 rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-subtle-fg normal-case">
                {tc(`sections.${part.skill}`)}
              </span>
            </h2>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={highlightSelection}
                title="Highlight selected text"
                aria-label="Highlight selected text"
                className="grid size-7 place-items-center rounded-md border border-border text-fg-muted transition-colors hover:border-accent/60 hover:text-accent"
              >
                <Highlighter className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={clearHighlights}
                title="Clear highlights"
                aria-label="Clear highlights"
                className="grid size-7 place-items-center rounded-md border border-border text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </button>
            </span>
          </div>

          {part.group.audioUrl && (
            <audio controls preload="none" src={part.group.audioUrl} className="mb-3 w-full" />
          )}

          <div className="rounded-[12px] border border-border bg-surface p-4">
            <div data-passage>
              {part.group.title && <p className="text-center text-base font-bold text-fg">{part.group.title}</p>}
              {part.group.instructions && (
                <p className="mt-1 text-xs text-fg-muted">{part.group.instructions}</p>
              )}
              {part.group.passageText ? (
                <div className="mt-3 space-y-2.5 text-sm leading-relaxed whitespace-pre-wrap text-fg">
                  {part.group.passageText}
                </div>
              ) : (
                !part.group.audioUrl && (
                  <p className="mt-3 flex items-center gap-2 text-sm text-fg-subtle">
                    <FileText className="size-4" aria-hidden />
                    Answer the questions on the right.
                  </p>
                )
              )}
            </div>
          </div>
        </div>

        {/* Right: questions */}
        <div ref={rightRef} className="min-w-0 border-t border-border py-4 lg:h-[calc(100dvh-150px)] lg:overflow-y-auto lg:border-t-0 lg:border-l lg:py-5 lg:pl-5">
          <p className="text-base font-bold text-fg">
            Questions {part.startIndex + 1}–{part.endIndex + 1}
          </p>
          {part.group.instructions && (
            <p className="mt-1 text-sm text-fg-muted">{part.group.instructions}</p>
          )}
          <div className="mt-4 rounded-[12px] border border-border-strong/60 bg-surface p-4">
            <div className="space-y-5">
              {(part.group.questions || []).map((q, qi) => {
                const promptText = q.prompt || (q as any).text || "";
                return (
                  <div key={q.id} id={`cd-q-${q.id}`} className="scroll-mt-32">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
                        <span className="mr-1.5 inline-grid size-5 place-items-center rounded-full border border-fg-subtle align-middle text-[11px] text-fg-muted tabular-nums">
                          {part.startIndex + qi + 1}
                        </span>
                        {q.type !== "multiple_choice" && promptText.includes("___") ? null : promptText}
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleFlag(q.id)}
                        aria-pressed={!!flagged[q.id]}
                        aria-label={flagged[q.id] ? "Unflag question" : "Flag for review"}
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-full border transition-colors",
                          flagged[q.id]
                            ? "border-warning bg-warning/15 text-warning"
                            : "border-border text-fg-subtle hover:border-warning/60 hover:text-warning",
                        )}
                      >
                        <Flag className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    <CdAnswerInput
                      q={q}
                      value={answers[q.id] ?? ""}
                      onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Register CTA */}
          <Card className="mt-5 p-5 text-center">
            <p className="font-semibold text-fg">{t("demoLoginCta")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">{t("demoLoginCtaHint")}</p>
            <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
              <Link href="/register" className={cn(buttonVariants({ size: "lg" }))}>
                {t("heroCta")}
              </Link>
              <Link href="/login" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
                {t("login")}
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Bottom part navigator ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur">
        <div className="flex w-full items-center gap-2 px-3 py-2 sm:px-5">
          <Button
            size="sm"
            variant="outline"
            disabled={partIdx <= 0}
            onClick={() => goPart(partIdx - 1)}
            aria-label="Previous part"
            className="shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5" role="navigation" aria-label="Parts">
            {parts.map((p, i) => {
              const qs = p?.group?.questions || [];
              const answered = qs.filter((q) => (answers[q.id] ?? "").trim() !== "").length;
              const total = qs.length;
              return (
                <button
                  key={p.group.id}
                  type="button"
                  onClick={() => goPart(i)}
                  aria-current={i === partIdx ? "true" : undefined}
                  aria-label={`Part ${i + 1}, ${p.skill}, ${answered} of ${total} answered`}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    i === partIdx
                      ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                      : answered === total && total > 0
                        ? "border-border bg-surface text-brand-subtle-fg"
                        : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                  )}
                >
                  <span className="tabular-nums">{i + 1}</span>
                  <span className="hidden capitalize min-[420px]:inline">{p.skill}</span>
                  <span className="text-[10px] opacity-70 tabular-nums">{answered}/{total}</span>
                </button>
              );
            })}
          </div>
          <span className="hidden shrink-0 text-xs text-fg-muted tabular-nums sm:block">
            {Object.values(answers).filter((v) => v.trim() !== "").length}/{totalQuestions}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={partIdx >= parts.length - 1}
            onClick={() => goPart(partIdx + 1)}
            aria-label="Next part"
            className="shrink-0"
          >
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
      </ErrorBoundary>

      {/* ── Help dialog ── */}
      <Dialog open={helpOpen} onOpenChange={(o) => !o && setHelpOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How this demo works</DialogTitle>
            <DialogDescription>
              Read or listen on the left, answer on the right. Switch parts below — your
              answers and highlights per part are kept while you browse.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
              <li>Parts show x/y answered; flagged questions get a yellow marker.</li>
              <li>Select passage text, then press the highlighter to mark it.</li>
              <li>Writing tasks count words live as you type.</li>
              <li>Nothing is scored here — register for real scoring and history.</li>
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* ── Hide-screen overlay ── */}
      {hidden && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg" role="alertdialog" aria-label="Screen hidden">
          <Pause className="size-10 text-fg-subtle" aria-hidden />
          <p className="text-lg font-semibold text-fg">Screen hidden — take your break</p>
          <Button onClick={() => setHidden(false)}>
            <Play className="size-4" />
            Resume test
          </Button>
        </div>
      )}
    </div>
  );
}

function CdAnswerInput({
  q,
  value,
  onChange,
}: {
  q: MockQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  if ((q.type as string) === "essay" || q.type === "essay_task1" || q.type === "essay_task2" || (q as any).questionType === "essay") {
    const n = wordCount(value);
    const min = q.type === "essay_task1" ? 150 : 250;
    return (
      <div className="mt-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder="Write your answer here…"
          className="w-full min-w-0 rounded-[8px] border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
        />
        <p className={cn("mt-1 text-xs tabular-nums", n >= min ? "text-brand" : "text-fg-subtle")}>
          {n} words{min ? ` (minimum ${min})` : ""}
        </p>
      </div>
    );
  }
  if ((q.type as string) === "speaking" || q.type === "speaking_task" || (q as any).questionType === "speaking_prompt") {
    return (
      <div className="mt-3 rounded-xl border border-border bg-surface p-4 text-center">
        <p className="text-xs font-semibold text-fg-muted mb-1">🎤 Speaking Topshirig'i</p>
        <p className="text-xs text-fg-muted">Haqiqiy imtihon rejimida mikrofon orqali audio yozib olinadi.</p>
      </div>
    );
  }
  const promptText = q.prompt || (q as any).text || "";

  if (q.options && q.options.length > 0) {
    return (
      <div className="mt-2 space-y-1.5" role="radiogroup" aria-label={promptText}>
        {q.options.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected ? "" : opt)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[10px] border px-3 py-2 text-left text-sm transition-colors",
                selected
                  ? "border-brand bg-brand-subtle/50 text-fg"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  selected ? "border-brand" : "border-fg-subtle",
                )}
              >
                {selected && <span className="size-2 rounded-full bg-brand" />}
              </span>
              {opt}
            </button>
          );
        })}
      </div>
    );
  }
  // Gap-fill style: prompt with ___ renders an inline blank (IELTS CD style).
  const parts = splitBlank(promptText);
  if (parts.length > 1) {
    return (
      <p className="mt-2 text-sm leading-loose text-fg">
        {parts.map((seg, i) =>
          i === parts.length - 1 ? (
            <span key={i}>{seg}</span>
          ) : (
            <span key={i}>
              {seg}
              <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-label={promptText.replaceAll("___", "___answer___")}
                className="mx-1 inline-block w-36 rounded-[6px] border border-border-strong bg-bg px-2 py-1 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
              />
            </span>
          ),
        )}
      </p>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Type your answer…"
      aria-label={promptText}
      className="mt-2 w-full min-w-0 rounded-[8px] border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
    />
  );
}
