"use client";

import * as React from "react";
import { Highlighter, Underline as UnderlineIcon, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CbtAnnotations {
  highlights: string[];
  greenHighlights?: string[];
  underlines: string[];
}

interface CbtAnnotatedTextProps {
  text: string;
  storageKey: string;
  className?: string;
  fontSize?: number | string;
}

function loadAnnotations(key: string): CbtAnnotations {
  if (typeof window === "undefined") return { highlights: [], greenHighlights: [], underlines: [] };
  try {
    const raw = localStorage.getItem(`bestway.cbt_annotations.${key}`);
    if (!raw) return { highlights: [], greenHighlights: [], underlines: [] };
    const parsed = JSON.parse(raw);
    return {
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter((s: unknown): s is string => typeof s === "string") : [],
      greenHighlights: Array.isArray(parsed.greenHighlights) ? parsed.greenHighlights.filter((s: unknown): s is string => typeof s === "string") : [],
      underlines: Array.isArray(parsed.underlines) ? parsed.underlines.filter((s: unknown): s is string => typeof s === "string") : [],
    };
  } catch {
    return { highlights: [], greenHighlights: [], underlines: [] };
  }
}

function saveAnnotations(key: string, data: CbtAnnotations) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`bestway.cbt_annotations.${key}`, JSON.stringify(data));
  } catch {
    // Ignore private browsing storage quota exceptions
  }
}

interface Segment {
  text: string;
  isYellow: boolean;
  isGreen: boolean;
  isUnderline: boolean;
}

function buildSegments(
  text: string,
  yellows: string[],
  greens: string[],
  underlines: string[]
): Segment[] {
  if (!text) return [];
  const len = text.length;
  const isYellow = new Uint8Array(len);
  const isGreen = new Uint8Array(len);
  const isUnderline = new Uint8Array(len);

  const markMatches = (phraseList: string[], target: Uint8Array) => {
    for (const phrase of phraseList) {
      if (!phrase || phrase.length < 2) continue;
      let startIdx = 0;
      while (startIdx < len) {
        const at = text.indexOf(phrase, startIdx);
        if (at === -1) break;
        for (let i = at; i < at + phrase.length; i++) {
          target[i] = 1;
        }
        startIdx = at + 1;
      }
    }
  };

  markMatches(yellows, isYellow);
  markMatches(greens, isGreen);
  markMatches(underlines, isUnderline);

  const segments: Segment[] = [];
  let curStart = 0;

  for (let i = 1; i <= len; i++) {
    const prevMatches =
      i < len &&
      isYellow[i] === isYellow[curStart] &&
      isGreen[i] === isGreen[curStart] &&
      isUnderline[i] === isUnderline[curStart];

    if (!prevMatches || i === len) {
      segments.push({
        text: text.slice(curStart, i),
        isYellow: isYellow[curStart] === 1,
        isGreen: isGreen[curStart] === 1,
        isUnderline: isUnderline[curStart] === 1,
      });
      curStart = i;
    }
  }

  return segments;
}

