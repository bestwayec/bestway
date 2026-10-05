import { sanitizeGappedContent } from "@/components/mock/gapped-content";
import { usedMatchingOptions } from "@/lib/objective-question";
import type { PreviewGroup, PreviewQuestion } from "./StudentPreview";
import { clusterReadingPassages } from "./reading-passage-clusters";

/**
 * UI-only presentation model for the whole-exam Reading preview.
 *
 * Persisted model (never changed here): one backend question group IS one
 * Reading passage — it owns passageText, title, image, instructions and ALL
 * its questions. Consecutive same-type runs inside it are visual task groups.
 *
 * Panel rule (absolute): the left panel shows passage source content only;
 * the right panel shows every question, task instruction and answer control.
 * `passageText` is the source reading passage and always belongs on the left.
 * `contentHtml` documents (notes, summaries, tables, gap-fill content) are
 * question-task content and always belong on the right. `contentHtml` never
 * replaces or hides `passageText`, and interactive gap inputs are rendered
 * only on the right.
 *
 * Three presentation problems are solved here without touching persisted data:
 *
 * 1. Imports may repeat the same passageText across consecutive groups (one
 *    task per group). Those continuations are clustered into ONE display
 *    passage by identical passage text. Genuinely separate passages have
 *    different passage text and are never merged. Passages are never derived
 *    from question type, range, or instructions.
 * 2. Within one display passage, contiguous runs (same question type and same
 *    task instructions) become visual task blocks headed "Questions X–Y".
 *    Original order and numbers are preserved; nothing is renumbered. A
 *    question rendered inside a gap-fill document is excluded from the
 *    generic control loop, so every question and every input appears exactly
 *    once.
 * 3. Legacy `contentHtml` without gap tokens carries no inputs or question
 *    mapping, so it is separated out as static markup (`staticDocs`) instead
 *    of being treated as an interactive task document.
 */

export interface PreviewBlockDoc {
  groupId: string;
  contentHtml: string;
  /** Run questions from this group, mapped to gap tokens by number. */
  questions: PreviewQuestion[];
}

export interface PreviewTaskBlock {
  key: string;
  type: string;
  instructions: string | null;
  /** Questions rendered as generic controls in the right panel. */
  questions: PreviewQuestion[];
  /** Gap-fill task documents rendered in the right panel, in order. */
  docs: PreviewBlockDoc[];
  /** Original banks remain separate when consecutive tasks are displayed together. */
  matchingGroups: Array<Pick<PreviewGroup, "id" | "questions" | "optionsReusable">>;
  min: number;
  max: number;
  heading: string;
}

/** Gap-free rich markup: static content with no inputs and no question mapping. */
export interface PreviewStaticDoc {
  groupId: string;
  staticHtml: string;
}

export interface DisplayPassage {
  key: string;
  /** 1-based ordinal among display passages in the section. */
  ordinal: number;
  title: string | null;
  passageText: string | null;
  imageUrl: string | null;
  hasAudio: boolean;
  audioGroupId: string | null;
  imageGroupId: string | null;
  staticDocs: PreviewStaticDoc[];
  blocks: PreviewTaskBlock[];
  /** Every question of the passage in stored order (drives nav + range). */
  questions: PreviewQuestion[];
  min: number | null;
  max: number | null;
  /** "1–13" over all questions of the passage, or null when empty. */
  rangeLabel: string | null;
}

/** UI-only separation of a rich document into interactive vs static content. */
export interface PreviewDocumentSplit {
  /** True when the document carries interactive gap tokens. */
  hasGaps: boolean;
  /**
   * Sanitized markup with gap tokens replaced by inert blanks (no question
   * numbers, no inputs). Null when nothing readable remains.
   */
  staticHtml: string | null;
}

const GAP_TOKEN_PATTERN = '<span\\s+data-gap="(\\d{1,3})"\\s*>\\s*</span>';

function normText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function taskBlockHeading(min: number, max: number): string {
  return min === max ? `Question ${min}` : `Questions ${min}–${max}`;
}

/** Gap numbers present in a rich document, in document order. */
export function gapNumbersIn(contentHtml: string): number[] {
  const numbers: number[] = [];
  const re = new RegExp(GAP_TOKEN_PATTERN, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(contentHtml)) !== null) {
    numbers.push(Number(match[1]));
  }
  return numbers;
}

/**
 * UI-only presentation adapter: separates interactive question-task content
 * (gap tokens, rendered on the right) from static markup. Never saved,
 * never sent anywhere; the stored document is untouched.
 */
export function splitPreviewDocument(
  contentHtml: string | null | undefined,
): PreviewDocumentSplit {
  if (!contentHtml?.trim()) return { hasGaps: false, staticHtml: null };
  const hasGaps = new RegExp(GAP_TOKEN_PATTERN).test(contentHtml);
  const withBlanks = contentHtml.replace(
    new RegExp(GAP_TOKEN_PATTERN, "g"),
    " ________ ",
  );
  const staticHtml = sanitizeGappedContent(withBlanks);
  const visibleText = staticHtml
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|#160);/g, "")
    .replace(/_+/g, "")
    .trim();
  return { hasGaps, staticHtml: visibleText ? staticHtml : null };
}

