"use client";

import * as React from "react";
import { LoadErrorPanel } from "@/components/common/load-error-panel";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  EyeOff,
  FileText,
  Flag,
  Highlighter,
  Info,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
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
import { StrictErrorBoundary } from "@/components/common/StrictErrorBoundary";
import { normalizeExamPayload } from "@/lib/normalize-exam";
import { AlertTriangle, RefreshCw } from "lucide-react";
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

export interface FlatGroup {
  sectionId: string;
  skill: string;
  group: MockGroup;
  startIndex: number;
  endIndex: number;
}

export function flattenGroups(exam?: MockExamDetail | null): FlatGroup[] {
  if (!exam) return [];
  const out: FlatGroup[] = [];
  let n = 0;
  const sections = exam.sections || [];
  for (const s of sections) {
    const groups = s?.groups || (s as any)?.parts || [];
    for (const g of groups) {
      const questions = g?.questions || (g as any)?.items || [];
      const count = questions.length;
      out.push({
        sectionId: s?.id || "",
        skill: s?.skill || "listening",
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
  const t = (text || "").trim();
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

export function splitBlank(prompt?: string | null): (string | null)[] {
  if (!prompt || typeof prompt !== "string") return [""];
  if (!prompt.includes("___")) return [prompt];
  return prompt.split("___") as (string | null)[];
}

/**
 * Listening Part 1 Radio:
 * Clean, distraction-free option buttons without repeating the prompt text.
 */
export function ListeningPart1Radio({
  q,
  value,
  onChange,
}: {
  q: MockQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = q?.options || [];
  return (
    <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label={`Question ${q?.number || ""}`}>
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(selected ? "" : opt)}
            className={cn(
              "flex min-h-[44px] items-center gap-2 rounded-[12px] border px-4 py-2 text-sm font-semibold transition-all touch-manipulation",
              selected
                ? "border-brand bg-brand text-brand-fg shadow-md scale-[1.02]"
                : "border-border bg-surface text-fg hover:border-brand/60 hover:bg-surface-hover"
            )}
          >
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border",
                selected ? "border-white bg-white/20" : "border-fg-subtle"
              )}
            >
              {selected && <span className="size-2 rounded-full bg-white" />}
            </span>
            <span>{opt}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * SplitScreenMap:
 * Dual-pane or stacked layout specifically designed for Listening Part 4 map labeling.
 */
export function SplitScreenMap({
  imageUrl,
  title,
  children,
}: {
  imageUrl?: string | null;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6 items-start">
      {/* Map display pane */}
      <div className="rounded-[12px] border border-border bg-surface p-3 sm:p-4 shadow-sm lg:sticky lg:top-20">
        <div className="mb-2 flex items-center justify-between border-b border-border/60 pb-2">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg">
            <MapPin className="size-3.5 text-brand" />
            {title || "Community Centre Plan (Map)"}
          </span>
          <span className="text-[11px] text-fg-muted">Q19–Q23</span>
        </div>
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={title || "Map diagram"}
            loading="lazy"
            decoding="async"
            className="max-h-[60vh] w-full rounded-[12px] border border-border/80 object-contain  bg-bg-subtle/50"
          />
        ) : (
          <div className="flex h-48 w-full items-center justify-center rounded-[12px] border border-dashed border-border bg-bg-subtle/30 text-xs text-fg-muted">
            Xarita rasmi yuklanmoqda...
          </div>
        )}
      </div>

      {/* Map questions pane */}
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

/**
 * QuestionPalette:
 * Interactive question navigation matrix showing status of each question.
 */
export function QuestionPalette({
  questions,
  answers,
  flagged,
  onJump,
}: {
  questions: MockQuestion[];
  answers: Record<string, string>;
  flagged: Record<string, boolean>;
  onJump: (id: string) => void;
}) {
  const safeQuestions = questions || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span className="font-bold text-[11px] text-fg uppercase tracking-wider">
          Savollar Palitrasi ({safeQuestions.filter((q) => (answers?.[q.id] ?? "").trim() !== "").length}/{safeQuestions.length})
        </span>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500" /> Ishlangan
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-400" /> Belgilangan
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-border" /> Javobsiz
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
        {safeQuestions.map((q, idx) => {
          const isAns = (answers?.[q.id] ?? "").trim() !== "";
          const isFlag = !!flagged?.[q.id];
          return (
            <button
              key={q.id || idx}
              type="button"
              onClick={() => onJump(q.id)}
              className={cn(
                "size-8 rounded-lg text-xs font-bold transition-all touch-manipulation",
                isFlag
                  ? "bg-amber-400 text-slate-950 ring-2 ring-amber-400/50"
                  : isAns
                  ? "bg-emerald-600 text-white"
                  : "bg-surface border border-border text-fg-muted hover:border-brand hover:text-fg"
              )}
            >
              {q.number || idx + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Master Computer-Delivered Layout Wrapper (CDLayout)
 */
export function CDLayout({
  exam: initialExam,
  children,
}: {
  exam?: MockExamDetail | null;
  children?: React.ReactNode;
}) {
  const t = useTranslations("marketing");
  const tc = useTranslations("common");

  const [exam, setExam] = React.useState<MockExamDetail | null>(() =>
    initialExam ? normalizeExamPayload(initialExam) : null
  );
  const [isLoading, setIsLoading] = React.useState<boolean>(
    !initialExam || !initialExam.sections || initialExam.sections.length === 0
  );
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  // Client-side fallback fetcher if exam is not passed or empty
  React.useEffect(() => {
    if (exam && (exam.questionCount ?? 0) > 0 && exam.sections && exam.sections.length > 0) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setFetchError(null);

    async function loadActiveExam() {
      try {
        // One request through the authenticated proxy. No silent fallback to another
        // exam: the active exam is chosen by the server (ACTIVE_CD_EXAM_CODE).
        const res = await fetch("/api/backend/exams/active", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(
            res.status === 404 || res.status === 401 || res.status === 403
              ? "Aktiv imtihon topilmadi yoki unga kirish huquqingiz yo'q. Tizimga kiring yoki administratorga murojaat qiling."
              : `Server imtihonni qaytarmadi (HTTP ${res.status}). Birozdan so'ng qayta urining.`,
          );
          setIsLoading(false);
          return;
        }
        const rawData: unknown = await res.json();
        const parsed = normalizeExamPayload(rawData);
        if (!parsed || (parsed.questionCount ?? 0) === 0) {
          const err = "Failed to load questions from server (0 questions found in payload).";
          console.error("[CDLayout]", err, rawData);
          setFetchError(null); // LoadErrorPanel shows the translated default reason
          setIsLoading(false);
          return;
        }
        console.log("[CDLayout] Successfully loaded active exam:", parsed.title, "Questions:", parsed.questionCount);
        setExam(parsed);
        setIsLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[CDLayout] Failed to load questions from server:", err);
        setFetchError(null); // network/parse failure: translated default reason
        setIsLoading(false);
      }
    }

    loadActiveExam();
    return () => {
      cancelled = true;
    };
  }, []);

  const parts = React.useMemo(() => flattenGroups(exam), [exam]);
  const totalMinutes = React.useMemo(() => {
    if (!exam) return 150;
    if (exam.durationMinutes && exam.durationMinutes > 0) return exam.durationMinutes;
    const sum = (exam.sections || []).reduce(
      (acc, s) => acc + (s?.durationMinutes ?? (s as any)?.timeLimit ?? (s as any)?.time_limit ?? 0),
      0
    );
    return sum > 0 ? sum : 150;
  }, [exam]);

  const [partIdx, setPartIdx] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [flagged, setFlagged] = React.useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = React.useState<FontSize>("m");
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState<number>(() => totalMinutes * 60);

  // Sync timer once exam data resolves
  React.useEffect(() => {
    if (!isLoading && totalMinutes > 0) {
      setSecondsLeft((s) => (s <= 0 || s === 150 * 60 ? totalMinutes * 60 : s));
    }
  }, [isLoading, totalMinutes]);

  // Auto-enter fullscreen on first user interaction
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const enterFs = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener("click", enterFs, { once: true });
    window.addEventListener("keydown", enterFs, { once: true });
    return () => {
      window.removeEventListener("click", enterFs);
      window.removeEventListener("keydown", enterFs);
    };
  }, []);

  // Timer interval: only countdown when not loading
  React.useEffect(() => {
    if (isLoading) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const part = parts[partIdx] ?? parts[0];

  function toggleFlag(id: string) {
    setFlagged((f) => ({ ...f, [id]: !f[id] }));
  }

  function jumpToQuestion(qid: string) {
    const targetIdx = parts.findIndex((p) =>
      (p?.group?.questions || []).some((q) => q.id === qid)
    );
    if (targetIdx >= 0) {
      setPartIdx(targetIdx);
    }
    setTimeout(() => {
      const el = document.getElementById(`cd-q-${qid}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen w-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="flex size-14 items-center justify-center rounded-[12px] bg-emerald-500/10 text-emerald-400">
          <RefreshCw className="size-7 animate-spin" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-slate-100">Imtihon topshiriqlari yuklanmoqda...</h2>
        <p className="mt-1 text-xs text-slate-400">
          Serverdan rasmiy topshiriqlar va audio materiallar yuklanmoqda.
        </p>
      </div>
    );
  }

  // Defensive Fallback Error State: Never a black screen
  if (fetchError || !exam || parts.length === 0 || !part) {
    return <LoadErrorPanel fullScreen reason={fetchError} />;
  }

  const allQuestions = parts.flatMap((p) => p?.group?.questions || []);
  const isPart1Listening = part.skill === "listening" && (part.group?.partNumber === 1 || partIdx === 0);
  const isPart4Map = part.skill === "listening" && Boolean(part.group?.imageUrl || part.group?.partNumber === 4);

  return (
    <StrictErrorBoundary fallbackTitle="CD Layout Master Render Crash">
      <div className={cn("min-h-screen w-full bg-bg text-fg select-none", FONT_CLASS[fontSize])}>
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-md px-3 py-2.5 sm:px-6">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href="/demo"
                aria-label="Back"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-fg-muted hover:text-fg hover:border-border-strong transition-colors"
              >
                <ArrowLeft className="size-4" />
              </Link>
              <h1 className="truncate text-sm sm:text-base font-bold text-fg">
                {exam?.title || "Multi-Level (CEFR) Mock Test 1"}
              </h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div
                role="timer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs sm:text-sm font-bold tabular-nums text-fg"
              >
                <Clock className="size-3.5 text-brand" />
                {formatLeft(secondsLeft)}
              </div>

              {/* Text size selector */}
              <div className="hidden sm:flex items-center rounded-full border border-border p-0.5">
                {(["s", "m", "l"] as FontSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setFontSize(size)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-bold uppercase transition-colors",
                      fontSize === size ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
                    )}
                  >
                    A{size}
                  </button>
                ))}
              </div>

              <Button size="sm" variant="ghost" onClick={() => setHelpOpen(true)} aria-label="Help">
                <Info className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setHidden(true)} aria-label="Pause">
                <EyeOff className="size-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Demo notice: the simulator never persists answers */}
        <div role="note" className="border-b border-warning-border bg-warning-bg px-3 py-2 text-center text-xs font-medium text-fg sm:px-6">
          Demo rejim — bu yerdagi javoblar saqlanmaydi va baholanmaydi.{" "}
          {exam?.id ? (
            <Link href={`/mock/${encodeURIComponent(exam.id)}`} className="font-semibold text-brand underline underline-offset-2">
              Haqiqiy imtihonni boshlash
            </Link>
          ) : null}
        </div>

        {/* Main Body */}
        <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 pb-28">
          <ErrorBoundary fallbackTitle="Imtihon qismini yuklashda xatolik yuz berdi">
            {children ? (
              children
            ) : isPart4Map ? (
              <SplitScreenMap
                imageUrl={part.group?.imageUrl || "/media/exams/record_mock_1/map.png"}
                title={part.group?.title || "Community Centre Plan (Map)"}
              >
                <div className="space-y-4">
                  {(part.group?.questions || []).map((q, qi) => {
                    const promptText = q?.prompt || (q as any)?.text || "";
                    return (
                      <div key={q.id || qi} id={`cd-q-${q.id}`} className="rounded-[12px] border border-border bg-surface p-4 ">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-sm text-fg">
                            {part.startIndex + qi + 1}. {promptText}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleFlag(q.id)}
                            className={cn(
                              "grid size-7 place-items-center rounded-full border text-xs transition-colors",
                              flagged[q.id]
                                ? "border-amber-400 bg-amber-400/20 text-amber-500"
                                : "border-border text-fg-muted hover:border-amber-400 hover:text-amber-500"
                            )}
                          >
                            <Flag className="size-3.5" />
                          </button>
                        </div>
                        <ListeningPart1Radio
                          q={q}
                          value={answers[q.id] ?? ""}
                          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </SplitScreenMap>
            ) : (
              <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2 items-start">
                {/* Left Pane: Passage / Audio / Stimulus */}
                <div className="rounded-[12px] border border-border bg-surface p-4 sm:p-5  lg:sticky lg:top-20">
                  <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
                    <h2 className="text-sm font-extrabold tracking-wide uppercase text-fg">
                      Part {partIdx + 1}
                      <span className="ml-2 rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-subtle-fg normal-case">
                        {part.skill}
                      </span>
                    </h2>
                  </div>

                  {part.group?.audioUrl && (
                    <audio controls preload="none" src={part.group.audioUrl} className="mb-4 w-full" />
                  )}

                  {part.group?.title && (
                    <h3 className="text-base font-bold text-fg mb-1">{part.group.title}</h3>
                  )}
                  {part.group?.instructions && (
                    <p className="text-xs text-fg-muted mb-3">{part.group.instructions}</p>
                  )}

                  {part.group?.passageText ? (
                    <div className="whitespace-pre-line text-base sm:text-[17px] leading-relaxed text-fg max-w-[70ch] max-h-[60vh] overflow-y-auto pr-1">
                      {part.group.passageText}
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-fg-muted">
                      <FileText className="size-4 text-brand" />
                      O&apos;ng tomondagi topshiriqlarni bajaring.
                    </p>
                  )}
                </div>

                {/* Right Pane: Questions */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-fg">
                      Questions {part.startIndex + 1}–{part.endIndex + 1}
                    </h3>
                    <span className="text-xs text-fg-muted">
                      {(part.group?.questions || []).filter((q) => (answers[q.id] ?? "").trim() !== "").length}/{(part.group?.questions || []).length} ishlangan
                    </span>
                  </div>

                  <div className="space-y-4">
                    {(part.group?.questions || []).map((q, qi) => {
                      const promptText = q?.prompt || (q as any)?.text || "";
                      return (
                        <div key={q.id || qi} id={`cd-q-${q.id}`} className="rounded-[12px] border border-border bg-surface p-4 ">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-sm text-fg leading-snug">
                              {part.startIndex + qi + 1}. {promptText}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleFlag(q.id)}
                              className={cn(
                                "grid size-7 place-items-center rounded-full border text-xs transition-colors shrink-0",
                                flagged[q.id]
                                  ? "border-amber-400 bg-amber-400/20 text-amber-500"
                                  : "border-border text-fg-muted hover:border-amber-400 hover:text-amber-500"
                              )}
                            >
                              <Flag className="size-3.5" />
                            </button>
                          </div>

                          {isPart1Listening ? (
                            <ListeningPart1Radio
                              q={q}
                              value={answers[q.id] ?? ""}
                              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                            />
                          ) : q?.options && q.options.length > 0 ? (
                            <div className="mt-3 space-y-1.5" role="radiogroup" aria-label={promptText}>
                              {q.options.map((opt) => {
                                const selected = (answers[q.id] ?? "") === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: selected ? "" : opt }))}
                                    className={cn(
                                      "flex w-full items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-left text-sm transition-all touch-manipulation",
                                      selected
                                        ? "border-brand bg-brand-subtle/40 text-brand-subtle-fg font-medium "
                                        : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "grid size-4 shrink-0 place-items-center rounded-full border",
                                        selected ? "border-brand bg-brand" : "border-fg-subtle"
                                      )}
                                    >
                                      {selected && <span className="size-2 rounded-full bg-white" />}
                                    </span>
                                    <span>{opt}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <input
                              value={answers[q.id] ?? ""}
                              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                              placeholder="Javobingizni yozing..."
                              aria-label={promptText}
                              className="mt-3 w-full rounded-[12px] border border-border bg-bg px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </ErrorBoundary>
        </main>

        {/* Fixed Bottom Palette & Navigation */}
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur-md p-2.5 sm:px-6">
          <div className="mx-auto max-w-7xl flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={partIdx <= 0}
                onClick={() => setPartIdx((i) => Math.max(0, i - 1))}
                className="shrink-0"
              >
                <ArrowLeft className="size-4 mr-1" />
                <span className="hidden sm:inline">Oldingi qism</span>
              </Button>

              <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
                {parts.map((p, i) => {
                  const qs = p?.group?.questions || [];
                  const ansCount = qs.filter((q) => (answers[q.id] ?? "").trim() !== "").length;
                  return (
                    <button
                      key={p.group?.id || i}
                      type="button"
                      onClick={() => setPartIdx(i)}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-[12px] border px-3 py-1.5 text-xs font-semibold transition-all touch-manipulation",
                        i === partIdx
                          ? "border-brand bg-brand text-brand-fg  scale-105"
                          : "border-border bg-surface text-fg-muted hover:border-brand hover:text-fg"
                      )}
                    >
                      <span>Part {i + 1}</span>
                      <span className="text-[10px] opacity-80 tabular-nums">({ansCount}/{qs.length})</span>
                    </button>
                  );
                })}
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={partIdx >= parts.length - 1}
                onClick={() => setPartIdx((i) => Math.min(parts.length - 1, i + 1))}
                className="shrink-0"
              >
                <span className="hidden sm:inline">Keyingi qism</span>
                <ArrowRight className="size-4 ml-1" />
              </Button>
            </div>

            {/* Bottom Question Palette Row */}
            <QuestionPalette
              questions={allQuestions}
              answers={answers}
              flagged={flagged}
              onJump={jumpToQuestion}
            />
          </div>
        </footer>

        {/* Help Dialog */}
        <Dialog open={helpOpen} onOpenChange={(o) => !o && setHelpOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Imtihon Yo&apos;riqnomasi</DialogTitle>
              <DialogDescription>
                Chap tomonda audio, matn yoki xarita joylashgan. O&apos;ng tomonda savollarga javob bering.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
                <li>Pastki palitradan savol raqamini bosib to&apos;g&apos;ridan-to&apos;g&apos;ri o&apos;tishingiz mumkin.</li>
                <li>Keyinchalik qaytmoqchi bo&apos;lgan savollaringizni bayroqcha (Flag) bilan belgilab qo&apos;ying.</li>
                <li>Yashil rangli raqamlar javob berilgan savollarni bildiradi.</li>
              </ul>
            </DialogBody>
          </DialogContent>
        </Dialog>

        {/* Hide screen overlay */}
        {hidden && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg" role="alertdialog">
            <Pause className="size-10 text-fg-subtle" />
            <p className="text-lg font-semibold text-fg">Ekran yashirildi — tanaffus vaqti</p>
            <Button onClick={() => setHidden(false)}>
              <Play className="size-4 mr-1.5" />
              Davom ettirish
            </Button>
          </div>
        )}
      </div>
    </StrictErrorBoundary>
  );
}
