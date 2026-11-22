/**
 * Schema-1.0 template packages for the productive IELTS skills and for CEFR
 * Multilevel. Every package here must be accepted by the real importer
 * (`apps/core/mock_import_validate.py`); the committed fixtures under
 * `backend-django/tests/fixtures/exam_import_templates/` are validated and
 * imported by pytest, and `template-packages.spec.ts` keeps them in sync.
 *
 * Templates are scaffolds, never publication-ready exams: every one carries a
 * `reviewIssues` entry that blocks publishing until a teacher replaces the
 * REPLACE placeholders and sample answer keys.
 */

type Json = Record<string, unknown>;

/**
 * BestWay's configured Multilevel blueprint, mirrored from
 * `MULTILEVEL_SPEC` (`UZBMB_MULTILEVEL_EN_2026_V2`) in
 * `backend-django/apps/core/multilevel.py`. This is the platform's own
 * configured specification; it is not presented as an official document.
 * `template-packages.spec.ts` checks the counts against the backend fixture.
 */
export const MULTILEVEL_SPEC_VERSION = "UZBMB_MULTILEVEL_EN_2026_V2";

interface MultilevelObjectivePart {
  key: string;
  count: number;
  /** One entry per question: the type the blueprint allows at that position. */
  types: readonly string[];
  /** Number of options for choice questions; null for text answers. */
  options: number | null;
}

const repeat = (type: string, count: number) => Array.from({ length: count }, () => type);

export const MULTILEVEL_LISTENING: readonly MultilevelObjectivePart[] = [
  { key: "1", count: 8, types: repeat("multiple_choice", 8), options: 3 },
  { key: "2", count: 6, types: repeat("short_answer", 6), options: null },
  { key: "3", count: 4, types: repeat("matching", 4), options: 6 },
  { key: "4", count: 5, types: repeat("matching", 5), options: 8 },
  { key: "5", count: 6, types: repeat("multiple_choice", 6), options: 3 },
  { key: "6", count: 6, types: repeat("short_answer", 6), options: null },
];

export const MULTILEVEL_READING: readonly MultilevelObjectivePart[] = [
  { key: "1", count: 6, types: repeat("short_answer", 6), options: null },
  { key: "2", count: 8, types: repeat("matching", 8), options: 10 },
  { key: "3", count: 6, types: repeat("matching_headings", 6), options: 8 },
  { key: "4", count: 9, types: [...repeat("multiple_choice", 4), ...repeat("true_false_notgiven", 5)], options: 4 },
  { key: "5", count: 6, types: [...repeat("short_answer", 4), ...repeat("multiple_choice", 2)], options: 4 },
];

export const MULTILEVEL_WRITING = [
  { key: "informal_email", title: "Task 1.1 — Informal Letter", type: "essay_task1", maxScore: 5, words: "about 50 words" },
  { key: "formal_email", title: "Task 1.2 — Formal Letter", type: "essay_task1", maxScore: 5, words: "120–150 words" },
  { key: "publication", title: "Task 2 — Publication", type: "essay_task2", maxScore: 6, words: "180–200 words" },
] as const;

export const MULTILEVEL_SPEAKING = [
  { key: "1.1", title: "Part 1.1 — Interview", count: 3, maxScore: 5, timing: "Answer each question in about 30 seconds." },
  { key: "1.2", title: "Part 1.2 — Picture comparison", count: 3, maxScore: 5, timing: "Look at the two pictures. Answer the first question in about 45 seconds and the others in about 30 seconds each." },
  { key: "2", title: "Part 2 — Monologue", count: 1, maxScore: 5, timing: "You have 1 minute to prepare and up to 2 minutes to speak." },
  { key: "3", title: "Part 3 — Discussion", count: 1, maxScore: 6, timing: "You have 1 minute to prepare and up to 2 minutes to give your opinion." },
] as const;

export const MULTILEVEL_DURATIONS = { listening: 45, reading: 60, writing: 60, speaking: 30 } as const;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function blankGroupFields() {
  return { passageText: "", contentHtml: "", contentLayout: "document", audioScript: "" };
}

function placeholderOptions(count: number, label: string): string[] {
  return Array.from({ length: count }, (_, i) => `REPLACE — ${label} ${LETTERS[i]}`);
}

