import type { MockContentLayout, MockExamType, MockQuestionType, MockSkill, ObjectiveAnswerRule } from "@/lib/types";

export function uid(): string {
  return Math.random().toString(36).slice(2);
}

export interface BuilderQuestion {
  clientId: string;
  number: number;
  type: MockQuestionType;
  prompt: string;
  options: string[];
  correctAnswers: string[];
  acceptedVariants: string[];
  points: number;
  wordLimit?: number;
  answerRule?: ObjectiveAnswerRule | null;
  savedQuestionId?: string;
}

export interface BuilderPart {
  clientId: string;
  title: string;
  instructions: string;
  passageText: string;
  contentHtml?: string;
  contentLayout?: MockContentLayout;
  optionsReusable?: boolean | null;
  partNumber?: number;
  audioFileName?: string;
  audioPendingFile?: File | null;
  audioDurationSec?: number;
  audioPlayLimit: number;
  hasAudio: boolean;
  questions: BuilderQuestion[];
  savedGroupId?: string;
}

export interface BuilderSection {
  skill: MockSkill;
  title: string;
  durationMinutes?: number;
  instructions: string;
  parts: BuilderPart[];
  savedSectionId?: string;
}

export interface BuilderDraft {
  examId: string;
  title: string;
  type: MockExamType;
  level: string;
  price: number;
  sections: BuilderSection[];
}

const MANUAL_TYPES: MockQuestionType[] = ["essay_task1", "essay_task2", "speaking_task"];

export function isAutoType(t: MockQuestionType): boolean {
  return !MANUAL_TYPES.includes(t);
}

export const AUTO_TYPES: MockQuestionType[] = [
  "multiple_choice",
  "multi_select",
  "true_false_notgiven",
  "yes_no_notgiven",
  "matching",
  "matching_headings",
  "sentence_completion",
  "note_completion",
  "summary_completion",
  "table_completion",
  "short_answer",
  "map_labelling",
];

export const GROUPED_TYPES: Array<{ group: string; types: MockQuestionType[] }> = [
  {
    group: "Choice",
    types: ["multiple_choice", "multi_select", "true_false_notgiven", "yes_no_notgiven"],
  },
  {
    group: "Fill in",
    types: [
      "sentence_completion",
      "note_completion",
      "summary_completion",
      "table_completion",
      "short_answer",
    ],
  },
  { group: "Match", types: ["matching", "matching_headings", "map_labelling"] },
  { group: "Write / Speak", types: ["essay_task1", "essay_task2", "speaking_task"] },
];

export const QTYPE_LABEL: Record<MockQuestionType, string> = {
  multiple_choice: "Multiple choice",
  multi_select: "Multiple select",
  true_false_notgiven: "True / False / Not Given",
  yes_no_notgiven: "Yes / No / Not Given",
  matching: "Matching",
  matching_headings: "Matching headings",
  sentence_completion: "Sentence completion",
  note_completion: "Note completion",
  summary_completion: "Summary completion",
  table_completion: "Table completion",
  short_answer: "Short answer",
  map_labelling: "Map / diagram labelling",
  essay_task1: "Writing Task 1",
  essay_task2: "Writing Task 2",
  speaking_task: "Speaking task",
};

export function newQuestion(
  number: number,
  type: MockQuestionType,
  isAuto: boolean,
): BuilderQuestion {
  return {
    clientId: uid(),
    number,
    type,
    prompt: "",
    options: [],
    correctAnswers: [],
    acceptedVariants: [],
    points: isAuto ? 1 : 9,
    savedQuestionId: undefined,
  };
}

function blankPart(partNumber: number, title?: string): BuilderPart {
  return {
    clientId: uid(),
    title: title ?? `Part ${partNumber}`,
    instructions: "",
    passageText: "",
    partNumber,
    audioFileName: undefined,
    audioPendingFile: null,
    audioDurationSec: undefined,
    audioPlayLimit: 1,
    hasAudio: false,
    questions: [],
    savedGroupId: undefined,
  };
}

// Diqqat: essay larda wordLimit QO'YILMAYDI — backend wordLimit ni "NO MORE THAN X"
// (oshsa 0 ball) deb baholaydi; essay minimumlari (150/250) faqat UI eslatma.
function writingQuestion(number: number, type: MockQuestionType): BuilderQuestion {
  return {
    clientId: uid(),
    number,
    type,
    prompt: "",
    options: [],
    correctAnswers: [],
    acceptedVariants: [],
    points: 9,
    savedQuestionId: undefined,
  };
}

function speakingQuestion(number: number): BuilderQuestion {
  return {
    clientId: uid(),
    number,
    type: "speaking_task",
    prompt: "",
    options: [],
    correctAnswers: [],
    acceptedVariants: [],
    points: 9,
    savedQuestionId: undefined,
  };
}

