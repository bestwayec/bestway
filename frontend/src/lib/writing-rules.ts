/**
 * Writing rules of the exam window.
 *
 * Word count, close to how IELTS examiners count: words are separated by spaces; a
 * hyphenated word ("well-known") or a contraction ("don't") is one word; numbers count as
 * words; a token with no letter or digit (a dash, dots, a lone bracket) is not a word.
 */
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  return text.split(/\s+/u).filter((token) => HAS_WORD_CHARACTER.test(token)).length;
}

/**
 * Clipboard policy in the timed exam: text cannot be pasted in from outside the exam, and
 * exam content cannot be copied out; inside a writing answer the student may cut, copy and
 * paste their own text. Only the last text copied inside the answer can be pasted.
 */
export const WRITING_AREA_ATTRIBUTE = "data-exam-writing";
let internalClipboard: string | null = null;

const normalise = (text: string) => text.replace(/\r\n/g, "\n").trim();

function inWritingArea(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(`[${WRITING_AREA_ATTRIBUTE}]`));
}

function selectedText(target: EventTarget | null): string {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return target.value.slice(start, end);
  }
  return typeof window !== "undefined" ? String(window.getSelection() ?? "") : "";
}

export type ClipboardDecision = "allow" | "block";

/** Decide one copy / cut / paste event. Copying inside an answer remembers the text. */
export function clipboardDecision(kind: "copy" | "cut" | "paste", event: { target: EventTarget | null; clipboardData?: DataTransfer | null }): ClipboardDecision {
  if (!inWritingArea(event.target)) return "block";
  if (kind === "copy" || kind === "cut") {
    const text = selectedText(event.target);
    internalClipboard = text ? normalise(text) : internalClipboard;
    return "allow";
  }
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  return internalClipboard !== null && normalise(pasted) === internalClipboard && pasted.length > 0 ? "allow" : "block";
}

/** For tests and a new attempt. */
export function resetInternalClipboard() {
  internalClipboard = null;
}
