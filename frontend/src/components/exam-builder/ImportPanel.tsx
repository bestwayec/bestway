"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { QTYPE_LABEL } from "@/components/mock/exam-builder/types";
import { useImportMockQuestions } from "@/hooks/use-mock";
import { api, ApiError } from "@/lib/api-client";
import type { MockSkill } from "@/lib/types";
import { tx } from "./types";

const MAX_TEXT = 20000;
const BLANK_RE = /_{2,}|\.{3,}|…|\bgap\b/i;
const TF_TRUE = new Set(["true", "t"]);
const TF_FALSE = new Set(["false", "f"]);
const TF_NOTGIVEN = new Set(["not given", "notgiven", "not-given", "ng", "n", "g"]);
const YN_YES = new Set(["yes", "y"]);
const YN_NO = new Set(["no", "n"]);

interface ParsedQuestion {
  number: number;
  type: string;
  prompt: string;
  options?: string[] | null;
}

interface ParseResult {
  instructions?: string | null;
  count?: number;
  questions?: ParsedQuestion[];
}

/** One server-persisted question returned by the import endpoint. */
export interface ImportedServerQuestion {
  id: string;
  number: number;
  type: string;
  prompt: string;
  options?: string[] | null;
  correctAnswers?: string[] | null;
  acceptedVariants?: string[] | null;
  points?: number;
  wordLimit?: number | null;
  answerRule?: "ONE_WORD" | "ONE_WORD_AND_OR_NUMBER" | null;
}

/** Parse `1: B` style answer-key lines. */
function parseAnswerKey(raw: string): { map: Record<string, string>; bad: string[] } {
  const map: Record<string, string> = {};
  const bad: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^\s*(\d+)\s*[:.)-]?\s*(.+?)\s*$/);
    if (m) map[m[1]] = m[2];
    else bad.push(t);
  }
  return { map, bad };
}

function typeLabel(type: string): string {
  return (QTYPE_LABEL as Record<string, string>)[type] ?? type;
}

