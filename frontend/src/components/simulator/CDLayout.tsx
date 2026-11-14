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
  GripVertical,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { GroupImage } from "@/components/mock/group-image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { StrictErrorBoundary } from "@/components/common/StrictErrorBoundary";
import { normalizeExamPayload } from "@/lib/normalize-exam";
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
                selected ? "border-border bg-surface-hover" : "border-fg-subtle"
              )}
            >
              {selected && <span className="size-2 rounded-full bg-surface" />}
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
  groupId,
  hasImage,
  title,
  children,
}: {
  /** Loaded through the authenticated /api/backend proxy; raw /media URLs 404 on the web origin. */
  groupId?: string | null;
  hasImage: boolean;
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
        {groupId && hasImage ? (
          <GroupImage groupId={groupId} alt={title || "Map diagram"} />
        ) : (
          <div role="status" className="flex h-48 w-full items-center justify-center rounded-[12px] border border-dashed border-border bg-bg-subtle/30 text-xs text-fg-muted">
            Bu qism uchun xarita rasmi yo&apos;q.
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
  const tu = useTranslations("uiText");
  const safeQuestions = questions || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span className="font-bold text-[11px] text-fg uppercase tracking-wider">
          {tu("cd.palette")} ({safeQuestions.filter((q) => (answers?.[q.id] ?? "").trim() !== "").length}/{safeQuestions.length})
        </span>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-brand" /> {tu("cd.answered")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-warning" /> {tu("cd.flagged")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-border" /> {tu("cd.unanswered")}
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
                  ? "bg-warning text-slate-950 ring-2 ring-warning/50"
                  : isAns
                  ? "bg-brand text-brand-fg"
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
 * Authentic Computer-Delivered Exam Skeleton Loader
 */
export function CDLayoutSkeleton() {
  return (
    <div className="flex min-h-screen w-screen flex-col bg-bg text-fg select-none">
      {/* Header Skeleton */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface/50 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-surface animate-pulse" />
          <div className="h-5 w-48 sm:w-64 rounded bg-surface animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-8 w-24 rounded-full bg-surface animate-pulse" />
          <div className="hidden sm:flex h-8 w-20 rounded-full bg-surface animate-pulse" />
          <div className="size-8 rounded bg-surface animate-pulse" />
        </div>
      </header>

      {/* Banner Skeleton */}
      <div className="h-8 w-full border-b border-border/40 bg-surface/30 animate-pulse" />

      {/* Main Split-Screen Skeleton */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 sm:p-6 lg:flex-row">
        {/* Left Pane: Passage Skeleton */}
        <div className="flex-1 rounded-[12px] border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div className="h-4 w-28 rounded bg-surface-hover animate-pulse" />
            <div className="h-4 w-16 rounded bg-surface-hover animate-pulse" />
          </div>
          <div className="h-10 w-full rounded bg-surface-hover animate-pulse" />
          <div className="space-y-2.5 pt-4">
            <div className="h-4 w-full rounded bg-surface-hover animate-pulse" />
            <div className="h-4 w-11/12 rounded bg-surface-hover animate-pulse" />
            <div className="h-4 w-4/5 rounded bg-surface-hover animate-pulse" />
            <div className="h-4 w-full rounded bg-surface-hover animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-surface-hover animate-pulse" />
            <div className="h-4 w-5/6 rounded bg-surface-hover animate-pulse" />
          </div>
        </div>

        {/* Right Pane: Question Cards Skeleton */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-4 w-36 rounded bg-surface animate-pulse" />
            <div className="h-4 w-20 rounded bg-surface animate-pulse" />
          </div>
          {[1, 2, 3].map((n) => (
            <div key={n} className="rounded-[12px] border border-border bg-surface p-4 space-y-3">
              <div className="h-4 w-3/4 rounded bg-surface-hover animate-pulse" />
              <div className="space-y-2 pt-1">
                <div className="h-9 w-full rounded-[10px] bg-surface-hover animate-pulse" />
                <div className="h-9 w-full rounded-[10px] bg-surface-hover animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer Palette Skeleton */}
      <footer className="fixed inset-x-0 bottom-0 h-20 border-t border-border bg-surface/80 p-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
          <div className="h-8 w-24 rounded bg-surface animate-pulse" />
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="size-8 rounded-lg bg-surface animate-pulse" />
            ))}
          </div>
          <div className="h-8 w-24 rounded bg-surface animate-pulse" />
        </div>
      </footer>
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
  const tu = useTranslations("uiText");
  const [exam, setExam] = React.useState<MockExamDetail | null>(() =>
    initialExam ? normalizeExamPayload(initialExam) : null
  );
  const [isLoading, setIsLoading] = React.useState<boolean>(
    !initialExam || !initialExam.sections || initialExam.sections.length === 0
  );
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  // Kiosk Isolation Mode: unmount outside elements & suppress browser scrolling
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("cd-kiosk-mode");
    return () => {
      document.body.classList.remove("cd-kiosk-mode");
    };
  }, []);

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
        const res = await fetch("/api/backend/exams/active", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setFetchError(
            res.status === 404 || res.status === 401 || res.status === 403
              ? tu("cd.notFound")
              : tu("cd.serverError", { status: res.status })
          );
          setIsLoading(false);
          return;
        }
        const rawData: unknown = await res.json();
        const parsed = normalizeExamPayload(rawData);
        if (!parsed || (parsed.questionCount ?? 0) === 0) {
          setFetchError(null);
          setIsLoading(false);
          return;
        }
        setExam(parsed);
        setIsLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setFetchError(null);
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

  // Resizable Split-Screen state
  const [splitRatio, setSplitRatio] = React.useState<number>(50);
  const [isDragging, setIsDragging] = React.useState<boolean>(false);
  const splitContainerRef = React.useRef<HTMLDivElement>(null);

  // Text Highlighting state
  const [highlights, setHighlights] = React.useState<string[]>([]);
  const [showHighlightTooltip, setShowHighlightTooltip] = React.useState<boolean>(false);

  const [saveStatus, setSaveStatus] = React.useState<"idle" | "saved" | "error">("idle");

  // Load drafts from localStorage on exam initialization
  React.useEffect(() => {
    if (typeof window === "undefined" || !exam?.id) return;
    try {
      const stored = localStorage.getItem(`bw_sim_draft_${exam.id}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.answers) setAnswers((a) => ({ ...parsed.answers, ...a }));
        if (parsed?.flagged) setFlagged((f) => ({ ...parsed.flagged, ...f }));
        if (parsed?.highlights) setHighlights(parsed.highlights);
      }
    } catch {}
  }, [exam?.id]);

  // Sync timer once exam data resolves
  React.useEffect(() => {
    if (!isLoading && totalMinutes > 0) {
      setSecondsLeft((s) => (s <= 0 || s === 150 * 60 ? totalMinutes * 60 : s));
    }
  }, [isLoading, totalMinutes]);

  // Auto-enter fullscreen on first interaction
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

  // Timer interval
  React.useEffect(() => {
    if (isLoading) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  // Resizable split-screen drag event listeners
  React.useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const ratio = ((clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(75, Math.max(25, ratio)));
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [isDragging]);

  const part = parts[partIdx] ?? parts[0];

  function toggleFlag(id: string) {
    setFlagged((f) => {
      const updated = { ...f, [id]: !f[id] };
      if (typeof window !== "undefined" && exam?.id) {
        try {
          const draft = JSON.parse(localStorage.getItem(`bw_sim_draft_${exam.id}`) || "{}");
          draft.flagged = updated;
          localStorage.setItem(`bw_sim_draft_${exam.id}`, JSON.stringify(draft));
        } catch {}
      }
      return updated;
    });
  }

  function handleAnswer(qid: string, val: string) {
    const updated = { ...answers, [qid]: val };
    setAnswers(updated);
    // This screen is a demo, not an attempt. Only store a browser-local draft.
    try {
      if (!exam?.id) throw new Error("Missing exam ID");
      const key = `bw_sim_draft_${exam.id}`;
      const draft = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify({ ...draft, answers: updated }));
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  function handlePassageMouseUp() {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 1) {
      setShowHighlightTooltip(true);
    } else {
      setShowHighlightTooltip(false);
    }
  }

  function applyHighlight() {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (text.length > 1 && !highlights.includes(text)) {
      const updated = [...highlights, text];
      setHighlights(updated);
      if (exam?.id) {
        try {
          const draft = JSON.parse(localStorage.getItem(`bw_sim_draft_${exam.id}`) || "{}");
          draft.highlights = updated;
          localStorage.setItem(`bw_sim_draft_${exam.id}`, JSON.stringify(draft));
        } catch {}
      }
    }
    sel.removeAllRanges();
    setShowHighlightTooltip(false);
  }

  function clearAllHighlights() {
    setHighlights([]);
    if (typeof window !== "undefined" && exam?.id) {
      try {
        const draft = JSON.parse(localStorage.getItem(`bw_sim_draft_${exam.id}`) || "{}");
        delete draft.highlights;
        localStorage.setItem(`bw_sim_draft_${exam.id}`, JSON.stringify(draft));
      } catch {}
    }
  }

  function renderHighlightedPassage(text: string) {
    if (!highlights.length || !text) return text;
    const escaped = highlights
      .filter(Boolean)
      .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!escaped.length) return text;
    try {
      const regex = new RegExp(`(${escaped.join("|")})`, "gi");
      const chunks = text.split(regex);
      return chunks.map((chunk, idx) =>
        highlights.some((h) => h.toLowerCase() === chunk.toLowerCase()) ? (
          <mark
            key={idx}
            className="rounded bg-warning/40 text-fg px-1 py-0.5 font-medium transition-colors"
          >
            {chunk}
          </mark>
        ) : (
          chunk
        )
      );
    } catch {
      return text;
    }
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

  // Authentic Skeleton Loader instead of simple spinner
  if (isLoading) {
    return <CDLayoutSkeleton />;
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
      <style>{`
        body.cd-kiosk-mode {
          overflow: hidden !important;
        }
        body.cd-kiosk-mode .mobile-app-hide,
        body.cd-kiosk-mode header:not(.cd-header),
        body.cd-kiosk-mode footer:not(.cd-footer),
        body.cd-kiosk-mode aside {
          display: none !important;
        }
      `}</style>

      <div className={cn("min-h-screen w-full bg-bg text-fg select-none", FONT_CLASS[fontSize])}>
        {/* Top Header */}
        <header className="cd-header sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-md px-3 py-2.5 sm:px-6">
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

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {saveStatus === "saved" && <span role="status" className="text-xs text-brand">{tu("cd.savedLocal")}</span>}
              {saveStatus === "error" && <span role="alert" className="text-xs text-danger">{tu("cd.saveFailed")}</span>}

              {/* Timer */}
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

        {/* Demo banner */}
        <div role="note" className="border-b border-warning-border bg-warning-bg px-3 py-2 text-center text-xs font-medium text-fg sm:px-6">
          {tu("cd.demoBanner")}{" "}
          {exam?.id ? (
            <Link href={`/mock/${encodeURIComponent(exam.id)}`} className="font-semibold text-brand underline underline-offset-2">
              {tu("cd.startReal")}
            </Link>
          ) : null}
        </div>

        {/* Main Body with Resizable Split-Screen for Reading & Writing */}
        <main className="mx-auto max-w-7xl px-3 py-3 sm:px-6 sm:py-4 pb-28">
          <ErrorBoundary fallbackTitle={tu("cd.partError")}>
            {children ? (
              children
            ) : isPart4Map ? (
              <SplitScreenMap
                groupId={part.group?.id}
                hasImage={Boolean(part.group?.imageUrl)}
                title={part.group?.title || "Community Centre Plan (Map)"}
              >
                <div className="space-y-4">
                  {(part.group?.questions || []).map((q, qi) => {
                    const promptText = q?.prompt || (q as any)?.text || "";
                    return (
                      <StrictErrorBoundary key={q.id || qi} fallbackTitle={tu("cd.questionError", { number: part.startIndex + qi + 1 })}>
                        <div id={`cd-q-${q.id}`} className="rounded-[12px] border border-border bg-surface p-4">
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
                                  ? "border-warning bg-warning/20 text-warning"
                                  : "border-border text-fg-muted hover:border-warning hover:text-warning"
                              )}
                            >
                              <Flag className="size-3.5" />
                            </button>
                          </div>
                          <ListeningPart1Radio
                            q={q}
                            value={answers[q.id] ?? ""}
                            onChange={(v) => handleAnswer(q.id, v)}
                          />
                        </div>
                      </StrictErrorBoundary>
                    );
                  })}
                </div>
              </SplitScreenMap>
            ) : (
              /* Resizable Split-Screen Container with Independent Scrolling */
              <div
                ref={splitContainerRef}
                className="flex w-full flex-col lg:flex-row items-stretch gap-0 relative"
              >
                {/* Left Pane: Passage / Audio / Stimulus with Independent Scroll */}
                <div
                  style={{ width: undefined }}
                  className="w-full lg:flex-1 rounded-[12px] border border-border bg-surface p-4 sm:p-5 flex flex-col h-[calc(100vh-180px)] overflow-y-auto"
                  onMouseUp={handlePassageMouseUp}
                >
                  <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
                    <h2 className="text-sm font-extrabold tracking-wide uppercase text-fg flex items-center gap-2">
                      Part {partIdx + 1}
                      <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-subtle-fg normal-case">
                        {part.skill}
                      </span>
                    </h2>

                    {/* Passage Highlighter Controls */}
                    <div className="flex items-center gap-1">
                      {showHighlightTooltip && (
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={applyHighlight}
                          className="h-7 px-2 text-xs bg-warning text-slate-950 hover:bg-warning font-bold"
                        >
                          <Highlighter className="size-3 mr-1" />
                          {tu("cd.highlight")}
                        </Button>
                      )}
                      {highlights.length > 0 && (
                        <button
                          type="button"
                          onClick={clearAllHighlights}
                          title={tu("cd.clearHighlights")}
                          className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-warning px-2 py-0.5 rounded border border-border"
                        >
                          <RotateCcw className="size-3" />
                          {tu("cd.clear")}
                        </button>
                      )}
                    </div>
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
                    <div className="whitespace-pre-line text-base sm:text-[17px] leading-relaxed text-fg max-w-[70ch] pr-2 flex-1">
                      {renderHighlightedPassage(part.group.passageText)}
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-fg-muted">
                      <FileText className="size-4 text-brand" />
                      {tu("cd.doTasks")}
                    </p>
                  )}
                </div>

                {/* Draggable Divider Handle for Split-Screen (Desktop only) */}
                <div
                  onMouseDown={() => setIsDragging(true)}
                  onTouchStart={() => setIsDragging(true)}
                  className="hidden lg:flex w-3 items-center justify-center cursor-col-resize hover:bg-brand/20 active:bg-brand/40 transition-colors z-10 select-none group"
                  title={tu("cd.resize")}
                >
                  <div className="flex flex-col gap-1 items-center justify-center py-2 px-0.5 rounded bg-surface border border-border group-hover:border-brand">
                    <GripVertical className="size-3 text-fg-muted group-hover:text-brand" />
                  </div>
                </div>

                {/* Right Pane: Questions with Independent Scroll */}
                <div className="w-full lg:flex-1 space-y-4 h-[calc(100vh-180px)] overflow-y-auto pl-0 lg:pl-1 pr-1">
                  <div className="flex items-center justify-between sticky top-0 bg-bg/90 backdrop-blur py-1 z-10">
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
                        <StrictErrorBoundary key={q.id || qi} fallbackTitle={tu("cd.questionNotLoaded", { number: part.startIndex + qi + 1 })}>
                          <div id={`cd-q-${q.id}`} className="rounded-[12px] border border-border bg-surface p-4">
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
                                    ? "border-warning bg-warning/20 text-warning"
                                    : "border-border text-fg-muted hover:border-warning hover:text-warning"
                                )}
                              >
                                <Flag className="size-3.5" />
                              </button>
                            </div>

                            {isPart1Listening ? (
                              <ListeningPart1Radio
                                q={q}
                                value={answers[q.id] ?? ""}
                                onChange={(v) => handleAnswer(q.id, v)}
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
                                      onClick={() => handleAnswer(q.id, selected ? "" : opt)}
                                      className={cn(
                                        "flex w-full items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-left text-sm transition-all touch-manipulation",
                                        selected
                                          ? "border-brand bg-brand-subtle/40 text-brand-subtle-fg font-medium"
                                          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "grid size-4 shrink-0 place-items-center rounded-full border",
                                          selected ? "border-brand bg-brand" : "border-fg-subtle"
                                        )}
                                      >
                                        {selected && <span className="size-2 rounded-full bg-surface" />}
                                      </span>
                                      <span>{opt}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <input
                                value={answers[q.id] ?? ""}
                                onChange={(e) => handleAnswer(q.id, e.target.value)}
                                placeholder={tu("cd.typeAnswer")}
                                aria-label={promptText}
                                className="mt-3 w-full rounded-[12px] border border-border bg-bg px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none"
                              />
                            )}
                          </div>
                        </StrictErrorBoundary>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </ErrorBoundary>
        </main>

        {/* Fixed Bottom Palette & Navigation */}
        <footer className="cd-footer fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 backdrop-blur-md p-2.5 sm:px-6">
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
                <span className="hidden sm:inline">{tu("cd.prevPart")}</span>
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
                          ? "border-brand bg-brand text-brand-fg scale-105"
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
                <span className="hidden sm:inline">{tu("cd.nextPart")}</span>
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
              <DialogTitle>{tu("cd.helpTitle")}</DialogTitle>
              <DialogDescription>
                {tu("cd.helpIntro")}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
                <li>{tu("cd.help1")}</li>
                <li>{tu("cd.help2")}</li>
                <li>{tu("cd.help3")}</li>
                <li>{tu("cd.help4")}</li>
                <li>{tu("cd.help5")}</li>
              </ul>
            </DialogBody>
          </DialogContent>
        </Dialog>

        {/* Hide screen overlay */}
        {hidden && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg" role="alertdialog">
            <Pause className="size-10 text-fg-subtle" />
            <p className="text-lg font-semibold text-fg">{tu("cd.hidden")}</p>
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
