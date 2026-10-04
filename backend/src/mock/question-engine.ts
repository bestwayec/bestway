import { MockQuestionType } from '@prisma/client';

/** Interaction metadata reuses the production question/scoring primitives. */
export const ANSWER_RULES = ['ONE_WORD', 'ONE_WORD_AND_OR_NUMBER'] as const;
export type AnswerRule = (typeof ANSWER_RULES)[number];
export const MATCHING_LAYOUTS = ['headings', 'speakers', 'short_texts', 'paragraphs'] as const;
export const TEXT_QUESTION_TYPES = ['short_answer', 'sentence_completion', 'note_completion', 'summary_completion', 'table_completion'] as const;
export const CHOICE_QUESTION_TYPES = ['multiple_choice', 'matching', 'matching_headings'] as const;
export const MANUAL_QUESTION_TYPES = ['essay_task1', 'essay_task2', 'speaking_task'] as const;

export function strictAnswerText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
}

/** Display labels remain NOT GIVEN; all decision aliases map to one internal value. */
export function canonicalDecision(value: string): string {
  const token = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ['NOT_GIVEN', 'NO_INFORMATION'].includes(token) ? 'NOT_GIVEN' : token;
}

export function respectsAnswerRule(value: string, rule: AnswerRule): boolean {
  const tokens = strictAnswerText(value).split(' ').filter(Boolean);
  const numeric = tokens.filter((token) => /^\d+(?:[.,]\d+)?$/.test(token)).length;
  const words = tokens.length - numeric;
  return rule === 'ONE_WORD'
    ? tokens.length === 1 && words === 1
    : tokens.length > 0 && words <= 1 && numeric <= 1;
}

/** Accept both the legacy option-text wire and canonical import letter keys. */
export function choiceIndex(value: string, options: readonly string[]): number | null {
  const normalized = strictAnswerText(value);
  const literal = options.findIndex((option) => strictAnswerText(option) === normalized);
  if (literal >= 0) return literal;
  if (/^[a-z]$/.test(normalized)) {
    const index = normalized.charCodeAt(0) - 97;
    if (index < options.length) return index;
  }
  return null;
}

export interface ObjectiveQuestionInput {
  type: MockQuestionType | string;
  prompt?: string;
  options?: unknown;
  correctAnswers?: unknown;
  acceptedVariants?: unknown;
  wordLimit?: number | null;
  answerRule?: string | null;
}

const stringArray = (value: unknown): string[] => Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : [];

/** Complete content is required only at publication; drafts retain structural checks. */
export function objectiveQuestionIssues(q: ObjectiveQuestionInput, isAuto: boolean, complete = true): string[] {
  const issues: string[] = [];
  const options = stringArray(q.options);
  const keys = stringArray(q.correctAnswers).filter((key) => key.trim());
  const variants = stringArray(q.acceptedVariants);
  const manual = (MANUAL_QUESTION_TYPES as readonly string[]).includes(q.type);
  const choice = (CHOICE_QUESTION_TYPES as readonly string[]).includes(q.type) || (q.type === 'map_labelling' && options.length > 0);
  const text = (TEXT_QUESTION_TYPES as readonly string[]).includes(q.type) || (q.type === 'map_labelling' && options.length === 0);
  if (isAuto === manual) issues.push('question type is incompatible with its section');
  if (complete && q.prompt !== undefined && !q.prompt.trim()) issues.push('question prompt is missing');
  if (options.some((option) => !option.trim()) || new Set(options.map(strictAnswerText)).size !== options.length) issues.push('options contain blanks or duplicate values');
  if ((choice || q.type === 'multi_select') && complete && options.length < 2) issues.push('choice questions require at least two options');
  if (options.length > 26) issues.push('option bank exceeds 26 entries');
  if (text && options.length) issues.push('text answers must not contain options');
  if (complete && isAuto && keys.length === 0) issues.push('objective answer key is missing');
  if (manual && (keys.length || variants.length || options.length)) issues.push('manual tasks cannot contain objective keys or options');
  if (choice && complete) {
    const indexes = keys.map((key) => choiceIndex(key, options));
    if (indexes.some((index) => index === null)) issues.push('answer key does not resolve to the option bank');
    if (new Set(indexes).size > 1) issues.push('single-choice question maps to several options');
    if (variants.length) issues.push('accepted alternatives are only allowed for text answers');
  }
  if (q.type === 'multi_select' && complete) {
    if (complete && keys.length < 2) issues.push('multi-select requires at least two keys');
    if (keys.some((key) => choiceIndex(key, options) === null)) issues.push('multi-select key does not resolve to the options');
  }
  if (complete && (q.type === 'true_false_notgiven' || q.type === 'yes_no_notgiven')) {
    const permitted = q.type === 'true_false_notgiven' ? ['TRUE', 'FALSE', 'NOT_GIVEN'] : ['YES', 'NO', 'NOT_GIVEN'];
    if (keys.some((key) => !permitted.includes(canonicalDecision(key))) || new Set(keys.map(canonicalDecision)).size > 1) issues.push('decision answer key is invalid');
    if (variants.length) issues.push('decision answers cannot contain text alternatives');
  }
  if (q.wordLimit != null && (!Number.isInteger(q.wordLimit) || q.wordLimit < 1 || q.wordLimit > 50)) issues.push('word limit must be 1–50');
  if (q.answerRule != null) {
    if (!(ANSWER_RULES as readonly string[]).includes(q.answerRule) || !text) issues.push('answer rule is only valid for text completion');
    else if (complete && [...keys, ...variants].some((answer) => !respectsAnswerRule(answer, q.answerRule as AnswerRule))) issues.push('answer key exceeds the configured answer rule');
  }
  return issues;
}

