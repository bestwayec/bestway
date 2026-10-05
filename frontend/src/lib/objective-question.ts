import type { MockQuestionType, ObjectiveAnswerRule } from "./types";

/** A student presentation contract deliberately has no answer-key fields. */
export interface ObjectiveQuestion {
  id: string;
  number: number;
  type: MockQuestionType | string;
  prompt: string;
  options: string[] | null;
  wordLimit: number | null;
  answerRule?: ObjectiveAnswerRule | null;
}

export const MATCHING_TYPES: ReadonlySet<string> = new Set(["matching", "matching_headings", "map_labelling"]);
const SINGLE_CHOICE = new Set(["multiple_choice", "true_false_notgiven", "yes_no_notgiven", "matching", "matching_headings"]);

export function objectiveOptions(q: ObjectiveQuestion): string[] {
  if (q.options?.length) return q.options;
  if (q.type === "true_false_notgiven") return ["TRUE", "FALSE", "NOT GIVEN"];
  if (q.type === "yes_no_notgiven") return ["YES", "NO", "NOT GIVEN"];
  return [];
}

export function isObjectiveChoice(q: ObjectiveQuestion): boolean {
  return SINGLE_CHOICE.has(q.type) || q.type === "multi_select" || (q.type === "map_labelling" && !!q.options?.length);
}

/** Read legacy responses, while JSON arrays preserve punctuation in new answers. */
export function selectedObjectiveOptions(value: string, options: string[] = []): string[] {
  let selected: string[];
  if (value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      selected = Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
    } catch { selected = []; }
  } else if (options.includes(value)) selected = [value];
  else {
    selected = value.split(/[,;]+/).map((v) => v.trim()).filter(Boolean);
    if (selected.length === 1 && /^[a-z](?:\s+[a-z])+$/i.test(selected[0])) selected = selected[0].split(/\s+/);
  }
  return selected.map((item) => options.includes(item) ? item : /^[a-z]$/i.test(item) ? options[item.toUpperCase().charCodeAt(0) - 65] ?? item : item);
}

export function toggleObjectiveOption(value: string, option: string, options: string[] = []): string {
  const selected = selectedObjectiveOptions(value, options);
  const next = selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option];
  return next.length ? JSON.stringify(next) : '';
}

export function answerRuleHint(q: Pick<ObjectiveQuestion, "answerRule" | "wordLimit">): string | null {
  if (q.answerRule === "ONE_WORD") return "ONE WORD";
  if (q.answerRule === "ONE_WORD_AND_OR_NUMBER") return "ONE WORD AND/OR A NUMBER";
  return q.wordLimit ? `NO MORE THAN ${q.wordLimit} ${q.wordLimit === 1 ? "WORD" : "WORDS"}` : null;
}

export function usedMatchingOptions(questions: ObjectiveQuestion[], answers: Record<string, string>, questionId: string): string[] {
  return questions.filter((q) => q.id !== questionId && MATCHING_TYPES.has(q.type)).map((q) => answers[q.id]).filter(Boolean);
}

export function studentQuestion(q: ObjectiveQuestion): ObjectiveQuestion {
  return { id: q.id, number: q.number, type: q.type, prompt: q.prompt, options: q.options, wordLimit: q.wordLimit, answerRule: q.answerRule };
}
