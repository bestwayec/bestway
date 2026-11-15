"use client";

import * as React from "react";
import { BookPlus, Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/** Marks text a student may click for a word (practice only; never in a timed exam). */
export const VOCAB_TEXT_ATTRIBUTE = "data-vocab-text";

type Lookup = { word: string; cleanWord: string; uzbek: string; partOfSpeech: string; source?: string };
type Found = { word: string; x: number; y: number };

/** The English word under a point of the page, or null. */
export function wordAt(text: string, offset: number): string | null {
  if (offset < 0 || offset > text.length) return null;
  const isLetter = (c: string | undefined) => !!c && /[A-Za-z'’-]/.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isLetter(text[start - 1])) start -= 1;
  while (end < text.length && isLetter(text[end])) end += 1;
  const word = text.slice(start, end).replace(/^['’-]+|['’-]+$/g, "");
  return /^[A-Za-z][A-Za-z'’-]*$/.test(word) && word.length >= 2 ? word : null;
}

function pointWord(x: number, y: number): string | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position && position.offsetNode.nodeType === Node.TEXT_NODE) return wordAt(position.offsetNode.textContent ?? "", position.offset);
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) return wordAt(range.startContainer.textContent ?? "", range.startOffset);
  return null;
}

/**
 * Click-to-vocab for practice: a click on a word in a passage shows the school dictionary's
 * translation and lets the student keep the word. A word the dictionary does not know is said
 * to be unknown; no translation is made up.
 */
export function VocabLookup({ enabled }: { enabled: boolean }) {
  const t = useTranslations("mock.vocab");
  const [found, setFound] = React.useState<Found | null>(null);
  const [result, setResult] = React.useState<Lookup | null | "error">(null);
  const [saved, setSaved] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  React.useEffect(() => {
    if (!enabled) { setFound(null); return; }
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(`[${VOCAB_TEXT_ATTRIBUTE}]`)) return;
      if (window.getSelection()?.toString().trim()) return;   // selecting text is for highlights
      const word = pointWord(event.clientX, event.clientY);
      if (!word) return;
      setFound({ word, x: Math.min(event.clientX, window.innerWidth - 280), y: event.clientY + 16 });
      setResult(null);
      setSaved("idle");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [enabled]);

  React.useEffect(() => {
    if (!found) return;
    let alive = true;
    api.get<Lookup>("/vocabulary/lookup", { word: found.word })
      .then((data) => { if (alive) setResult(data); })
      .catch(() => { if (alive) setResult("error"); });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFound(null); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
  }, [found]);

  if (!enabled || !found) return null;
  const known = result && result !== "error" && result.source !== "general" ? result : null;
  return (
    <div
      role="dialog"
      aria-label={t("title", { word: found.word })}
      data-testid="vocab-lookup"
      className="fixed z-[70] w-64 rounded-xl border border-border bg-surface p-3 text-sm shadow-xl"
      style={{ left: Math.max(8, found.x), top: Math.min(found.y, window.innerHeight - 160) }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-fg">{found.word}</p>
        <button type="button" className="-m-1 rounded p-1 text-fg-muted hover:text-fg" aria-label={t("close")} onClick={() => setFound(null)}>
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {result === null ? (
        <p className="mt-2 flex items-center gap-2 text-fg-muted"><Loader2 className="size-4 animate-spin" aria-hidden />{t("loading")}</p>
      ) : result === "error" ? (
        <p className="mt-2 text-danger">{t("error")}</p>
      ) : known ? (
        <>
          <p className="mt-1 text-xs text-fg-muted">{known.partOfSpeech}</p>
          <p className="mt-1 text-fg">{known.uzbek}</p>
          <Button
            type="button" size="sm" variant="outline" className="mt-3 w-full"
            disabled={saved === "saving" || saved === "saved"}
            onClick={() => {
              setSaved("saving");
              api.post("/vocabulary/user-words/add", { english: known.cleanWord, uzbek: known.uzbek })
                .then(() => setSaved("saved"))
                .catch(() => setSaved("error"));
            }}
          >
            {saved === "saved" ? <Check className="size-4" aria-hidden /> : <BookPlus className="size-4" aria-hidden />}
            {saved === "saved" ? t("saved") : t("save")}
          </Button>
          {saved === "error" && <p className="mt-1 text-xs text-danger">{t("saveError")}</p>}
        </>
      ) : (
        <p className="mt-2 text-fg-muted">{t("unknown")}</p>
      )}
    </div>
  );
}