function objectiveQuestion(prefix: string, number: number, type: string, optionCount: number | null, optionLabel: string, position: number): Json {
  const base = {
    key: `${prefix}-q${number}`,
    sourceRef: "REPLACE — page/line of the source for this item",
    number,
    type,
    prompt: `REPLACE — Question ${number}`,
    acceptedVariants: [],
    points: 1,
  };
  if (type === "true_false_notgiven") {
    return { ...base, options: ["TRUE", "FALSE", "NOT GIVEN"], correctAnswers: ["NOT_GIVEN"] };
  }
  if (type === "short_answer") {
    // Multilevel text answers are one word or a number.
    return { ...base, options: [], correctAnswers: ["replace"], wordLimit: 1 };
  }
  // One-use matching banks need a different sample key per item; choice questions use A.
  const key = type === "matching" || type === "matching_headings" ? LETTERS[position % (optionCount ?? 4)] : "A";
  return { ...base, options: placeholderOptions(optionCount ?? 4, optionLabel), correctAnswers: [key] };
}

function multilevelObjectiveGroups(skill: "listening" | "reading", parts: readonly MultilevelObjectivePart[]): Json[] {
  let number = 0;
  return parts.map((part, index) => {
    const questions = part.types.map((type, position) => {
      number += 1;
      const label = type === "matching_headings" ? "Heading" : type === "matching" ? "Item" : "Option";
      return objectiveQuestion(`ml-${skill}-p${part.key}`, number, type, part.options, label, position);
    });
    const choice = part.types[0];
    const instructions =
      choice === "short_answer"
        ? "REPLACE — Write ONE WORD and/or A NUMBER for each answer."
        : choice === "matching" || choice === "matching_headings"
          ? "REPLACE — Match each item with the correct option. There are more options than you need."
          : "REPLACE — Choose the correct answer.";
    const group: Json = {
      key: `ml-${skill}-part-${part.key}`,
      title: `Part ${part.key}`,
      instructions,
      ...blankGroupFields(),
      questions,
    };
    if (skill === "listening") {
      group.partNumber = index + 1;
      // Multilevel recordings are heard twice (the builder's Multilevel preset uses 2).
      group.audioPlayLimit = 2;
      group.audioScript = `REPLACE — Transcript of Listening Part ${part.key} (staff only, never shown to students).`;
    } else {
      group.passageText = `REPLACE — Text for Reading Part ${part.key}. Keep paragraph labels (A, B, C…) when items refer to them.`;
    }
    if (choice === "matching" || choice === "matching_headings") {
      group.optionsReusable = false;
    }
    return group;
  });
}

function multilevelWritingGroups(): Json[] {
  return MULTILEVEL_WRITING.map((task, index) => ({
    key: `ml-writing-${task.key.replace(/_/g, "-")}`,
    title: task.title,
    instructions: `REPLACE — Task instructions. Write ${task.words}.`,
    ...blankGroupFields(),
    // Tasks 1.1 and 1.2 answer the same stimulus (the blueprint checks this).
    passageText: index < 2 ? "REPLACE — Shared stimulus (the message both letters reply to)." : "",
    ...(index < 2 ? { stimulusRef: "writing-task-1" } : {}),
    maxScore: task.maxScore,
    questions: [
      {
        key: `ml-writing-q${index + 1}`,
        sourceRef: "REPLACE — source of this task",
        number: index + 1,
        type: task.type,
        prompt: `REPLACE — ${task.title} prompt. Write ${task.words}.`,
        options: [],
        correctAnswers: [],
        acceptedVariants: [],
        points: task.maxScore,
      },
    ],
  }));
}

function multilevelSpeakingGroups(): { groups: Json[]; media: Json[] } {
  let number = 0;
  const groups = MULTILEVEL_SPEAKING.map((part) => {
    const group: Json = {
      key: `ml-speaking-part-${part.key.replace(".", "-")}`,
      title: part.title,
      instructions: part.timing,
      ...blankGroupFields(),
      maxScore: part.maxScore,
      questions: Array.from({ length: part.count }, () => {
        number += 1;
        return {
          key: `ml-speaking-q${number}`,
          sourceRef: "REPLACE — source of this prompt",
          number,
          type: "speaking_task",
          prompt: `REPLACE — Speaking question ${number}`,
          options: [],
          correctAnswers: [],
          acceptedVariants: [],
          points: part.maxScore,
        };
      }),
    };
    if (part.key === "1.2") group.imageRef = "speaking-part-1-2-pictures";
    return group;
  });
  const media = [
    {
      key: "speaking-part-1-2-pictures",
      kind: "image",
      fileName: "speaking-part-1-2-pictures.png",
      requiredForPublish: true,
      description: "Two pictures for Part 1.2 — attach the file before publishing.",
    },
  ];
  return { groups, media };
}