interface RunAcc {
  key: string;
  type: string;
  instructions: string | null;
  gapped: boolean;
  questions: PreviewQuestion[];
  docs: PreviewBlockDoc[];
  matchingGroups: PreviewTaskBlock["matchingGroups"];
  min: number;
  max: number;
}

function toBlock(run: RunAcc): PreviewTaskBlock {
  return {
    key: run.key,
    type: run.type,
    instructions: run.instructions,
    questions: run.gapped ? [] : run.questions,
    docs: run.docs,
    matchingGroups: run.matchingGroups,
    min: run.min,
    max: run.max,
    heading: taskBlockHeading(run.min, run.max),
  };
}

/** Resolve reuse against the persisted group, including siblings in other task blocks. */
export function unavailablePreviewOptions(
  block: PreviewTaskBlock,
  answers: Record<string, string>,
  questionId: string,
): string[] {
  const group = block.matchingGroups.find((g) => g.questions.some((q) => q.id === questionId));
  return group?.optionsReusable === false ? usedMatchingOptions(group.questions, answers, questionId) : [];
}

function includeMatchingGroup(run: RunAcc, group: PreviewGroup): void {
  if (!run.matchingGroups.some((g) => g.id === group.id)) {
    run.matchingGroups.push({ id: group.id, optionsReusable: group.optionsReusable, questions: group.questions });
  }
}

function docFor(run: RunAcc, g: PreviewGroup): PreviewBlockDoc {
  const existing = run.docs.find((d) => d.groupId === g.id);
  if (existing) return existing;
  const doc: PreviewBlockDoc = { groupId: g.id, contentHtml: g.contentHtml!, questions: [] };
  run.docs.push(doc);
  return doc;
}

function buildBlocks(groups: PreviewGroup[]): {
  blocks: PreviewTaskBlock[];
  questions: PreviewQuestion[];
} {
  const blocks: PreviewTaskBlock[] = [];
  const questions: PreviewQuestion[] = [];
  let run: RunAcc | null = null;

  for (const g of groups) {
    const split = splitPreviewDocument(g.contentHtml);
    const gapped = split.hasGaps;
    const instructions = g.instructions ?? null;
    if (g.questions.length === 0 && gapped && g.contentHtml) {
      // Degenerate but possible: a gap document with no question rows yet.
      // Keep the document visible (right panel) instead of dropping it.
      const numbers = gapNumbersIn(g.contentHtml);
      if (numbers.length > 0) {
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        blocks.push({
          key: `${g.id}:gaps`,
          type: "",
          instructions,
          questions: [],
          docs: [{ groupId: g.id, contentHtml: g.contentHtml, questions: [] }],
          matchingGroups: [],
          min,
          max,
          heading: taskBlockHeading(min, max),
        });
      }
      continue;
    }
    for (const q of g.questions) {
      questions.push(q);
      const current = run;
      const same =
        current !== null &&
        current.type === q.type &&
        current.gapped === gapped &&
        normText(current.instructions) === normText(instructions);
      if (current !== null && same) {
        includeMatchingGroup(current, g);
        if (gapped) docFor(current, g).questions.push(q);
        else current.questions.push(q);
        current.min = Math.min(current.min, q.number);
        current.max = Math.max(current.max, q.number);
      } else {
        if (run) blocks.push(toBlock(run));
        const started: RunAcc = {
          key: `${g.id}:${q.type}:${q.number}`,
          type: q.type,
          instructions,
          gapped,
          questions: [],
          docs: [],
          matchingGroups: [],
          min: q.number,
          max: q.number,
        };
        run = started;
        includeMatchingGroup(started, g);
        if (gapped) docFor(started, g).questions.push(q);
        else started.questions.push(q);
      }
    }
  }
  if (run) blocks.push(toBlock(run));
  return { blocks, questions };
}

/**
 * Cluster consecutive groups that repeat the same passage text into one
 * display passage. Order is preserved; question numbers are never changed.
 */
export function clusterDisplayPassages(groups: PreviewGroup[]): DisplayPassage[] {
  const clusters = clusterReadingPassages(groups).map((passage) => passage.groups);

  return clusters.map((members, index) => {
    const first = members[0];
    const title = members.map((m) => m.title?.trim()).find((v) => v) ?? null;
    const passageText = members.map((m) => m.passageText).find((v) => v?.trim()) ?? null;
    const imageMember = members.find((m) => m.imageUrl);
    const audioMember = members.find((m) => m.hasAudio);
    const staticDocs: PreviewStaticDoc[] = [];
    for (const m of members) {
      const split = splitPreviewDocument(m.contentHtml);
      if (!split.hasGaps && split.staticHtml) {
        staticDocs.push({ groupId: m.id, staticHtml: split.staticHtml });
      }
    }
    const { blocks, questions } = buildBlocks(members);
    const numbers = questions.map((q) => q.number);
    const min = numbers.length ? Math.min(...numbers) : null;
    const max = numbers.length ? Math.max(...numbers) : null;
    return {
      key: first.id,
      ordinal: index + 1,
      title,
      passageText,
      imageUrl: imageMember?.imageUrl ?? null,
      hasAudio: !!audioMember,
      audioGroupId: audioMember?.id ?? null,
      imageGroupId: imageMember?.id ?? null,
      staticDocs,
      blocks,
      questions,
      min,
      max,
      rangeLabel: min == null || max == null ? null : min === max ? `${min}` : `${min}–${max}`,
    };
  });
}
