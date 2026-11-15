/**
 * Where an answer is in a text (S3 review). Same rule as the server
 * (apps/core/review_evidence.locate): exact first, then ignoring differences in spacing and
 * line breaks; the match is returned as it stands in the text, with its offset.
 */
export function locateEvidence(text: string | null | undefined, source: string | null | undefined): { text: string; offset: number } | null {
  const wanted = (text ?? "").trim();
  if (!wanted || !source) return null;
  const exact = source.indexOf(wanted);
  if (exact >= 0) return { text: wanted, offset: exact };
  const words = wanted.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const match = pattern.exec(source);
  return match ? { text: match[0], offset: match.index } : null;
}

/** "m:ss" or plain seconds → seconds; null when empty; NaN when it cannot be read. */
export function parseClock(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return Number.NaN;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The text split around the evidence, for rendering a <mark>. */
export function splitAtEvidence(source: string, evidence: { text: string; offset: number } | null | undefined): [string, string, string] | null {
  if (!evidence) return null;
  const { offset, text } = evidence;
  if (offset < 0 || source.slice(offset, offset + text.length) !== text) return null;
  return [source.slice(0, offset), text, source.slice(offset + text.length)];
}