function multilevelSection(skill: "listening" | "reading" | "writing" | "speaking"): { section: Json; media: Json[] } {
  const titles = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };
  const instructions = {
    listening: "REPLACE — You will hear each recording twice. Answer Questions 1–35.",
    reading: "REPLACE — Read the texts and answer Questions 1–35.",
    writing: "REPLACE — Complete all three tasks.",
    speaking: "REPLACE — Your answers are recorded. Speak clearly after each prompt.",
  };
  let groups: Json[];
  let media: Json[] = [];
  if (skill === "listening") groups = multilevelObjectiveGroups("listening", MULTILEVEL_LISTENING);
  else if (skill === "reading") groups = multilevelObjectiveGroups("reading", MULTILEVEL_READING);
  else if (skill === "writing") groups = multilevelWritingGroups();
  else ({ groups, media } = multilevelSpeakingGroups());
  return {
    section: {
      key: skill,
      skill,
      title: titles[skill],
      instructions: instructions[skill],
      durationMinutes: MULTILEVEL_DURATIONS[skill],
      groups,
    },
    media,
  };
}

const MULTILEVEL_NOTE =
  `Structure follows BestWay's configured Multilevel specification ${MULTILEVEL_SPEC_VERSION} ` +
  "(the same blueprint the editor and publish checks use). It is a configurable platform default, not an official document. " +
  "Listening audio is uploaded per part in the editor after import.";

export function createMultilevelTemplate(
  skills: ReadonlyArray<"listening" | "reading" | "writing" | "speaking">,
  packageStem: string,
  now: Date,
): Json {
  const built = skills.map(multilevelSection);
  const full = skills.length === 4;
  const label = full ? "Full mock" : `${skills.map((s) => s[0].toUpperCase() + s.slice(1)).join(" & ")}`;
  return {
    schemaVersion: "1.0",
    packageId: `${packageStem}-${stamp(now)}`,
    revision: 1,
    profile: full ? "full_mock" : "practice",
    source: { kind: "provided_material", label: `CEFR Multilevel ${label} template`, notes: MULTILEVEL_NOTE },
    exam: {
      type: "multilevel",
      title: `REPLACE — CEFR Multilevel ${label}`,
      description: full
        ? "Four-section Multilevel mock: Listening (35 questions, 45 min), Reading (35 questions, 60 min), Writing (3 tasks, 60 min), Speaking (4 parts, 30 min)."
        : `Multilevel ${label} practice component.`,
      level: "REPLACE — target level, e.g. B1–C1",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections: built.map((b) => b.section),
    },
    media: built.flatMap((b) => b.media),
    reviewIssues: [
      {
        key: "replace-multilevel-placeholders",
        code: "OTHER",
        path: "/exam",
        message:
          "Replace every REPLACE placeholder and sample answer key with verified material, upload Listening audio for each part, and attach the required pictures before publishing.",
        sourceRef: "Generated CEFR Multilevel template",
      },
    ],
  };
}

function ieltsTask(key: string, number: number, type: string, prompt: string): Json {
  return {
    key,
    sourceRef: "REPLACE — source of this task",
    number,
    type,
    prompt,
    options: [],
    correctAnswers: [],
    acceptedVariants: [],
    // Productive IELTS tasks are scored on the 9-band scale (importer rule).
    points: 9,
  };
}

export function ieltsWritingSection(variant: "academic" | "general"): { section: Json; media: Json[] } {
  const academic = variant === "academic";
  const task1Prompt = academic
    ? "REPLACE — The chart/graph/table/map/process below shows … Summarise the information by selecting and reporting the main features, and make comparisons where relevant."
    : "REPLACE — Situation for the letter. Write a letter to … In your letter: • bullet 1 • bullet 2 • bullet 3. Begin your letter as follows: Dear …";
  const task2Prompt =
    "REPLACE — Essay topic. State the task type (opinion / discussion / advantages and disadvantages / problem and solution / two-part question). Give reasons for your answer and include any relevant examples from your own knowledge or experience.";
  const task1: Json = {
    key: `ielts-writing-${variant}-task-1`,
    title: academic ? "Writing Task 1 — Visual report" : "Writing Task 1 — Letter",
    instructions: `You should spend about 20 minutes on this task.\n\n${task1Prompt}\n\nWrite at least 150 words.`,
    ...blankGroupFields(),
    questions: [ieltsTask(`ielts-writing-${variant}-q1`, 1, "essay_task1", `${task1Prompt} (Write at least 150 words.)`)],
  };
  const media: Json[] = [];
  if (academic) {
    task1.imageRef = "writing-task-1-visual";
    media.push({
      key: "writing-task-1-visual",
      kind: "image",
      fileName: "writing-task-1-visual.png",
      requiredForPublish: true,
      description: "Task 1 chart, graph, table, map or process diagram — attach before publishing.",
    });
  }
  const task2: Json = {
    key: `ielts-writing-${variant}-task-2`,
    title: "Writing Task 2 — Essay",
    instructions: `You should spend about 40 minutes on this task.\n\nWrite about the following topic:\n\n${task2Prompt}\n\nWrite at least 250 words.`,
    ...blankGroupFields(),
    questions: [ieltsTask(`ielts-writing-${variant}-q2`, 2, "essay_task2", `${task2Prompt} (Write at least 250 words.)`)],
  };
  return {
    section: {
      key: "writing",
      skill: "writing",
      title: academic ? "Academic Writing" : "General Training Writing",
      instructions: "The Writing test has two tasks. You have 60 minutes. Task 2 carries more weight than Task 1.",
      durationMinutes: 60,
      groups: [task1, task2],
    },
    media,
  };
}

