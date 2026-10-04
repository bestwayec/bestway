"use client";

import * as React from "react";
import type { JSX } from "react";
import { ArrowDown, ArrowUp, Mic, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MockQuestionType, MockSkill } from "@/lib/types";
import { GROUPED_TYPES, QTYPE_LABEL, isAutoType, type BuilderQuestion } from "./types";

/* ── Schema-driven question authoring ─────────────────────────────────────
 * One intelligent editor: consistent outer structure (Question / Type /
 * Content / Answer / Preview), internal fields driven by the selected type.
 * Only the selected type's editor renders. Persistence shape (BuilderQuestion)
 * is unchanged — this file only adapts UI to the backend contract:
 *   options (string[], ≤26) · correctAnswers (string[], ≤20) ·
 *   acceptedVariants (string[], ≤20) · wordLimit (1–50 | undefined) ·
 *   points (1–20) · prompt (≤5000) · number (1–200).
 * Matching stores its mapping as a single expected value per question row
 * (options pool + correctAnswers[0]); the UI maps letters ↔ option text so
 * admins never type raw serialized arrays.
 */

const OPTION_TYPE_SET: ReadonlySet<MockQuestionType> = new Set([
  "multiple_choice",
  "multi_select",
  "matching",
  "matching_headings",
]);

const WORD_LIMIT_SET: ReadonlySet<MockQuestionType> = new Set([
  "short_answer",
  "sentence_completion",
  "note_completion",
  "summary_completion",
  "table_completion",
]);

const VARIANTS_SET: ReadonlySet<MockQuestionType> = new Set([
  "matching",
  "matching_headings",
  "sentence_completion",
  "note_completion",
  "summary_completion",
  "table_completion",
  "short_answer",
  "map_labelling",
]);

const AUTO_SKILLS: ReadonlySet<MockSkill> = new Set(["listening", "reading"]);

const TFNG_OPTIONS = ["TRUE", "FALSE", "NOT GIVEN"] as const;
const YNNG_OPTIONS = ["YES", "NO", "NOT GIVEN"] as const;

type Kind =
  | "choice-single"
  | "choice-multi"
  | "tfng"
  | "ynng"
  | "matching"
  | "headings"
  | "completion"
  | "short"
  | "map"
  | "essay"
  | "speaking";

function kindOf(type: MockQuestionType): Kind {
  switch (type) {
    case "multiple_choice":
      return "choice-single";
    case "multi_select":
      return "choice-multi";
    case "true_false_notgiven":
      return "tfng";
    case "yes_no_notgiven":
      return "ynng";
    case "matching":
      return "matching";
    case "matching_headings":
      return "headings";
    case "sentence_completion":
    case "note_completion":
    case "summary_completion":
    case "table_completion":
      return "completion";
    case "short_answer":
      return "short";
    case "map_labelling":
      return "map";
    case "essay_task1":
    case "essay_task2":
      return "essay";
    case "speaking_task":
      return "speaking";
  }
}