export function CbtAnnotatedText({
  text,
  storageKey,
  className,
  fontSize,
}: CbtAnnotatedTextProps) {
  const [annotations, setAnnotations] = React.useState<CbtAnnotations>(() =>
    loadAnnotations(storageKey)
  );

  const [menu, setMenu] = React.useState<{
    x: number;
    y: number;
    selectedText: string;
    isExistingAnnotation?: boolean;
  } | null>(null);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setAnnotations(loadAnnotations(storageKey));
    setMenu(null);
  }, [storageKey]);

  const updateAnnotations = React.useCallback(
    (updater: (prev: CbtAnnotations) => CbtAnnotations) => {
      setAnnotations((prev) => {
        const next = updater(prev);
        saveAnnotations(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const handleSelection = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const selected = sel.toString().trim();
    if (selected.length < 2) return;

    const container = containerRef.current;
    if (!container || !container.contains(sel.anchorNode)) return;

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const x = Math.max(
        10,
        Math.min(
          rect.left - containerRect.left + rect.width / 2 - 110,
          containerRect.width - 240
        )
      );
      const y = Math.max(8, rect.top - containerRect.top - 46);

      setMenu({
        x,
        y,
        selectedText: selected,
      });
    } catch {
      // Range calculation fallback
    }
  }, []);

  const addHighlight = React.useCallback(
    (color: "yellow" | "green" = "yellow") => {
      const targetText = menu?.selectedText;
      if (!targetText) return;

      updateAnnotations((prev) => {
        const nextYellows =
          color === "yellow" && !prev.highlights.includes(targetText)
            ? [...prev.highlights, targetText]
            : prev.highlights.filter((h) => h !== targetText);

        const nextGreens =
          color === "green" && !(prev.greenHighlights ?? []).includes(targetText)
            ? [...(prev.greenHighlights ?? []), targetText]
            : (prev.greenHighlights ?? []).filter((h) => h !== targetText);

        return {
          ...prev,
          highlights: nextYellows,
          greenHighlights: nextGreens,
        };
      });

      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }
      setMenu(null);
    },
    [menu, updateAnnotations]
  );

  const addUnderline = React.useCallback(() => {
    const targetText = menu?.selectedText;
    if (!targetText) return;

    updateAnnotations((prev) => {
      if (prev.underlines.includes(targetText)) return prev;
      return {
        ...prev,
        underlines: [...prev.underlines, targetText],
      };
    });

    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    setMenu(null);
  }, [menu, updateAnnotations]);

  const clearAnnotation = React.useCallback(
    (textToClear?: string) => {
      const target = textToClear ?? menu?.selectedText;
      if (!target) return;

      updateAnnotations((prev) => ({
        highlights: prev.highlights.filter(
          (h) => !h.includes(target) && !target.includes(h)
        ),
        greenHighlights: (prev.greenHighlights ?? []).filter(
          (h) => !h.includes(target) && !target.includes(h)
        ),
        underlines: prev.underlines.filter(
          (u) => !u.includes(target) && !target.includes(u)
        ),
      }));

      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }
      setMenu(null);
    },
    [menu, updateAnnotations]
  );

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(null);
        return;
      }
      if (e.altKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        addHighlight("yellow");
      } else if (e.altKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        addUnderline();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addHighlight, addUnderline]);

  const paragraphs = React.useMemo(() => {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={cn("relative select-text", className)}
      style={fontSize ? { fontSize } : undefined}
      onMouseUp={() => {
        window.setTimeout(handleSelection, 20);
      }}
      onTouchEnd={() => {
        window.setTimeout(handleSelection, 100);
      }}
    >
      {/* Floating Toolbar */}
      {menu && (
        <div
          role="toolbar"
          aria-label="CBT Text Tools"
          className="absolute z-50 flex items-center gap-1 rounded-lg border border-border/80 bg-surface/95 px-2 py-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${menu.x}px`,
            top: `${menu.y}px`,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Highlight Yellow */}
          <button
            type="button"
            onClick={() => addHighlight("yellow")}
            title="Sariq bo'yash (Alt+H)"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-amber-500 hover:bg-amber-500/15 transition-colors touch-manipulation"
          >
            <span className="size-3.5 rounded-full bg-amber-400 border border-amber-600/30" />
            <span>Highlight</span>
          </button>

          {/* Highlight Green */}
          <button
            type="button"
            onClick={() => addHighlight("green")}
            title="Yashil bo'yash"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/15 transition-colors touch-manipulation"
          >
            <span className="size-3.5 rounded-full bg-emerald-400 border border-emerald-600/30" />
          </button>

          {/* Underline */}
          <button
            type="button"
            onClick={addUnderline}
            title="Tagiga chizish (Alt+U)"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-sky-500 hover:bg-sky-500/15 transition-colors touch-manipulation"
          >
            <UnderlineIcon className="size-3.5" />
            <span>Underline</span>
          </button>

          <div className="h-4 w-px bg-border/60 mx-0.5" />

          {/* Clear */}
          <button
            type="button"
            onClick={() => clearAnnotation()}
            title="Tozalash"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-fg-muted hover:text-danger hover:bg-danger-subtle/30 transition-colors touch-manipulation"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      {/* Paragraphs rendering */}
      <div className="space-y-3">
        {paragraphs.map((para, pIdx) => {
          const segments = buildSegments(
            para,
            annotations.highlights,
            annotations.greenHighlights ?? [],
            annotations.underlines
          );

          return (
            <p key={pIdx} className="leading-relaxed">
              {segments.map((seg, sIdx) => {
                let content: React.ReactNode = seg.text;

                if (seg.isUnderline) {
                  content = (
                    <span
                      key={`u-${sIdx}`}
                      className="cbt-underline cursor-pointer"
                      onClick={() => clearAnnotation(seg.text)}
                      title="Chiziqni o'chirish uchun bosing"
                    >
                      {content}
                    </span>
                  );
                }

                if (seg.isYellow) {
                  content = (
                    <mark
                      key={`my-${sIdx}`}
                      className="cbt-highlight cursor-pointer"
                      onClick={() => clearAnnotation(seg.text)}
                      title="Bo'yoqni o'chirish uchun bosing"
                    >
                      {content}
                    </mark>
                  );
                } else if (seg.isGreen) {
                  content = (
                    <mark
                      key={`mg-${sIdx}`}
                      className="cbt-highlight-green cursor-pointer"
                      onClick={() => clearAnnotation(seg.text)}
                      title="Bo'yoqni o'chirish uchun bosing"
                    >
                      {content}
                    </mark>
                  );
                }

                return <React.Fragment key={sIdx}>{content}</React.Fragment>;
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}