export function ieltsSpeakingSection(): Json {
  return {
    key: "speaking",
    skill: "speaking",
    title: "Speaking",
    instructions: "The Speaking test has three parts and lasts 11–14 minutes. Your answers are recorded.",
    durationMinutes: 15,
    groups: [
      {
        key: "ielts-speaking-part-1",
        title: "Speaking Part 1 — Interview",
        instructions: "Answer the examiner's questions about familiar topics (4–5 minutes).",
        ...blankGroupFields(),
        questions: [
          ieltsTask("ielts-speaking-q1", 1, "speaking_task",
            "Part 1 questions:\nTopic 1 — REPLACE\n1. REPLACE\n2. REPLACE\n3. REPLACE\nTopic 2 — REPLACE\n4. REPLACE\n5. REPLACE\n6. REPLACE"),
        ],
      },
      {
        key: "ielts-speaking-part-2",
        title: "Speaking Part 2 — Cue card",
        instructions: "You have 1 minute to prepare and make notes, then speak for up to 2 minutes.",
        ...blankGroupFields(),
        questions: [
          ieltsTask("ielts-speaking-q2", 2, "speaking_task",
            "CUE CARD:\nREPLACE — Describe …\nYou should say:\n- REPLACE\n- REPLACE\n- REPLACE\nand explain REPLACE."),
        ],
      },
      {
        key: "ielts-speaking-part-3",
        title: "Speaking Part 3 — Discussion",
        instructions: "Discuss broader questions linked to the Part 2 topic (4–5 minutes).",
        ...blankGroupFields(),
        questions: [
          ieltsTask("ielts-speaking-q3", 3, "speaking_task",
            "Part 3 discussion questions:\n1. REPLACE\n2. REPLACE\n3. REPLACE\n4. REPLACE"),
        ],
      },
    ],
  };
}

function ieltsPackage(stem: string, now: Date, type: "ielts_academic" | "ielts_general", title: string, description: string, sections: Json[], media: Json[], profile: "practice" | "full_mock"): Json {
  return {
    schemaVersion: "1.0",
    packageId: `${stem}-${stamp(now)}`,
    revision: 1,
    profile,
    source: {
      kind: "provided_material",
      label: `${title} template`,
      notes: "Replace every REPLACE placeholder with licensed or original material before publishing.",
    },
    exam: {
      type,
      title: `REPLACE — ${title}`,
      description,
      level: type === "ielts_academic" ? "IELTS Academic" : "IELTS General Training",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections,
    },
    media,
    reviewIssues: [
      {
        key: "replace-template-placeholders",
        code: "OTHER",
        path: "/exam",
        message: "Replace every REPLACE placeholder (and attach required images) before publishing.",
        sourceRef: `Generated ${title} template`,
      },
    ],
  };
}

export function createIeltsWritingTemplate(variant: "academic" | "general", now: Date): Json {
  const { section, media } = ieltsWritingSection(variant);
  return variant === "academic"
    ? ieltsPackage("ielts-academic-writing", now, "ielts_academic", "IELTS Academic Writing", "Academic Writing: Task 1 visual report (150 words) and Task 2 essay (250 words), 60 minutes.", [section], media, "practice")
    : ieltsPackage("ielts-general-writing", now, "ielts_general", "IELTS General Training Writing", "General Training Writing: Task 1 letter (150 words) and Task 2 essay (250 words), 60 minutes.", [section], media, "practice");
}

export function createIeltsSpeakingTemplate(now: Date): Json {
  return ieltsPackage("ielts-speaking", now, "ielts_academic", "IELTS Speaking", "Speaking Parts 1–3: interview, cue card long turn and discussion (11–14 minutes).", [ieltsSpeakingSection()], [], "practice");
}

export function createIeltsFullTemplate(now: Date, listening: Json, reading: Json): Json {
  const writing = ieltsWritingSection("academic");
  return ieltsPackage(
    "ielts-academic-full",
    now,
    "ielts_academic",
    "IELTS Academic Full Mock",
    "Four-skill Academic mock: Listening (4 parts / 40), Reading (3 passages / 40), Writing (2 tasks), Speaking (3 parts).",
    [listening, reading, writing.section, ieltsSpeakingSection()],
    writing.media,
    "full_mock",
  );
}