export interface ObjectiveGroupInput {
  contentLayout?: string | null;
  optionsReusable?: boolean | null;
  imageKey?: string | null;
  questions: ObjectiveQuestionInput[];
}

export function objectiveGroupIssues(group: ObjectiveGroupInput, isAuto: boolean): string[] {
  const issues = group.questions.flatMap((q, index) => objectiveQuestionIssues(q, isAuto).map((issue) => `Question ${index + 1}: ${issue}`));
  const matching = group.questions.filter((q) => q.type === 'matching' || q.type === 'matching_headings' || (q.type === 'map_labelling' && stringArray(q.options).length > 0));
  const layout = group.contentLayout;
  if (layout && (MATCHING_LAYOUTS as readonly string[]).includes(layout)) {
    const type = layout === 'headings' ? 'matching_headings' : 'matching';
    if (group.questions.some((q) => q.type !== type)) issues.push(`${layout} layout requires ${type} questions`);
  }
  if (layout === 'multi_extract' && group.questions.some((q) => q.type !== 'multiple_choice')) issues.push('multi-extract layout requires multiple-choice questions');
  if ((layout === 'map' || group.questions.some((q) => q.type === 'map_labelling')) && !group.imageKey) issues.push('map/plan questions require an image');
  if ((layout && (MATCHING_LAYOUTS as readonly string[]).includes(layout)) || group.optionsReusable === false || layout === 'map') {
    const bank = JSON.stringify(stringArray(matching[0]?.options));
    if (matching.some((q) => JSON.stringify(stringArray(q.options)) !== bank)) issues.push('matching questions must share the same option bank');
  }
  if (group.optionsReusable === false) {
    const assigned = matching.map((q) => choiceIndex(stringArray(q.correctAnswers)[0] ?? '', stringArray(q.options))).filter((index) => index !== null);
    if (new Set(assigned).size !== assigned.length) issues.push('one-use option bank has repeated answer mappings');
  }
  return issues;
}

/** Repeated one-use selections score zero, even when a client bypasses the UI. */
export function duplicateMatchingResponses(
  questions: Array<{ id: string; type: string; options?: unknown }>,
  responses: ReadonlyMap<string, string>,
): Set<string> {
  const selected = new Map<number, string[]>();
  for (const q of questions) {
    if (!['matching', 'matching_headings', 'map_labelling'].includes(q.type)) continue;
    const index = choiceIndex(responses.get(q.id) ?? '', stringArray(q.options));
    if (index === null) continue;
    selected.set(index, [...(selected.get(index) ?? []), q.id]);
  }
  return new Set([...selected.values()].filter((ids) => ids.length > 1).flat());
}