export function defaultSections(): BuilderSection[] {
  const listening: BuilderSection = {
    skill: "listening",
    title: "Listening",
    durationMinutes: undefined,
    instructions: "",
    parts: [1, 2, 3, 4].map((n) => blankPart(n)),
    savedSectionId: undefined,
  };
  const reading: BuilderSection = {
    skill: "reading",
    title: "Reading",
    durationMinutes: undefined,
    instructions: "",
    parts: [1, 2, 3].map((n) => blankPart(n)),
    savedSectionId: undefined,
  };
  const writing: BuilderSection = {
    skill: "writing",
    title: "Writing",
    durationMinutes: undefined,
    instructions: "",
    parts: [
      { ...blankPart(1, "Task 1"), questions: [writingQuestion(1, "essay_task1")] },
      { ...blankPart(2, "Task 2"), questions: [writingQuestion(2, "essay_task2")] },
    ],
    savedSectionId: undefined,
  };
  const speaking: BuilderSection = {
    skill: "speaking",
    title: "Speaking",
    durationMinutes: undefined,
    instructions: "",
    parts: [1, 2, 3].map((n) => ({ ...blankPart(n), questions: [speakingQuestion(n)] })),
    savedSectionId: undefined,
  };
  return [listening, reading, writing, speaking];
}

/** Types whose backend contract requires at least 2 options. */
export const OPTION_TYPES: MockQuestionType[] = [
  "multiple_choice",
  "multi_select",
  "matching",
  "matching_headings",
];

const OPTION_TYPE_SET: ReadonlySet<MockQuestionType> = new Set(OPTION_TYPES);

/** Types with a backend-representable word limit (NO MORE THAN X). Never set on essays/speaking. */
export const WORD_LIMIT_TYPES: MockQuestionType[] = [
  "short_answer",
  "sentence_completion",
  "note_completion",
  "summary_completion",
  "table_completion",
];

function nonEmpty(values: string[]): string[] {
  return values.filter((v) => v.trim() !== "");
}

export function validatePart(skill: MockSkill, part: BuilderPart): string[] {
  const errors: string[] = [];
  if (skill === "writing" || skill === "speaking") {
    if (part.questions.length === 0) errors.push("Add at least one question");
    for (const q of part.questions) {
      if (!q.prompt.trim()) errors.push(`Question ${q.number}: prompt is required`);
    }
    return errors;
  }
  if (skill === "reading" && !part.passageText.trim()) {
    errors.push("Passage text is required");
  }
  if (part.questions.length === 0) {
    errors.push("Add at least one question");
  }
  for (const q of part.questions) {
    if (!q.prompt.trim()) errors.push(`Question ${q.number}: prompt is required`);
    // Type-aware: options required only for option types (backend OPTIONS_REQUIRED).
    if (OPTION_TYPE_SET.has(q.type) && nonEmpty(q.options).length < 2) {
      errors.push(`Question ${q.number}: choice questions need at least 2 options`);
    }
    if (isAutoType(q.type) && nonEmpty(q.correctAnswers).length === 0) {
      errors.push(`Question ${q.number}: add at least one correct answer`);
    }
    if (q.wordLimit != null && (!Number.isInteger(q.wordLimit) || q.wordLimit < 1 || q.wordLimit > 50)) {
      errors.push(`Question ${q.number}: word limit must be between 1 and 50`);
    }
    if (!Number.isInteger(q.points) || q.points < 1 || q.points > 20) {
      errors.push(`Question ${q.number}: points must be between 1 and 20`);
    }
  }
  return errors;
}

export function validateOneQuestion(skill: MockSkill, q: BuilderQuestion): string[] {
  const part: BuilderPart = {
    clientId: "probe",
    title: "",
    instructions: "",
    passageText: skill === "reading" ? "probe" : "",
    audioPlayLimit: 1,
    hasAudio: false,
    questions: [q],
  };
  return validatePart(skill, part);
}

/** Saving an incomplete draft is allowed; malformed data still cannot be saved. */
export function validateDraftPart(part: BuilderPart): string[] {
  const errors: string[] = [];
  if (part.passageText.length > 20000) errors.push("Passage text must be 20000 characters or fewer.");
  if ((part.contentHtml?.length ?? 0) > 100000) errors.push("Gap context is too long.");
  const numbers = new Set<number>();
  for (const q of part.questions) {
    if (!Number.isInteger(q.number) || q.number < 1 || q.number > 200) errors.push("Question number must be between 1 and 200.");
    if (numbers.has(q.number)) errors.push(`Question ${q.number}: number is repeated.`);
    numbers.add(q.number);
    if (q.prompt.length > 5000) errors.push(`Question ${q.number}: prompt is too long.`);
    if (q.options.length > 26) errors.push(`Question ${q.number}: use at most 26 options.`);
    if (!Number.isInteger(q.points) || q.points < 1 || q.points > 20) errors.push(`Question ${q.number}: points must be between 1 and 20.`);
    if (q.wordLimit != null && (!Number.isInteger(q.wordLimit) || q.wordLimit < 1 || q.wordLimit > 50)) errors.push(`Question ${q.number}: word limit must be between 1 and 50.`);
  }
  return errors;
}