function isCanonicalTfng(raw: string): boolean {
  for (const part of raw.split(/[/;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (TF_TRUE.has(part) || TF_FALSE.has(part) || TF_NOTGIVEN.has(part)) continue;
    // Backend also keeps the raw part verbatim, but a non-canonical answer can
    // never match the TRUE/FALSE/NOT GIVEN pills students see.
    if (part === "true" || part === "false" || part === "not given") continue;
    return false;
  }
  return true;
}

function isCanonicalYnng(raw: string): boolean {
  for (const part of raw.split(/[/;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (YN_YES.has(part) || YN_NO.has(part) || TF_NOTGIVEN.has(part)) continue;
    if (part === "yes" || part === "no" || part === "not given") continue;
    return false;
  }
  return true;
}

/**
 * Professional bulk import workspace: Paste → Parse (dry run) → Preview →
 * Validate → Import. Context (exam/group/skill) is inherited from the open
 * question group — the admin never types IDs.
 *
 * Parse uses the existing `POST /mock/parse-questions` dry run (no DB write);
 * Import uses the existing `POST /mock/groups/:id/questions/import`. No new
 * syntax, no parser changes.
 */
export function ImportPanel({
  examId,
  groupId,
  skill,
  onDone,
  groupLabel,
  existingNumbers,
}: {
  examId: string;
  groupId: string;
  skill: MockSkill;
  /** Receives the persisted questions so the open editor can merge them
   *  without losing unsent local edits (no remount, no refetch wipe). */
  onDone: (added?: ImportedServerQuestion[]) => void;
  /** Human context, e.g. "Reading → Passage 2". Shown, never asked. */
  groupLabel?: string;
  /** Exam-wide used question numbers for collision detection. */
  existingNumbers?: number[];
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const [text, setText] = React.useState("");
  const [answers, setAnswers] = React.useState("");
  const [points, setPoints] = React.useState("1");
  const [preview, setPreview] = React.useState<ParseResult | null>(null);
  const [snapshot, setSnapshot] = React.useState<{ text: string; answers: string; points: string } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const importMut = useImportMockQuestions(examId);
  const importedRef = React.useRef(false);

  const key = React.useMemo(() => parseAnswerKey(answers), [answers]);
  const autoSkill = skill === "listening" || skill === "reading";
  const targetLabel = groupLabel?.trim() || "this group";
  const usedElsewhere = React.useMemo(
    () => new Set((existingNumbers ?? []).filter((n) => Number.isInteger(n))),
    [existingNumbers],
  );

  const stale =
    preview != null &&
    snapshot != null &&
    (snapshot.text !== text || snapshot.answers !== answers || snapshot.points !== points);

  const detected = React.useMemo(() => preview?.questions ?? [], [preview]);
  const answerCount = Object.keys(key.map).length;

  /* ── Client validation over the dry-run preview (blocks import) ── */
  const analysis = React.useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!preview) return { errors, warnings };
    if (detected.length === 0) {
      errors.push("No questions detected — number them 1., 2., … with text after each number.");
      return { errors, warnings };
    }
    const nums = detected.map((q) => q.number);
    const invalid = nums.filter((n) => !Number.isInteger(n) || n < 1 || n > 200);
    if (invalid.length > 0) {
      errors.push(
        `Invalid question number${invalid.length === 1 ? "" : "s"}: ${[...new Set(invalid)].slice(0, 8).join(", ")} — numbers must be 1–200.`,
      );
    }
    const seen = new Map<number, number>();
    for (const n of nums) seen.set(n, (seen.get(n) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n);
    if (dupes.length > 0) {
      errors.push(`Duplicate question number${dupes.length === 1 ? "" : "s"} in pasted text: ${dupes.slice(0, 8).join(", ")} — fix numbering before import.`);
    }
    const collisions = [...new Set(nums)].filter((n) => usedElsewhere.has(n));
    if (collisions.length > 0) {
      errors.push(
        `Already used in this exam: ${collisions.slice(0, 8).join(", ")} — importing would duplicate questions. Renumber or remove them first.`,
      );
    }
    // Gaps / jumps inside the pasted range are warnings (backend keeps numbers verbatim).
    const uniq = [...new Set(nums.filter((n) => Number.isInteger(n) && n >= 1 && n <= 200))].sort((a, b) => a - b);
    if (uniq.length >= 2) {
      const missing: number[] = [];
      for (let n = uniq[0]; n <= uniq[uniq.length - 1]; n++) {
        if (!seen.has(n)) missing.push(n);
      }
      if (missing.length > 0) {
        warnings.push(
          `Number jump in pasted text — missing: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ` (+${missing.length - 12} more)` : ""}. Numbers are kept as-is.`,
        );
      }
    }
    if (key.bad.length > 0) {
      errors.push(
        `Answer lines not understood (${key.bad.length}): ${key.bad.slice(0, 3).join(" · ")}${key.bad.length > 3 ? "…" : ""} — use "1: B" per line.`,
      );
    }
    if (autoSkill) {
      const missingKeys = detected
        .map((q) => q.number)
        .filter((n) => !(String(n) in key.map));
      if (missingKeys.length > 0) {
        errors.push(
          `Question${missingKeys.length === 1 ? "" : "s"} ${missingKeys.slice(0, 10).join(", ")}${missingKeys.length > 10 ? ` (+${missingKeys.length - 10} more)` : ""} ha${missingKeys.length === 1 ? "s" : "ve"} no answer key — every ${skill} question needs one.`,
        );
      }
    }
    const detectedSet = new Set(nums.map(String));
    const extra = Object.keys(key.map).filter((k) => !detectedSet.has(k) && !detectedSet.has(String(Number(k))));
    if (extra.length > 0 && detected.length > 0) {
      warnings.push(
        `Extra answer${extra.length === 1 ? "" : "s"} with no matching question: ${extra.slice(0, 8).join(", ")} — they will be ignored.`,
      );
    }
    // Per-answer mapping checks against detected options.
    for (const q of detected) {
      const raw = key.map[String(q.number)];
      if (raw == null || !raw.trim()) continue;
      const opts = (q.options ?? []).filter((o) => o.trim() !== "");
      if (q.type === "multiple_choice" && opts.length > 0) {
        for (const part of raw.split(/[/;]+/).map((p) => p.trim()).filter(Boolean)) {
          if (/^[A-Ha-h]$/.test(part)) {
            const idx = part.toUpperCase().charCodeAt(0) - 65;
            if (idx < 0 || idx >= opts.length) {
              errors.push(
                `Q${q.number}: answer "${part}" has no matching option (only A–${String.fromCharCode(65 + opts.length - 1)}).`,
              );
              break;
            }
          }
        }
      } else if (q.type === "true_false_notgiven") {
        if (!isCanonicalTfng(raw)) {
          errors.push(`Q${q.number}: "${raw.trim()}" is not a valid True / False / Not Given answer.`);
        }
      } else if (q.type === "yes_no_notgiven") {
        if (!isCanonicalYnng(raw)) {
          errors.push(`Q${q.number}: "${raw.trim()}" is not a valid Yes / No / Not Given answer.`);
        }
      }
    }
    // Type-guess transparency: short_answer is the parser fallback.
    const guessed = detected.filter(
      (q) => q.type === "short_answer" && !BLANK_RE.test(q.prompt) && (q.options ?? []).length === 0,
    );
    if (guessed.length > 0) {
      warnings.push(
        `${guessed.length} question${guessed.length === 1 ? "" : "s"} guessed as Short answer (${guessed.slice(0, 6).map((q) => `Q${q.number}`).join(", ")}${guessed.length > 6 ? "…" : ""}) — change the type per question after import if needed.`,
      );
    }
    return { errors, warnings };
  }, [preview, detected, key, autoSkill, skill, usedElsewhere]);

  const pts = Number(points);
  const pointsError =
    points.trim() === "" || !Number.isInteger(pts) || pts < 1 || pts > 20
      ? "Points must be a whole number from 1 to 20."
      : undefined;
  const allErrors = [...analysis.errors, ...(pointsError && preview ? [pointsError] : [])];
  const canImport =
    preview != null && !stale && detected.length > 0 && allErrors.length === 0 && !checking && !importMut.isPending;

  const typeCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const q of detected) m.set(q.type, (m.get(q.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [detected]);

  async function handleParse() {
    setPreviewError(null);
    setImportError(null);
    if (!text.trim()) {
      setPreviewError(tx(t, "pasteFirst", "Paste the questions first."));
      return;
    }
    if (text.length > MAX_TEXT) {
      setPreviewError(`Pasted text is ${text.length.toLocaleString()} characters — the server accepts up to ${MAX_TEXT.toLocaleString()}. Split it into smaller batches.`);
      return;
    }
    setChecking(true);
    try {
      // Dry run: preview endpoint never writes to the database.
      const res = await api.post<ParseResult>("/mock/parse-questions", { text });
      setPreview(res);
      setSnapshot({ text, answers, points });
    } catch (e) {
      setPreview(null);
      setSnapshot(null);
      setPreviewError(
        e instanceof ApiError
          ? `${e.message} — keep your text above and fix numbering (1., 2., …) then Parse again.`
          : `${tc("unknownError")} — your pasted content was kept. Fix it and Parse again.`,
      );
    } finally {
      setChecking(false);
    }
  }

  function handleImport() {
    if (!canImport || importedRef.current) return;
    setImportError(null);
    const map = Object.keys(key.map).length ? key.map : undefined;
    importMut.mutate(
      {
        groupId,
        text: snapshot?.text ?? text,
        answers: map,
        points: Math.floor(pts),
      },
      {
        onSuccess: (res) => {
          importedRef.current = true;
          toast.success(
            `${tx(t, "imported", "Questions imported")}: ${res.added ?? detected.length} → ${targetLabel}`,
          );
          onDone(res.questions as ImportedServerQuestion[] | undefined);
        },
        onError: (e) =>
          setImportError(
            e instanceof ApiError
              ? `${e.message} (${e.code}) — nothing was merged. Fix the issue and try Import again; your pasted content was kept.`
              : `${tc("unknownError")} — nothing was merged. Your pasted content was kept.`,
          ),
      },
    );
  }

  /** Explicit renumber aid: rewrites pasted Q numbers sequentially and remaps
   *  matching answer lines. Runs only on click, then requires a fresh Parse. */
  function handleRenumber() {
    if (detected.length === 0) return;
    const base = usedElsewhere.size > 0 ? Math.max(...usedElsewhere) + 1 : 1;
    const start = Math.max(1, base);
    const olds = detected.map((q) => q.number);
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let occ = 0;
    const nextLines = lines.map((line) => {
      const m = line.match(/^(\s*(?:Q|№|#)?\s*)(\d{1,3})(\s*[.)\]:-]?\s+\S.*)$/i);
      if (m && occ < olds.length && Number(m[2]) === olds[occ]) {
        occ += 1;
        return `${m[1]}${start + occ - 1}${m[3]}`;
      }
      return line;
    });
    const firstNew = new Map<number, number>();
    olds.forEach((old, i) => {
      if (!firstNew.has(old)) firstNew.set(old, start + i);
    });
    const nextAnswers = answers.replace(/\r\n?/g, "\n").split("\n").map((line) => {
      const m = line.match(/^(\s*)(\d+)((?:\s*[:.)-]?\s*.+)?)$/);
      if (m && firstNew.has(Number(m[2]))) return `${m[1]}${firstNew.get(Number(m[2]))}${m[3]}`;
      return line;
    });
    setText(nextLines.join("\n"));
    setAnswers(nextAnswers.join("\n"));
    setPreview(null);
    setSnapshot(null);
    setImportError(null);
    toast.success(`Renumbered to ${start}–${start + olds.length - 1} — press Parse to preview the result.`);
  }

  const showRenumber =
    preview != null &&
    (analysis.errors.some((e) => e.startsWith("Duplicate") || e.startsWith("Already used")) ||
      analysis.warnings.some((w) => w.startsWith("Number jump")));

  return (
    <Card className="min-w-0 overflow-hidden border-brand/30">
      <CardHeader>
        <CardTitle>
          {tx(t, "importTitle", "Import questions")}
          <span className="ml-2 text-xs font-normal text-fg-muted">
            Into {targetLabel} · {tx(t, "importHint", "Nothing is saved until you press Import.")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1 — Source */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            1 · Source
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field
              label={tx(t, "pasteQuestions", "Questions text")}
              hint={tx(t, "pasteQuestionsHint", "Numbered 1., 2., … — options as A) B) C), gaps as ___, TRUE/FALSE/NOT GIVEN header where needed.")}
              htmlFor="imp-text"
            >
              <Textarea
                id="imp-text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setImportError(null);
                }}
                className="min-h-36 font-mono text-[13px] sm:min-h-48"
                placeholder={"1. The library opens at…\nA) 8 am\nB) 9 am\n\n2. Complete the note: The price is ___"}
                aria-describedby="imp-text-count"
              />
              <p id="imp-text-count" className="mt-1 text-[11px] tabular-nums text-fg-subtle">
                {text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()} characters
                {text.length > MAX_TEXT && " — over the server limit, split the batch."}
              </p>
            </Field>
            <Field
              label={tx(t, "answerKey", "Answer key (one per line)")}
              hint={tx(t, "answerKeyHint", "Format: 1: B   ·   2: flowers/flower   ·   3: TRUE")}
              htmlFor="imp-answers"
              error={key.bad.length > 0 ? `Not understood: ${key.bad.slice(0, 2).join(" · ")}${key.bad.length > 2 ? "…" : ""}` : undefined}
            >
              <Textarea
                id="imp-answers"
                value={answers}
                onChange={(e) => {
                  setAnswers(e.target.value);
                  setImportError(null);
                }}
                className="min-h-36 font-mono text-[13px] sm:min-h-48"
                placeholder={"1: B\n2: flowers\n3: TRUE"}
                aria-invalid={key.bad.length > 0 ? true : undefined}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <Field label={tx(t, "pointsEach", "Points each")} htmlFor="imp-points" className="w-full sm:w-28" error={pointsError}>
              <Input
                id="imp-points"
                type="number"
                min={1}
                max={20}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                aria-invalid={pointsError ? true : undefined}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Button size="sm" variant="outline" loading={checking} onClick={() => void handleParse()} className="min-h-9 justify-center">
                {tx(t, "parseQuestions", "Parse")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-9 justify-center"
                onClick={() => {
                  setText("");
                  setAnswers("");
                  setPreview(null);
                  setSnapshot(null);
                  setPreviewError(null);
                  setImportError(null);
                }}
              >
                Clear
              </Button>
            </div>
            <p className="w-full text-[11px] text-fg-subtle">
              Parse is a dry run — it never writes to the database.
            </p>
          </div>
        </div>

        {previewError && (
          <p role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {previewError}
          </p>
        )}

        {/* Step 2 — Preview + validation */}
        {preview && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                2 · Preview — check before anything is saved
              </p>
              {stale && (
                <p role="alert" className="rounded-[8px] border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-fg">
                  Inputs changed since parsing — press Parse again to refresh this preview. Import is paused until then.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { v: String(detected.length), l: "Detected" },
                  { v: String(answerCount), l: "Answer keys" },
                  { v: String(allErrors.length), l: "Errors" },
                  { v: String(analysis.warnings.length), l: "Warnings" },
                ].map((s) => (
                  <div key={s.l} className="rounded-[10px] border border-border bg-surface p-3 text-center">
                    <p className="text-2xl font-black text-fg">{s.v}</p>
                    <p className="text-[11px] uppercase tracking-wider text-fg-muted">{s.l}</p>
                  </div>
                ))}
              </div>
              {typeCounts.length > 0 && (
                <div className="rounded-[8px] border border-border p-3">
                  <p className="text-xs font-semibold text-fg">Question types</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
                    {typeCounts.map(([ty, n]) => (
                      <li key={ty}>
                        {typeLabel(ty)} — {n}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-fg-subtle">
                    Types are the parser&apos;s best guess (multiple-choice, True/False, Yes/No,
                    sentence completion, short answer). Anything else — matching, headings, maps —
                    is added manually after import by changing each question&apos;s type.
                  </p>
                </div>
              )}
              {preview.instructions?.trim() && (
                <p className="rounded-[8px] bg-sky-500/10 px-2.5 py-1.5 text-[13px] text-fg ring-1 ring-sky-500/20">
                  Instructions found in paste: {preview.instructions.trim()}
                </p>
              )}
              {allErrors.length > 0 && (
                <div role="alert" className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {allErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.warnings.length > 0 && (
                <div className="rounded-[8px] border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-fg">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {analysis.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {showRenumber && (
                <div>
                  <Button size="sm" variant="outline" onClick={handleRenumber}>
                    Renumber pasted questions
                  </Button>
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    Rewrites pasted numbers sequentially from the next free number and updates
                    matching answer lines. Review, then Parse again.
                  </p>
                </div>
              )}
            </div>

            {detected.length > 0 && (
              <ol aria-label="Import preview" className="max-h-96 space-y-2 overflow-y-auto pr-0.5">
                {detected.map((q) => {
                  const raw = key.map[String(q.number)];
                  const hasKey = raw != null && raw.trim() !== "";
                  const rowError =
                    autoSkill && !hasKey
                      ? "No answer key."
                      : q.type === "multiple_choice" && hasKey
                        ? mcRowError(q, raw)
                        : (q.type === "true_false_notgiven" && hasKey && !isCanonicalTfng(raw)) ||
                            (q.type === "yes_no_notgiven" && hasKey && !isCanonicalYnng(raw))
                          ? `Not a valid ${q.type === "true_false_notgiven" ? "True / False / Not Given" : "Yes / No / Not Given"} answer.`
                          : undefined;
                  const opts = (q.options ?? []).filter((o) => o.trim() !== "");
                  return (
                    <li key={`${q.number}-${q.prompt.slice(0, 24)}`} className="rounded-[8px] border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                        Q{q.number} · {typeLabel(q.type)}
                      </p>
                      <p className="mt-1 text-sm break-words whitespace-pre-wrap text-fg">{q.prompt}</p>
                      {opts.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[11px] font-semibold text-fg-subtle">Options</p>
                          <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
                            {opts.map((o, i) => (
                              <li key={`${i}-${o}`} className="break-words">
                                <span className="font-mono font-bold">{String.fromCharCode(65 + i)}</span> · {o}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="mt-1.5 text-sm">
                        <span className="font-semibold text-fg">Answer: </span>
                        {hasKey ? (
                          <span className="break-words text-fg">{raw.trim()}</span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </p>
                      {rowError && (
                        <p className="mt-1 text-xs text-danger" role="alert">
                          {rowError}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {/* Step 3 — Confirm */}
            <div className="rounded-[8px] border border-border p-3">
              <p className="text-sm font-semibold text-fg">
                Import {detected.length} question{detected.length === 1 ? "" : "s"} into {targetLabel}?
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {allErrors.length > 0
                  ? "Resolve every error above — import stays disabled until then."
                  : "Questions {range} will be created exactly as previewed.".replace(
                      "{range}",
                      detected.length > 0
                        ? `Q${Math.min(...detected.map((q) => q.number))}–Q${Math.max(...detected.map((q) => q.number))}`
                        : "",
                    )}
              </p>
              {importError && (
                <p role="alert" className="mt-2 rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
                  {importError}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onDone()}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={importMut.isPending}
                  disabled={!canImport}
                  onClick={handleImport}
                  aria-disabled={!canImport}
                >
                  <Upload className="size-4" aria-hidden />
                  {importMut.isPending
                    ? "Importing…"
                    : `Import ${detected.length} question${detected.length === 1 ? "" : "s"}`}
                </Button>
                {!canImport && allErrors.length === 0 && stale && (
                  <p className="self-center text-xs text-fg-muted">Press Parse again to continue.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function mcRowError(q: ParsedQuestion, raw: string): string | undefined {
  const opts = (q.options ?? []).filter((o) => o.trim() !== "");
  for (const part of raw.split(/[/;]+/).map((p) => p.trim()).filter(Boolean)) {
    if (/^[A-Ha-h]$/.test(part)) {
      const idx = part.toUpperCase().charCodeAt(0) - 65;
      if (idx < 0 || idx >= opts.length) {
        return `Answer "${part}" has no matching option (only A–${String.fromCharCode(65 + opts.length - 1)}).`;
      }
    }
  }
  return undefined;
}