function nonEmpty(values: string[]): string[] {
  return values.filter((v) => v.trim() !== "");
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** "B. Jones" → "B". "ii. Method" → "II" (first token letters). null otherwise. */
function leadingToken(s: string): string | null {
  const m = s.trim().match(/^([A-Za-z]+)\s*[.)\-:\]]/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Resolve a stored correct value to the option it means, so legacy
 * letter-only keys ("B") still display against full option text ("B. Jones")
 * and single letters map to options by index ("B" → options[1]).
 */
function resolveOption(options: string[], correct: string): string | null {
  const c = correct.trim();
  if (!c) return null;
  const exact = options.find((o) => norm(o) === norm(c));
  if (exact !== undefined) return exact;
  // Letter ↔ option text ("B" ↔ "B. Jones").
  const upper = c.toUpperCase();
  const byPrefix = options.find((o) => leadingToken(o) === upper);
  if (byPrefix !== undefined) return byPrefix;
  // Bare index letter ("B" → second option) for pools without prefixes.
  if (/^[A-Z]$/.test(upper)) {
    const idx = upper.charCodeAt(0) - 65;
    if (options[idx] !== undefined) return options[idx];
  }
  return null;
}

function correctLabel(type: MockQuestionType): string {
  switch (kindOf(type)) {
    case "choice-multi":
      return "Correct answers";
    case "tfng":
    case "ynng":
      return "Correct answer";
    case "matching":
      return "Answer mapping";
    case "headings":
      return "Heading mapping";
    case "completion":
    case "short":
    case "map":
      return "Accepted answers";
    default:
      return "Correct answer";
  }
}

/* ── Field-level validation (type-aware, only relevant errors) ─────────── */

export interface QuestionFieldErrors {
  prompt?: string;
  number?: string;
  points?: string;
  options?: string;
  correct?: string;
  wordLimit?: string;
}

export function getQuestionFieldErrors(
  q: BuilderQuestion,
  skill: MockSkill,
): QuestionFieldErrors {
  const errs: QuestionFieldErrors = {};
  if (!q.prompt.trim()) errs.prompt = "Question text is required.";
  if (!Number.isInteger(q.number) || q.number < 1 || q.number > 200) {
    errs.number = "Number must be between 1 and 200.";
  }
  const kind = kindOf(q.type);
  const manual = !isAutoType(q.type);
  if (!manual && (!Number.isInteger(q.points) || q.points < 1 || q.points > 20)) {
    errs.points = "Points must be between 1 and 20.";
  }
  if (OPTION_TYPE_SET.has(q.type) && nonEmpty(q.options).length < 2) {
    errs.options = "Add at least 2 options.";
  }
  const keysRequired = isAutoType(q.type) && AUTO_SKILLS.has(skill);
  const keys = nonEmpty(q.correctAnswers);
  if (keysRequired) {
    if (kind === "choice-single") {
      if (keys.length === 0) errs.correct = "Select the correct option.";
      else if (!resolveOption(q.options, keys[0])) {
        errs.correct = "Select the correct option from the list.";
      }
    } else if (kind === "choice-multi") {
      if (keys.length === 0) errs.correct = "Select at least one correct answer.";
      else if (keys.some((k) => !resolveOption(q.options, k))) {
        errs.correct = "Each correct answer must match an option.";
      }
    } else if (kind === "tfng") {
      if (keys.length === 0) errs.correct = "Select True, False, or Not Given.";
      else if (!TFNG_OPTIONS.includes(keys[0].trim().toUpperCase() as (typeof TFNG_OPTIONS)[number])) {
        errs.correct = "Select True, False, or Not Given.";
      }
    } else if (kind === "ynng") {
      if (keys.length === 0) errs.correct = "Select Yes, No, or Not Given.";
      else if (!YNNG_OPTIONS.includes(keys[0].trim().toUpperCase() as (typeof YNNG_OPTIONS)[number])) {
        errs.correct = "Select Yes, No, or Not Given.";
      }
    } else if (kind === "matching" || kind === "headings") {
      if (keys.length === 0) {
        errs.correct = kind === "matching" ? "Choose the matching answer." : "Choose the correct heading.";
      } else if (!resolveOption(q.options, keys[0])) {
        errs.correct = "Choose the matching answer from the list.";
      }
    } else if (kind === "completion" || kind === "short" || kind === "map") {
      if (keys.length === 0) errs.correct = "Add at least one accepted answer.";
    }
  }
  if (WORD_LIMIT_SET.has(q.type) && q.wordLimit != null) {
    if (!Number.isInteger(q.wordLimit) || q.wordLimit < 1 || q.wordLimit > 50) {
      errs.wordLimit = "Word limit must be between 1 and 50.";
    }
  }
  return errs;
}

/* ── Type switching: warn only when actual data would be lost ──────────── */

function describeTypeLoss(current: BuilderQuestion, next: MockQuestionType): string[] {
  const out: string[] = [];
  const curNeedsOptions = OPTION_TYPE_SET.has(current.type);
  const nextNeedsOptions = OPTION_TYPE_SET.has(next);
  if (curNeedsOptions && !nextNeedsOptions && nonEmpty(current.options).length > 0) {
    const n = nonEmpty(current.options).length;
    const from = QTYPE_LABEL[current.type];
    const to = QTYPE_LABEL[next];
    if (current.type === "multiple_choice" && !OPTION_TYPE_SET.has(next)) {
      out.push(`Changing from ${from} to ${to} will remove its multiple-choice options.`);
    } else {
      out.push(
        `Changing from ${from} to ${to} will remove its ${n} option${n === 1 ? "" : "s"}.`,
      );
    }
  }
  const curKeys = nonEmpty(current.correctAnswers);
  const nextNeedsKeys = isAutoType(next);
  if (curKeys.length > 0 && !nextNeedsKeys) {
    out.push(
      `Changing from ${QTYPE_LABEL[current.type]} to ${QTYPE_LABEL[next]} will clear its correct answer.`,
    );
  } else if (curKeys.length > 0 && next === "true_false_notgiven") {
    const ok = TFNG_OPTIONS.includes(curKeys[0].trim().toUpperCase() as (typeof TFNG_OPTIONS)[number]);
    if (!ok) {
      out.push(
        `Changing to ${QTYPE_LABEL[next]} will clear its correct answer (not a valid True / False / Not Given value).`,
      );
    }
  } else if (curKeys.length > 0 && next === "yes_no_notgiven") {
    const ok = YNNG_OPTIONS.includes(curKeys[0].trim().toUpperCase() as (typeof YNNG_OPTIONS)[number]);
    if (!ok) {
      out.push(
        `Changing to ${QTYPE_LABEL[next]} will clear its correct answer (not a valid Yes / No / Not Given value).`,
      );
    }
  }
  if (nonEmpty(current.acceptedVariants).length > 0 && !VARIANTS_SET.has(next)) {
    const n = nonEmpty(current.acceptedVariants).length;
    out.push(
      `Changing from ${QTYPE_LABEL[current.type]} to ${QTYPE_LABEL[next]} will remove its ${n} accepted variant${n === 1 ? "" : "s"}.`,
    );
  }
  if (current.wordLimit != null && !WORD_LIMIT_SET.has(next)) {
    out.push(
      `Changing from ${QTYPE_LABEL[current.type]} to ${QTYPE_LABEL[next]} will remove its word limit (≤${current.wordLimit}).`,
    );
  }
  return out;
}

/** Cleaned question for a confirmed type switch (generic fields preserved). */
function buildSwitchedQuestion(current: BuilderQuestion, next: MockQuestionType): BuilderQuestion {
  const wasAuto = isAutoType(current.type);
  const willAuto = isAutoType(next);
  const nextNeedsOptions = OPTION_TYPE_SET.has(next);
  const options = nextNeedsOptions ? current.options : [];
  let correctAnswers = current.correctAnswers;
  if (!willAuto) {
    correctAnswers = [];
  } else if (next === "true_false_notgiven") {
    const first = nonEmpty(current.correctAnswers)[0];
    const up = first?.trim().toUpperCase();
    correctAnswers =
      up && (TFNG_OPTIONS as readonly string[]).includes(up) ? [up] : [];
  } else if (next === "yes_no_notgiven") {
    const first = nonEmpty(current.correctAnswers)[0];
    const up = first?.trim().toUpperCase();
    correctAnswers =
      up && (YNNG_OPTIONS as readonly string[]).includes(up) ? [up] : [];
  } else if (nextNeedsOptions) {
    // Keep only answers that still map to the preserved options, storing the
    // resolved option text so letter-only keys ("B") become explicit.
    const kept = nonEmpty(current.correctAnswers)
      .map((k) => resolveOption(options, k) ?? null)
      .filter((k): k is string => k != null);
    const deduped = [...new Set(kept)];
    if (next === "multiple_choice" || next === "matching" || next === "matching_headings") {
      correctAnswers = deduped.length > 0 ? [deduped[0]] : [];
    } else {
      correctAnswers = deduped;
    }
  }
  return {
    ...current,
    type: next,
    options,
    correctAnswers,
    acceptedVariants: VARIANTS_SET.has(next) ? current.acceptedVariants : [],
    wordLimit: WORD_LIMIT_SET.has(next) ? current.wordLimit : undefined,
    points: wasAuto === willAuto ? current.points : willAuto ? 1 : 9,
  };
}

/* ── Small building blocks (one system, not 15 forms) ─────────────────── */

function OptionRow({
  index,
  value,
  inputId,
  selection,
  onText,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
  inputRef,
}: {
  index: number;
  value: string;
  inputId: string;
  selection: React.ReactNode;
  onText: (v: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const letter = String.fromCharCode(65 + index);
  return (
    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-hover font-mono text-xs font-bold text-fg-muted">
        {letter}
      </span>
      {selection}
      <label htmlFor={inputId} className="sr-only">
        Option {letter}
      </label>
      <Input
        id={inputId}
        ref={inputRef}
        value={value}
        onChange={(e) => onText(e.target.value)}
        placeholder={`Option ${letter}`}
        className="min-w-0 flex-1"
        aria-invalid={value.trim() === "" ? true : undefined}
      />
      <div className="flex shrink-0" role="group" aria-label={`Reorder option ${letter}`}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 sm:h-7 sm:w-7"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          aria-label={`Move option ${letter} up`}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 sm:h-7 sm:w-7"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          aria-label={`Move option ${letter} down`}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 w-8 shrink-0 p-0 text-danger sm:h-7 sm:w-7"
        onClick={onRemove}
        aria-label={`Remove option ${letter}`}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function ChipsEditor({
  values,
  onChange,
  baseId,
  itemLabel,
  addLabel,
  max = 20,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  baseId: string;
  itemLabel: string;
  addLabel: string;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={`${baseId}-${i}`} className="flex items-center gap-2">
          <label htmlFor={`${baseId}-${i}`} className="sr-only">
            {itemLabel} {i + 1}
          </label>
          <Input
            id={`${baseId}-${i}`}
            value={v}
            onChange={(e) => onChange(values.map((x, xi) => (xi === i ? e.target.value : x)))}
            placeholder={itemLabel}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0 text-danger"
            onClick={() => onChange(values.filter((_, xi) => xi !== i))}
            aria-label={`Remove ${itemLabel.toLowerCase()} ${i + 1}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={values.length >= max}
        onClick={() => onChange([...values, ""])}
      >
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </Button>
      {values.length >= max && (
        <p className="text-xs text-fg-muted">Maximum {max} reached.</p>
      )}
    </div>
  );
}

function WordLimitControl({
  value,
  onChange,
  inputId,
  error,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  inputId: string;
  error?: string;
}) {
  const initialMode =
    value == null ? "none" : value === 1 ? "one" : value === 2 ? "two" : value === 3 ? "three" : "custom";
  const [mode, setMode] = React.useState<string>(initialMode);
  const [customText, setCustomText] = React.useState<string>(
    initialMode === "custom" && value != null ? String(value) : "4",
  );
  const [customError, setCustomError] = React.useState<string | undefined>(undefined);

  // Sync local mode when the parent value changes (render-phase adjustment,
  // not an effect — commits before paint, no cascading render).
  const effMode =
    value == null ? "none" : value === 1 ? "one" : value === 2 ? "two" : value === 3 ? "three" : "custom";
  const [prevValue, setPrevValue] = React.useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setMode(effMode);
    if (effMode === "custom" && value != null) setCustomText(String(value));
  }

  function pick(next: string) {
    setMode(next);
    setCustomError(undefined);
    if (next === "none") onChange(undefined);
    else if (next === "one") onChange(1);
    else if (next === "two") onChange(2);
    else if (next === "three") onChange(3);
    else {
      // Stay on a representable value: keep the current limit as custom text,
      // or start at 4 when there is no limit yet.
      if (value != null) {
        setCustomText(String(value));
      } else {
        setCustomText("4");
        onChange(4);
      }
    }
  }

  return (
    <div className="space-y-2">
      <Select value={mode} onValueChange={pick}>
        <SelectTrigger id={`${inputId}-mode`} aria-label="Word limit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No limit</SelectItem>
          <SelectItem value="one">One word</SelectItem>
          <SelectItem value="two">No more than 2 words</SelectItem>
          <SelectItem value="three">No more than 3 words</SelectItem>
          <SelectItem value="custom">Custom (1–50)</SelectItem>
        </SelectContent>
      </Select>
      {mode === "custom" && (
        <div>
          <label htmlFor={inputId} className="sr-only">
            Custom word limit (1–50)
          </label>
          <Input
            id={inputId}
            type="number"
            min={1}
            max={50}
            value={customText}
            onChange={(e) => {
              setCustomText(e.target.value);
              if (e.target.value === "") {
                setCustomError("Enter a number from 1 to 50, or pick No limit.");
                return;
              }
              const n = Number(e.target.value);
              if (!Number.isInteger(n) || n < 1 || n > 50) {
                setCustomError("Word limit must be between 1 and 50.");
                return;
              }
              setCustomError(undefined);
              onChange(n);
            }}
            aria-invalid={customError || error ? true : undefined}
          />
          {(customError || error) && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {customError ?? error}
            </p>
          )}
        </div>
      )}
      {mode !== "custom" && error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-fg-muted">
        Backend counts hyphenated words as one. This is a hard limit — over-limit answers score 0.
      </p>
    </div>
  );
}

/** Mini student-facing preview (mirrors mock-runner controls, never the key). */
function QuestionPreview({ question }: { question: BuilderQuestion }) {
  const kind = kindOf(question.type);
  const prompt = question.prompt.trim() || "(empty question)";
  const badge = (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">
      {question.number}
    </span>
  );
  const pillClass = (active: boolean) =>
    cn(
      "rounded-[8px] border px-3 py-1.5 text-sm",
      active
        ? "border-brand bg-brand-subtle font-medium text-brand-subtle-fg"
        : "border-border bg-surface text-fg-muted",
    );

  if (kind === "choice-single" || kind === "tfng" || kind === "ynng" || kind === "matching" || kind === "headings") {
    let opts = question.options.filter((o) => o.trim() !== "");
    if (opts.length === 0 && question.type === "true_false_notgiven") opts = [...TFNG_OPTIONS];
    if (opts.length === 0 && question.type === "yes_no_notgiven") opts = [...YNNG_OPTIONS];
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          {badge}
          <p className="whitespace-pre-line text-sm text-fg">{prompt}</p>
        </div>
        {opts.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Student answer preview">
            {opts.map((opt) => (
              <button key={opt} type="button" disabled className={pillClass(false)}>
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No options yet — add matches above.</p>
        )}
      </div>
    );
  }
  if (kind === "choice-multi") {
    const opts = question.options.filter((o) => o.trim() !== "");
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          {badge}
          <p className="whitespace-pre-line text-sm text-fg">{prompt}</p>
        </div>
        {opts.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Student answer preview (multiple)">
            {opts.map((opt) => (
              <button key={opt} type="button" disabled className={pillClass(false)}>
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">No options yet — add options above.</p>
        )}
        <p className="text-[11px] text-fg-subtle">Students can select more than one answer.</p>
      </div>
    );
  }
  if (kind === "completion" || kind === "short" || kind === "map") {
    return (
      <div className="flex items-center gap-2">
        {badge}
        <div className="min-w-0 flex-1">
          <p className="mb-1 whitespace-pre-line text-sm text-fg">{prompt}</p>
          <Input value="" placeholder="…" disabled aria-label="Student answer preview" />
        </div>
      </div>
    );
  }
  if (kind === "essay") {
    const min = question.points === 9 ? (question.type === "essay_task1" ? 150 : 250) : null;
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          {badge}
          <p className="whitespace-pre-line text-sm text-fg">{prompt}</p>
        </div>
        <Textarea value="" placeholder="…" disabled className="min-h-24" aria-label="Student essay preview" />
        <p className="text-right text-xs tabular-nums text-fg-subtle">0 words {min != null && `· min ${min}`}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        {badge}
        <p className="whitespace-pre-line text-sm text-fg">{prompt}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-[8px] border bg-bg-subtle p-3">
        <Button type="button" size="sm" variant="outline" disabled>
          <Mic className="size-4" aria-hidden />
          Record
        </Button>
        <span className="text-xs text-fg-subtle">Student records an audio answer here.</span>
      </div>
    </div>
  );
}

/* ── Reusable field set (inline editor + Task 7 drawer share this) ────────
 * Prompt textarea + per-kind answer branches + wordLimit/points controls.
 * Excludes card chrome, header row, number/type switching UI, and preview —
 * those stay in QuestionEditor. Drawer edits content/keys only.
 */
export function QuestionFieldSet(props: {
  question: BuilderQuestion;
  skill: MockSkill;
  allowedTypes: MockQuestionType[];
  onChange: (q: BuilderQuestion) => void;
}): JSX.Element {
  // allowedTypes is accepted (same call shape as QuestionEditor) but unused:
  // number/type switching UI stays out of the drawer set.
  const { question, skill, onChange } = props;
  const t = useTranslations("wizard");

  const kind = kindOf(question.type);
  const manual = !isAutoType(question.type);
  const errors = getQuestionFieldErrors(question, skill);

  const optionRefs = React.useRef<Array<HTMLInputElement | null>>([]);

  const ids = {
    number: `qe-${question.clientId}-number`,
    type: `qe-${question.clientId}-type`,
    prompt: `qe-${question.clientId}-prompt`,
    points: `qe-${question.clientId}-points`,
    wordLimit: `qe-${question.clientId}-wordlimit`,
  };

  function focusOption(index: number): void {
    window.setTimeout(() => optionRefs.current[index]?.focus(), 0);
  }

  function editOption(index: number, text: string): void {
    const old = question.options[index] ?? "";
    const next = question.options.map((o, i) => (i === index ? text : o));
    let correct = question.correctAnswers;
    // Migrate legacy letter-only keys ("B") that resolve to the edited row.
    if (old !== text) {
      const oldResolved = resolveOption(question.options, old) ?? old;
      const textTrim = text.trim();
      correct = correct.map((c) => {
        const res = resolveOption(question.options, c);
        if (res === old || (oldResolved && res === oldResolved) || c === old) return textTrim ? text : c;
        // Bare letter pointing to this index
        if (/^[A-Z]$/.test(c.trim().toUpperCase())) {
          const idx = c.trim().toUpperCase().charCodeAt(0) - 65;
          if (idx === index) return text;
        }
        return c;
      });
    }
    onChange({ ...question, options: next, correctAnswers: correct });
  }

  function moveOption(index: number, dir: -1 | 1): void {
    const j = index + dir;
    if (j < 0 || j >= question.options.length) return;
    const next = [...question.options];
    [next[index], next[j]] = [next[j], next[index]];
    onChange({ ...question, options: next });
    focusOption(j);
  }

  function removeOption(index: number): void {
    const removed = question.options[index];
    const next = question.options.filter((_, i) => i !== index);
    const correct = question.correctAnswers.filter((c) => {
      const res = resolveOption(question.options, c);
      if (res === removed) return false;
      if (c === removed) return false;
      // Also drop bare letters that pointed to removed index or shift beyond
      if (/^[A-Z]$/.test(c.trim().toUpperCase())) {
        const idx = c.trim().toUpperCase().charCodeAt(0) - 65;
        if (idx === index) return false;
      }
      return true;
    });
    onChange({ ...question, options: next, correctAnswers: correct });
    if (next.length > 0) focusOption(Math.min(index, next.length - 1));
  }

  function addOption(): void {
    if (question.options.length >= 26) return;
    const idx = question.options.length;
    onChange({ ...question, options: [...question.options, ""] });
    focusOption(idx);
  }

  const showWordLimit = WORD_LIMIT_SET.has(question.type);
  const showPoints = !manual;

  const singleSelected = nonEmpty(question.correctAnswers)[0] ?? "";
  const singleResolved = singleSelected ? resolveOption(question.options, singleSelected) : null;
  const mappingResolved = singleSelected ? resolveOption(question.options, singleSelected) : null;

  return (
    <>
      {/* Content */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Content</p>
        <Field
          label={
            kind === "tfng" || kind === "ynng"
              ? "Statement"
              : kind === "matching"
                ? "Item"
                : kind === "headings"
                  ? "Statement"
                  : kind === "map"
                    ? "Label prompt"
                    : t("prompt")
          }
          htmlFor={ids.prompt}
          error={errors.prompt}
        >
          <Textarea
            id={ids.prompt}
            value={question.prompt}
            onChange={(e) => onChange({ ...question, prompt: e.target.value })}
            className="min-h-20"
            aria-invalid={errors.prompt ? true : undefined}
          />
        </Field>
      </div>

      {/* Answer / configuration (only the selected type renders) */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Answer
        </p>

        {kind === "choice-single" && (
          <Field
            label={t("options")}
            hint="Students pick one. Mark the correct option — no typing needed."
            error={errors.options}
          >
            <div className="space-y-2" role="radiogroup" aria-label="Options — pick the correct one">
              {question.options.map((o, i) => {
                const oid = `qe-${question.clientId}-opt-${i}`;
                const checked = singleResolved === o || (!singleResolved && singleSelected === o);
                return (
                  <OptionRow
                    key={`${question.clientId}-opt-${i}`}
                    index={i}
                    value={o}
                    inputId={oid}
                    canMoveUp={i > 0}
                    canMoveDown={i < question.options.length - 1}
                    onText={(v) => editOption(i, v)}
                    onMove={(d) => moveOption(i, d)}
                    onRemove={() => removeOption(i)}
                    inputRef={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    selection={
                      <input
                        type="radio"
                        name={`qe-${question.clientId}-correct`}
                        checked={checked}
                        onChange={() => onChange({ ...question, correctAnswers: o.trim() ? [o] : [] })}
                        aria-label={`Mark option ${String.fromCharCode(65 + i)} correct`}
                        className="size-4 shrink-0 accent-[var(--color-brand,#89F336)]"
                      />
                    }
                  />
                );
              })}
            </div>
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={question.options.length >= 26}
                onClick={addOption}
              >
                <Plus className="size-4" aria-hidden />
                Add option
              </Button>
            </div>
            {errors.correct && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {errors.correct}
              </p>
            )}
          </Field>
        )}

        {kind === "choice-multi" && (
          <Field
            label={t("options")}
            hint="Students can select more than one. Tick every correct option."
            error={errors.options}
          >
            <div className="space-y-2" role="group" aria-label="Options — tick all correct answers">
              {question.options.map((o, i) => {
                const oid = `qe-${question.clientId}-opt-${i}`;
                const isChecked = question.correctAnswers.some((c) => {
                  const res = resolveOption(question.options, c);
                  return res === o || c === o;
                });
                return (
                  <OptionRow
                    key={`${question.clientId}-opt-${i}`}
                    index={i}
                    value={o}
                    inputId={oid}
                    canMoveUp={i > 0}
                    canMoveDown={i < question.options.length - 1}
                    onText={(v) => editOption(i, v)}
                    onMove={(d) => moveOption(i, d)}
                    onRemove={() => removeOption(i)}
                    inputRef={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    selection={
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const next = isChecked
                            ? question.correctAnswers.filter((c) => {
                                const res = resolveOption(question.options, c);
                                return res !== o && c !== o;
                              })
                            : [...question.correctAnswers, o];
                          onChange({ ...question, correctAnswers: next });
                        }}
                        aria-label={`Mark option ${String.fromCharCode(65 + i)} correct`}
                        className="size-4 shrink-0 accent-[var(--color-brand,#89F336)]"
                      />
                    }
                  />
                );
              })}
            </div>
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={question.options.length >= 26}
                onClick={addOption}
              >
                <Plus className="size-4" aria-hidden />
                Add option
              </Button>
            </div>
            {errors.correct && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {errors.correct}
              </p>
            )}
          </Field>
        )}

        {kind === "tfng" && (
          <Field label="Correct answer" error={errors.correct}>
            <div className="grid grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap" role="radiogroup" aria-label="Correct answer">
              {TFNG_OPTIONS.map((opt) => {
                const checked = nonEmpty(question.correctAnswers)[0]?.trim().toUpperCase() === opt;
                return (
                  <label
                    key={opt}
                    className={cn(
                      "min-h-[40px] cursor-pointer rounded-[8px] border px-4 py-2 text-center text-sm transition-colors sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-left",
                      checked
                        ? "border-brand bg-brand-subtle font-medium text-brand-subtle-fg"
                        : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                    )}
                  >
                    <input
                      type="radio"
                      name={`qe-${question.clientId}-tfng`}
                      value={opt}
                      checked={checked}
                      onChange={() => onChange({ ...question, correctAnswers: [opt] })}
                      className="sr-only"
                    />
                    {opt.charAt(0) + opt.slice(1).toLowerCase().replace("ot given", "ot Given")}
                  </label>
                );
              })}
            </div>
          </Field>
        )}

        {kind === "ynng" && (
          <Field label="Correct answer" error={errors.correct}>
            <div className="grid grid-cols-1 gap-2 min-[420px]:flex min-[420px]:flex-wrap" role="radiogroup" aria-label="Correct answer">
              {YNNG_OPTIONS.map((opt) => {
                const checked = nonEmpty(question.correctAnswers)[0]?.trim().toUpperCase() === opt;
                return (
                  <label
                    key={opt}
                    className={cn(
                      "min-h-[40px] cursor-pointer rounded-[8px] border px-4 py-2 text-center text-sm transition-colors sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-left",
                      checked
                        ? "border-brand bg-brand-subtle font-medium text-brand-subtle-fg"
                        : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                    )}
                  >
                    <input
                      type="radio"
                      name={`qe-${question.clientId}-ynng`}
                      value={opt}
                      checked={checked}
                      onChange={() => onChange({ ...question, correctAnswers: [opt] })}
                      className="sr-only"
                    />
                    {opt.charAt(0) + opt.slice(1).toLowerCase().replace("ot given", "ot Given")}
                  </label>
                );
              })}
            </div>
          </Field>
        )}

        {(kind === "matching" || kind === "headings") && (
          <div className="space-y-3">
            <Field
              label={kind === "matching" ? "Available matches" : "Heading options"}
              hint={
                kind === "matching"
                  ? "The choices students pick from (at least 2)."
                  : "The headings students choose from (at least 2)."
              }
              error={errors.options}
            >
              <div className="space-y-2">
                {question.options.map((o, i) => {
                  const oid = `qe-${question.clientId}-match-${i}`;
                  return (
                    <OptionRow
                      key={`${question.clientId}-match-${i}`}
                      index={i}
                      value={o}
                      inputId={oid}
                      canMoveUp={i > 0}
                      canMoveDown={i < question.options.length - 1}
                      onText={(v) => editOption(i, v)}
                      onMove={(d) => moveOption(i, d)}
                      onRemove={() => removeOption(i)}
                      inputRef={(el) => {
                        optionRefs.current[i] = el;
                      }}
                      selection={<span className="w-4 shrink-0" aria-hidden />}
                    />
                  );
                })}
              </div>
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={question.options.length >= 26}
                  onClick={addOption}
                >
                  <Plus className="size-4" aria-hidden />
                  {kind === "matching" ? "Add match" : "Add heading"}
                </Button>
              </div>
            </Field>
            <Field
              label={correctLabel(question.type)}
              hint="Pick which match answers this item."
              error={errors.correct}
            >
              <Select
                value={mappingResolved ?? ""}
                onValueChange={(v) => onChange({ ...question, correctAnswers: [v] })}
              >
                <SelectTrigger
                  id={`qe-${question.clientId}-mapping`}
                  aria-label={correctLabel(question.type)}
                  aria-invalid={errors.correct ? true : undefined}
                >
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {question.options
                    .filter((o) => o.trim() !== "")
                    .map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {mappingResolved && question.prompt.trim() && (
                <p className="mt-1.5 rounded-[8px] border border-border bg-surface-hover px-2.5 py-1.5 text-sm text-fg">
                  <span className="line-clamp-1 font-medium">{question.prompt.trim()}</span>
                  <span aria-hidden className="mx-1.5 text-fg-subtle">
                    →
                  </span>
                  <span className="font-medium">{mappingResolved}</span>
                </p>
              )}
            </Field>
            <Field
              label="Spelling variants (optional)"
              hint="Extra accepted spellings for the mapped answer."
            >
              <ChipsEditor
                values={question.acceptedVariants}
                onChange={(next) => onChange({ ...question, acceptedVariants: next })}
                baseId={`qe-${question.clientId}-variants`}
                itemLabel="Variant"
                addLabel="Add variant"
              />
            </Field>
          </div>
        )}

        {(kind === "completion" || kind === "short") && (
          <div className="space-y-3">
            <Field
              label={correctLabel(question.type)}
              hint="One per row. Students type any of these."
              error={errors.correct}
            >
              <ChipsEditor
                values={question.correctAnswers}
                onChange={(next) => onChange({ ...question, correctAnswers: next })}
                baseId={`qe-${question.clientId}-correct`}
                itemLabel="Accepted answer"
                addLabel="Add accepted answer"
              />
            </Field>
            <Field
              label="Spelling variants (optional)"
              hint="e.g. colour / color — accepted in addition to the answers above."
            >
              <ChipsEditor
                values={question.acceptedVariants}
                onChange={(next) => onChange({ ...question, acceptedVariants: next })}
                baseId={`qe-${question.clientId}-variants`}
                itemLabel="Variant"
                addLabel="Add variant"
              />
            </Field>
            <Field label="Word limit" error={WORD_LIMIT_SET.has(question.type) ? errors.wordLimit : undefined}>
              <WordLimitControl
                value={question.wordLimit}
                onChange={(next) => onChange({ ...question, wordLimit: next })}
                inputId={ids.wordLimit}
                error={errors.wordLimit}
              />
            </Field>
            <p className="text-xs text-fg-muted">Student types an answer here.</p>
          </div>
        )}

        {kind === "map" && (
          <div className="space-y-3">
            <div className="rounded-[8px] border border-border bg-surface-hover p-2.5 text-xs text-fg-muted">
              Map / diagram image is managed at block level (Diagram / image section above). The
              answer below labels this point on that image.
            </div>
            <Field
              label={correctLabel(question.type)}
              hint="Accepted names for this label — one per row."
              error={errors.correct}
            >
              <ChipsEditor
                values={question.correctAnswers}
                onChange={(next) => onChange({ ...question, correctAnswers: next })}
                baseId={`qe-${question.clientId}-correct`}
                itemLabel="Accepted label"
                addLabel="Add accepted label"
              />
            </Field>
            <Field
              label="Spelling variants (optional)"
              hint="Extra accepted spellings for this label."
            >
              <ChipsEditor
                values={question.acceptedVariants}
                onChange={(next) => onChange({ ...question, acceptedVariants: next })}
                baseId={`qe-${question.clientId}-variants`}
                itemLabel="Variant"
                addLabel="Add variant"
              />
            </Field>
            <p className="text-xs text-fg-muted">Student types an answer here.</p>
          </div>
        )}

        {kind === "essay" && (
          <div className="rounded-[8px] border border-brand/25 bg-brand-subtle/40 p-3 text-sm">
            <p className="font-semibold text-fg">Teacher graded</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              No answer key — raw score 0–{question.points}. Follow the versioned task instructions for word targets.
            </p>
          </div>
        )}

        {kind === "speaking" && (
          <div className="rounded-[8px] border border-brand/25 bg-brand-subtle/40 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-fg">
              <Mic className="size-4" aria-hidden /> Teacher graded
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Students record audio. No answer key — raw score 0–{question.points}.
            </p>
          </div>
        )}

        {/* Stored word limit on a type that no longer uses it: surface, don't strand. */}
        {!showWordLimit && question.wordLimit != null && (
          <Field label="Word limit">
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-border p-2.5 text-sm">
              <span className="text-fg-muted">
                Stored limit ≤{question.wordLimit} — this type does not use word limits.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => onChange({ ...question, wordLimit: undefined })}
              >
                Remove limit
              </Button>
            </div>
          </Field>
        )}

        {showPoints && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("points")} htmlFor={ids.points} error={errors.points}>
              <Input
                id={ids.points}
                type="number"
                min={1}
                max={20}
                value={question.points}
                aria-invalid={errors.points ? true : undefined}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange({ ...question, points: Number.isFinite(v) ? Math.trunc(v) : question.points });
                }}
              />
            </Field>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Main editor ───────────────────────────────────────────────────────── */

export function QuestionEditor(props: {
  question: BuilderQuestion;
  skill: MockSkill;
  allowedTypes: MockQuestionType[];
  onChange: (q: BuilderQuestion) => void;
  onRemove: () => void;
}): JSX.Element {
  const { question, skill, allowedTypes, onChange, onRemove } = props;
  const t = useTranslations("wizard");
  const tc = useTranslations("common");

  const allowed = new Set<MockQuestionType>(allowedTypes);
  const errors = getQuestionFieldErrors(question, skill);

  const [pendingType, setPendingType] = React.useState<MockQuestionType | null>(null);
  const [pendingLosses, setPendingLosses] = React.useState<string[]>([]);
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (pendingType) confirmRef.current?.focus();
  }, [pendingType]);

  const ids = {
    number: `qe-${question.clientId}-number`,
    type: `qe-${question.clientId}-type`,
    prompt: `qe-${question.clientId}-prompt`,
    points: `qe-${question.clientId}-points`,
    wordLimit: `qe-${question.clientId}-wordlimit`,
  };

  function requestTypeChange(next: MockQuestionType): void {
    if (next === question.type) return;
    const losses = describeTypeLoss(question, next);
    if (losses.length === 0) {
      onChange(buildSwitchedQuestion(question, next));
      return;
    }
    setPendingType(next);
    setPendingLosses(losses);
  }

  function confirmTypeChange(): void {
    if (!pendingType) return;
    onChange(buildSwitchedQuestion(question, pendingType));
    setPendingType(null);
    setPendingLosses([]);
    document.getElementById(ids.type)?.focus();
  }

  function cancelTypeChange(): void {
    setPendingType(null);
    setPendingLosses([]);
    document.getElementById(ids.type)?.focus();
  }

  return (
    <div className="min-w-0 space-y-3 rounded-[8px] border border-border bg-surface p-3 sm:p-4">
      {/* Question + Type */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-sm font-medium text-fg tabular-nums">#{question.number}</span>
          <span className="max-w-full truncate rounded-[6px] border border-border bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted">
            {QTYPE_LABEL[question.type]}
          </span>
          {question.savedQuestionId ? (
            <span className="shrink-0 rounded-[6px] border border-border bg-surface-hover px-1.5 py-0.5 text-[11px] text-fg-muted">
              saved
            </span>
          ) : null}
        </div>
        <Button type="button" variant="danger" size="sm" onClick={onRemove} className="min-h-8 shrink-0">
          {tc("delete")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("questionNumber")} htmlFor={ids.number} error={errors.number}>
          <Input
            id={ids.number}
            type="number"
            min={1}
            max={200}
            value={question.number}
            aria-invalid={errors.number ? true : undefined}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange({ ...question, number: Number.isFinite(v) ? Math.trunc(v) : question.number });
            }}
          />
        </Field>
        <Field label={t("questionType")} htmlFor={ids.type}>
          <Select value={question.type} onValueChange={(v) => requestTypeChange(v as MockQuestionType)}>
            <SelectTrigger id={ids.type}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPED_TYPES.map((g) => {
                const types = g.types.filter((qt) => allowed.has(qt) || qt === question.type);
                if (types.length === 0) return null;
                return (
                  <SelectGroup key={g.group}>
                    <SelectLabel>{g.group}</SelectLabel>
                    {types.map((qt) => (
                      <SelectItem key={qt} value={qt}>
                        {QTYPE_LABEL[qt]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {pendingType && (
        <div
          role="alertdialog"
          aria-labelledby={`qe-${question.clientId}-switch-title`}
          aria-describedby={`qe-${question.clientId}-switch-desc`}
          className="space-y-2 rounded-[8px] border border-warning/40 bg-warning/5 p-3"
        >
          <p id={`qe-${question.clientId}-switch-title`} className="text-sm font-semibold text-fg">
            Change question type to {QTYPE_LABEL[pendingType]}?
          </p>
          <ul id={`qe-${question.clientId}-switch-desc`} className="list-disc space-y-0.5 pl-4 text-sm text-fg-muted">
            {pendingLosses.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={cancelTypeChange}>
              Cancel
            </Button>
            <Button ref={confirmRef} type="button" size="sm" onClick={confirmTypeChange}>
              Continue
            </Button>
          </div>
        </div>
      )}

      <QuestionFieldSet
        question={question}
        skill={skill}
        allowedTypes={allowedTypes}
        onChange={onChange}
      />

      {/* Preview (always the student control, never the key) */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Preview</p>
        <div className="rounded-[8px] border border-border bg-surface-hover p-3">
          <QuestionPreview question={question} />
        </div>
      </div>
    </div>
  );
}
