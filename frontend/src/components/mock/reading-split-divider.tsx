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

const SPLIT_EVENT = "bw-reading-split";
function readSplit(): number {
  try { const saved = Number(window.localStorage.getItem(KEY)); return saved ? clampSplit(saved) : READING_SPLIT_DEFAULT; } catch { return READING_SPLIT_DEFAULT; }
}
function subscribeSplit(onChange: () => void) {
  window.addEventListener(SPLIT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(SPLIT_EVENT, onChange); window.removeEventListener("storage", onChange); };
}

/** The passage column's share (%) of the Reading split, remembered on this device. */
export function useReadingSplit(): [number, (value: number) => void] {
  const split = React.useSyncExternalStore(subscribeSplit, readSplit, () => READING_SPLIT_DEFAULT);
  const update = React.useCallback((value: number) => {
    try { window.localStorage.setItem(KEY, String(clampSplit(value))); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(SPLIT_EVENT));
  }, []);
  return [split, update];
}

/**
 * Draggable divider between the Reading passage and the questions (wide screens only; phones
 * use the Passage / Questions tabs). Pointer drag, or the keyboard: arrows move it by 5 %,
 * Home / End go to the limits, Enter puts it back in the middle.
 */
export function ReadingSplitDivider({ value, onChange, containerRef }: {
  value: number;
  onChange: (value: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
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
      aria-label={t("splitDivider")}
      aria-valuemin={READING_SPLIT_MIN}
      aria-valuemax={READING_SPLIT_MAX}
      aria-valuenow={value}
      aria-valuetext={t("splitValue", { passage: value, questions: 100 - value })}
      tabIndex={0}
      data-testid="reading-split-divider"
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
      onDoubleClick={() => onChange(READING_SPLIT_DEFAULT)}
      onKeyDown={(event) => {
        const next = { ArrowLeft: value - 5, ArrowRight: value + 5, Home: READING_SPLIT_MIN, End: READING_SPLIT_MAX, Enter: READING_SPLIT_DEFAULT }[event.key];
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
