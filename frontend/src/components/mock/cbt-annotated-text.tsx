"use client";

import * as React from "react";
import { Underline as UnderlineIcon, Trash2, StickyNote, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CbtStickyNote {
  id: string;
  quote: string;
  text: string;
  createdAt: string;
  storageKey?: string;
}

export interface CbtAnnotations {
  highlights: string[];
  greenHighlights?: string[];
  pinkHighlights?: string[];
  underlines: string[];
  notes?: CbtStickyNote[];
}

interface CbtAnnotatedTextProps {
  text: string;
  storageKey: string;
  className?: string;
  fontSize?: number | string;
}

export const CBT_ANNOTATIONS_UPDATED_EVENT = "cbt-annotations-updated";

function loadAnnotations(key: string): CbtAnnotations {
  if (typeof window === "undefined") {
    return { highlights: [], greenHighlights: [], pinkHighlights: [], underlines: [], notes: [] };
  }
  try {
    const raw = localStorage.getItem(`bestway.cbt_annotations.${key}`);
    if (!raw) {
      return { highlights: [], greenHighlights: [], pinkHighlights: [], underlines: [], notes: [] };
    }
    const parsed = JSON.parse(raw);
    return {
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter((s: unknown): s is string => typeof s === "string")
        : [],
      greenHighlights: Array.isArray(parsed.greenHighlights)
        ? parsed.greenHighlights.filter((s: unknown): s is string => typeof s === "string")
        : [],
      pinkHighlights: Array.isArray(parsed.pinkHighlights)
        ? parsed.pinkHighlights.filter((s: unknown): s is string => typeof s === "string")
        : [],
      underlines: Array.isArray(parsed.underlines)
        ? parsed.underlines.filter((s: unknown): s is string => typeof s === "string")
        : [],
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter(
            (n: unknown): n is CbtStickyNote =>
              Boolean(n && typeof n === "object" && "id" in n && "quote" in n && "text" in n)
          )
        : [],
    };
  } catch {
    return { highlights: [], greenHighlights: [], pinkHighlights: [], underlines: [], notes: [] };
  }
}

function saveAnnotations(key: string, data: CbtAnnotations) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`bestway.cbt_annotations.${key}`, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(CBT_ANNOTATIONS_UPDATED_EVENT, { detail: { storageKey: key } }));
  } catch {
    // Ignore private browsing storage quota exceptions
  }
}

