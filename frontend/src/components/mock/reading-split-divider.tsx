"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export const READING_SPLIT_MIN = 25;
export const READING_SPLIT_MAX = 75;
export const READING_SPLIT_DEFAULT = 50;
const KEY = "bw_reading_split";

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return READING_SPLIT_DEFAULT;
  return Math.round(Math.min(READING_SPLIT_MAX, Math.max(READING_SPLIT_MIN, value)));
}

/** A remembered split share (%) for one screen, in localStorage, shared by every component that shows it. */
function createSplitStore(storageKey: string, eventName: string, fallback: number) {
  const read = (): number => {
    try { const saved = Number(window.localStorage.getItem(storageKey)); return saved ? clampSplit(saved) : fallback; } catch { return fallback; }
  };
  const subscribe = (onChange: () => void) => {
    window.addEventListener(eventName, onChange);
    window.addEventListener("storage", onChange);
    return () => { window.removeEventListener(eventName, onChange); window.removeEventListener("storage", onChange); };
  };
  return function useSplit(): [number, (value: number) => void] {
    const split = React.useSyncExternalStore(subscribe, read, () => fallback);
    const update = React.useCallback((value: number) => {
      try { window.localStorage.setItem(storageKey, String(clampSplit(value))); } catch { /* storage unavailable */ }
      window.dispatchEvent(new Event(eventName));
    }, []);
    return [split, update];
  };
}

/** The passage column's share (%) of the Reading split, remembered on this device. */
export const useReadingSplit = createSplitStore(KEY, "bw-reading-split", READING_SPLIT_DEFAULT);

/** Writing: the task column's share (%). Smaller than Reading's half so the answer keeps most of the width. */
export const WRITING_SPLIT_DEFAULT = 42;
export const useWritingSplit = createSplitStore("bw_writing_split", "bw-writing-split", WRITING_SPLIT_DEFAULT);

/**
 * Draggable divider between the Reading passage and the questions (wide screens only; phones
 * use the Passage / Questions tabs). Pointer drag, or the keyboard: arrows move it by 5 %,
 * Home / End go to the limits, Enter puts it back in the middle.
 */
export function ReadingSplitDivider({ value, onChange, containerRef, variant = "reading" }: {
  value: number;
  onChange: (value: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  /** "writing": task | answer (own labels and default share). */
  variant?: "reading" | "writing";
}) {
  const home = variant === "writing" ? WRITING_SPLIT_DEFAULT : READING_SPLIT_DEFAULT;
  const t = useTranslations("mock.runnerUx");
  const [dragging, setDragging] = React.useState(false);
  const fromPointer = (clientX: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    onChange(((clientX - box.left) / box.width) * 100);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t(variant === "writing" ? "writingSplitDivider" : "splitDivider")}
      aria-valuemin={READING_SPLIT_MIN}
      aria-valuemax={READING_SPLIT_MAX}
      aria-valuenow={value}
      aria-valuetext={variant === "writing" ? t("writingSplitValue", { task: value, answer: 100 - value }) : t("splitValue", { passage: value, questions: 100 - value })}
      tabIndex={0}
      data-testid={variant === "writing" ? "writing-split-divider" : "reading-split-divider"}
      className={cn(
        // Sticky like the two columns, so the grip stays in view (never under the question palette).
        "group relative hidden w-3 cursor-col-resize touch-none select-none items-stretch justify-center self-start lg:sticky lg:top-24 lg:flex lg:h-[calc(100vh-9rem)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        setDragging(true);
        // Listen on the window while dragging: the pointer may leave the thin divider.
        const move = (e: PointerEvent) => fromPointer(e.clientX);
        const stop = () => {
          setDragging(false);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
      }}
      onDoubleClick={() => onChange(home)}
      onKeyDown={(event) => {
        const next = { ArrowLeft: value - 5, ArrowRight: value + 5, Home: READING_SPLIT_MIN, End: READING_SPLIT_MAX, Enter: home }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onChange(next);
      }}
    >
      <span className={cn("w-px rounded-full bg-border transition-colors group-hover:bg-brand", dragging && "bg-brand")} aria-hidden />
      <span className={cn(
        "absolute top-[30%] -translate-y-1/2 rounded-md border border-border bg-surface p-0.5 text-fg-muted shadow-sm transition-colors group-hover:border-brand group-hover:text-brand",
        dragging && "border-brand text-brand",
      )} aria-hidden>
        <GripVertical className="size-3.5" />
      </span>
    </div>
  );
}