export function loadAttemptNotes(attemptId: string): CbtStickyNote[] {
  if (typeof window === "undefined" || !attemptId) return [];
  const prefix = `bestway.cbt_annotations.${attemptId}.`;
  const result: CbtStickyNote[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i);
      if (!fullKey || !fullKey.startsWith(prefix)) continue;
      const storageKey = fullKey.slice("bestway.cbt_annotations.".length);
      const data = loadAnnotations(storageKey);
      for (const note of data.notes ?? []) {
        result.push({ ...note, storageKey });
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteAttemptNote(storageKey: string, noteId: string) {
  const current = loadAnnotations(storageKey);
  const next: CbtAnnotations = {
    ...current,
    notes: (current.notes ?? []).filter((n) => n.id !== noteId),
  };
  saveAnnotations(storageKey, next);
}

interface Segment {
  text: string;
  isYellow: boolean;
  isGreen: boolean;
  isPink: boolean;
  isUnderline: boolean;
  note?: CbtStickyNote;
}

function buildSegments(
  text: string,
  yellows: string[],
  greens: string[],
  pinks: string[],
  underlines: string[],
  notes: CbtStickyNote[]
): Segment[] {
  if (!text) return [];
  const len = text.length;
  const isYellow = new Uint8Array(len);
  const isGreen = new Uint8Array(len);
  const isPink = new Uint8Array(len);
  const isUnderline = new Uint8Array(len);
  const noteIdx = new Int16Array(len).fill(-1);

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
  markMatches(pinks, isPink);
  markMatches(underlines, isUnderline);

  notes.forEach((n, idx) => {
    if (!n.quote || n.quote.length < 2) return;
    let startIdx = 0;
    while (startIdx < len) {
      const at = text.indexOf(n.quote, startIdx);
      if (at === -1) break;
      for (let i = at; i < at + n.quote.length; i++) {
        noteIdx[i] = idx;
      }
      startIdx = at + 1;
    }
  });

  const segments: Segment[] = [];
  let curStart = 0;

  for (let i = 1; i <= len; i++) {
    const prevMatches =
      i < len &&
      isYellow[i] === isYellow[curStart] &&
      isGreen[i] === isGreen[curStart] &&
      isPink[i] === isPink[curStart] &&
      isUnderline[i] === isUnderline[curStart] &&
      noteIdx[i] === noteIdx[curStart];

    if (!prevMatches || i === len) {
      const nIndex = noteIdx[curStart];
      segments.push({
        text: text.slice(curStart, i),
        isYellow: isYellow[curStart] === 1,
        isGreen: isGreen[curStart] === 1,
        isPink: isPink[curStart] === 1,
        isUnderline: isUnderline[curStart] === 1,
        note: nIndex >= 0 ? notes[nIndex] : undefined,
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

  const [noteDraftOpen, setNoteDraftOpen] = React.useState(false);
  const [noteDraftText, setNoteDraftText] = React.useState("");
  const [activeNotePopover, setActiveNotePopover] = React.useState<CbtStickyNote | null>(null);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setAnnotations(loadAnnotations(storageKey));
    setMenu(null);
    setNoteDraftOpen(false);
    setNoteDraftText("");
  }, [storageKey]);

  React.useEffect(() => {
    const onExternalUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ storageKey?: string }>).detail;
      if (!detail?.storageKey || detail.storageKey === storageKey) {
        setAnnotations(loadAnnotations(storageKey));
      }
    };
    window.addEventListener(CBT_ANNOTATIONS_UPDATED_EVENT, onExternalUpdate);
    return () => window.removeEventListener(CBT_ANNOTATIONS_UPDATED_EVENT, onExternalUpdate);
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
          rect.left - containerRect.left + rect.width / 2 - 130,
          containerRect.width - 280
        )
      );
      const y = Math.max(8, rect.top - containerRect.top - 48);

      setMenu({
        x,
        y,
        selectedText: selected,
      });
      setNoteDraftOpen(false);
      setNoteDraftText("");
    } catch {
      // Range calculation fallback
    }
  }, []);

  const addHighlight = React.useCallback(
    (color: "yellow" | "green" | "pink" = "yellow") => {
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

        const nextPinks =
          color === "pink" && !(prev.pinkHighlights ?? []).includes(targetText)
            ? [...(prev.pinkHighlights ?? []), targetText]
            : (prev.pinkHighlights ?? []).filter((h) => h !== targetText);

        return {
          ...prev,
          highlights: nextYellows,
          greenHighlights: nextGreens,
          pinkHighlights: nextPinks,
        };
      });

      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }
      setMenu(null);
      setNoteDraftOpen(false);
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
    setNoteDraftOpen(false);
  }, [menu, updateAnnotations]);

  const saveStickyNote = React.useCallback(() => {
    const targetText = menu?.selectedText;
    const trimmedNote = noteDraftText.trim();
    if (!targetText || !trimmedNote) return;

    updateAnnotations((prev) => {
      const newNote: CbtStickyNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        quote: targetText,
        text: trimmedNote,
        createdAt: new Date().toISOString(),
        storageKey,
      };
      const hasAnyHighlight =
        prev.highlights.includes(targetText) ||
        (prev.greenHighlights ?? []).includes(targetText) ||
        (prev.pinkHighlights ?? []).includes(targetText);

      return {
        ...prev,
        highlights: hasAnyHighlight ? prev.highlights : [...prev.highlights, targetText],
        notes: [...(prev.notes ?? []).filter((n) => n.quote !== targetText), newNote],
      };
    });

    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    setMenu(null);
    setNoteDraftOpen(false);
    setNoteDraftText("");
  }, [menu, noteDraftText, storageKey, updateAnnotations]);

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
        pinkHighlights: (prev.pinkHighlights ?? []).filter(
          (h) => !h.includes(target) && !target.includes(h)
        ),
        underlines: prev.underlines.filter(
          (u) => !u.includes(target) && !target.includes(u)
        ),
        notes: (prev.notes ?? []).filter(
          (n) => !n.quote.includes(target) && !target.includes(n.quote)
        ),
      }));

      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }
      setMenu(null);
      setNoteDraftOpen(false);
    },
    [menu, updateAnnotations]
  );

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(null);
        setNoteDraftOpen(false);
        setActiveNotePopover(null);
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
          className="absolute z-50 flex flex-col gap-2 rounded-xl border border-border/80 bg-surface/95 p-2 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${menu.x}px`,
            top: `${menu.y}px`,
          }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
              e.preventDefault();
            }
          }}
        >
          <div className="flex items-center gap-1">
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
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/15 transition-colors touch-manipulation"
            >
              <span className="size-3.5 rounded-full bg-emerald-400 border border-emerald-600/30" />
            </button>

            {/* Highlight Pink */}
            <button
              type="button"
              onClick={() => addHighlight("pink")}
              title="Pushti bo'yash"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-pink-500 hover:bg-pink-500/15 transition-colors touch-manipulation"
            >
              <span className="size-3.5 rounded-full bg-pink-400 border border-pink-600/30" />
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

            {/* Sticky Note ("Izoh") */}
            <button
              type="button"
              onClick={() => setNoteDraftOpen((v) => !v)}
              title="Izoh (Sticky Note) qo'shish"
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors touch-manipulation",
                noteDraftOpen
                  ? "bg-brand text-white"
                  : "text-brand hover:bg-brand/15"
              )}
            >
              <StickyNote className="size-3.5" />
              <span>Izoh</span>
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

          {noteDraftOpen && (
            <div className="flex items-center gap-1.5 border-t border-border/60 pt-2">
              <input
                type="text"
                value={noteDraftText}
                onChange={(e) => setNoteDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveStickyNote();
                  }
                }}
                placeholder="Izoh matnini yozing..."
                className="h-7 w-48 rounded-md border border-border bg-bg px-2 text-xs text-fg focus:border-brand focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={saveStickyNote}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-brand px-2.5 text-xs font-semibold text-white hover:bg-brand-hover"
              >
                <Plus className="size-3" />
                Saqlash
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active Note Popover */}
      {activeNotePopover && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-amber-400/50 bg-amber-500/10 p-2.5 text-xs text-fg">
          <div>
            <p className="font-semibold text-amber-600 dark:text-amber-300">
              📝 Izoh: &ldquo;{activeNotePopover.quote}&rdquo;
            </p>
            <p className="mt-0.5 text-fg">{activeNotePopover.text}</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveNotePopover(null)}
            className="rounded p-0.5 text-fg-muted hover:text-fg"
          >
            <X className="size-3.5" />
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
            annotations.pinkHighlights ?? [],
            annotations.underlines,
            annotations.notes ?? []
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
                } else if (seg.isPink) {
                  content = (
                    <mark
                      key={`mp-${sIdx}`}
                      className="cursor-pointer rounded-xs bg-pink-300/70 px-0.5 text-slate-900 dark:bg-pink-500/40 dark:text-pink-100"
                      onClick={() => clearAnnotation(seg.text)}
                      title="Bo'yoqni o'chirish uchun bosing"
                    >
                      {content}
                    </mark>
                  );
                }

                if (seg.note) {
                  content = (
                    <span key={`note-${sIdx}`} className="inline-flex items-baseline gap-0.5">
                      {content}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveNotePopover(seg.note ?? null);
                        }}
                        title={`Izoh: ${seg.note.text}`}
                        className="inline-flex items-center rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300 hover:bg-amber-500/30"
                      >
                        📝
                      </button>
                    </span>
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

