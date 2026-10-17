export type ExamImportTemplateId =
  | "listening-full"
  | "listening-part-1"
  | "listening-part-2"
  | "listening-part-3"
  | "listening-part-4"
  | "academic-reading-full"
  | "reading-passage-1"
  | "reading-passage-2"
  | "reading-passage-3"
  | "multilevel-full"
  | "writing-full"
  | "speaking-full";

export type ExamImportTemplateSkill = "reading" | "listening" | "writing" | "speaking" | "multilevel";

export interface ExamImportTemplateOption {
  id: ExamImportTemplateId;
  skill: ExamImportTemplateSkill;
  label: string;
  description: string;
  fileName: string;
}

export const EXAM_IMPORT_TEMPLATES: readonly ExamImportTemplateOption[] = [
  {
    id: "multilevel-full",
    skill: "multilevel",
    label: "Multi-Level CBT · Full 4-Section Mock (195 min)",
    description:
      "A complete Multi-Level CEFR test containing Listening (35 questions), Reading (35 questions), Writing (Task 1 & 2), and Speaking (Parts 1-3).",
    fileName: "multilevel-cbt-full-template.json",
  },
  {
    id: "writing-full",
    skill: "writing",
    label: "Writing · Task 1.1, Task 1.2 & Task 2",
    description:
      "A 60-minute Writing component containing Task 1.1 (informal letter), Task 1.2 (formal letter), and Task 2 (250-word discursive essay).",
    fileName: "multilevel-writing-template.json",
  },
  {
    id: "speaking-full",
    skill: "speaking",
    label: "Speaking · Parts 1, 2 & 3 Interview & Monologue",
    description:
      "A 15-minute Speaking component with Part 1 (Interview & Picture Comparison), Part 2 (Monologue), and Part 3 (Analytical Discussion).",
    fileName: "multilevel-speaking-template.json",
  },
  {
    id: "listening-full",
    skill: "listening",
    label: "IELTS Listening · Full test · 4 parts / 40 questions",
    description:
      "A 30-minute Listening package with four official-style parts. Audio is added by the teacher in each Part editor after import.",
    fileName: "ielts-listening-full-template.json",
  },
  {
    id: "listening-part-1",
    skill: "listening",
    label: "Listening Part 1 · Questions 1–10",
    description:
      "Everyday social conversation with a form/table-completion scaffold. Teacher uploads the Part 1 audio after import.",
    fileName: "ielts-listening-part-1-template.json",
  },
  {
    id: "listening-part-2",
    skill: "listening",
    label: "Listening Part 2 · Questions 11–20",
    description:
      "Everyday social monologue with plan/map labels and single-answer multiple choice. Teacher adds audio and the visual in the editor.",
    fileName: "ielts-listening-part-2-template.json",
  },
  {
    id: "listening-part-3",
    skill: "listening",
    label: "Listening Part 3 · Questions 21–30",
    description:
      "Educational or training discussion with matching and multiple-choice questions. Teacher uploads the Part 3 audio after import.",
    fileName: "ielts-listening-part-3-template.json",
  },
  {
    id: "listening-part-4",
    skill: "listening",
    label: "Listening Part 4 · Questions 31–40",
    description:
      "Academic monologue/lecture with a note-completion scaffold. Teacher uploads the Part 4 audio after import.",
    fileName: "ielts-listening-part-4-template.json",
  },
  {
    id: "academic-reading-full",
    skill: "reading",
    label: "Academic Reading · Full test · 3 passages / 40 questions",
    description:
      "A 60-minute package containing Passage 1 (Q1–13), Passage 2 (Q14–26) and Passage 3 (Q27–40).",
    fileName: "ielts-academic-reading-full-template.json",
  },
  {
    id: "reading-passage-1",
    skill: "reading",
    label: "Reading Passage 1 · Questions 1–13",
    description: "Passage 1 reference covering TFNG, single choice, note completion and short answers.",
    fileName: "ielts-reading-passage-1-template.json",
  },
  {
    id: "reading-passage-2",
    skill: "reading",
    label: "Reading Passage 2 · Questions 14–26",
    description: "Passage 2 reference covering headings, features, sentence and table completion.",
    fileName: "ielts-reading-passage-2-template.json",
  },
  {
    id: "reading-passage-3",
    skill: "reading",
    label: "Reading Passage 3 · Questions 27–40",
    description: "Passage 3 reference covering YNNG, multi-select, matching, summary and diagram labels.",
    fileName: "ielts-reading-passage-3-template.json",
  },
] as const;

type TemplateQuestionType =
  | "multiple_choice"
  | "multi_select"
  | "true_false_notgiven"
  | "yes_no_notgiven"
  | "matching"
  | "matching_headings"
  | "sentence_completion"
  | "note_completion"
  | "summary_completion"
  | "table_completion"
  | "short_answer"
  | "map_labelling";

interface TaskBlueprint {
  key: string;
  start: number;
  end: number;
  type: TemplateQuestionType;
  instructions: string;
  options?: string[];
  wordLimit?: number;
  contentLayout?: "document" | "table" | "notes" | "summary" | "sentences";
  documentTitle?: string;
}

interface PassageBlueprint {
  index: 1 | 2 | 3;
  start: number;
  end: number;
  taskGroups: TaskBlueprint[];
}

const PASSAGES: readonly PassageBlueprint[] = [
  {
    index: 1,
    start: 1,
    end: 13,
    taskGroups: [
      {
        key: "identifying-information",
        start: 1,
        end: 4,
        type: "true_false_notgiven",
        instructions:
          "Do the following statements agree with the information given in Reading Passage 1? Choose TRUE if the statement agrees with the information, FALSE if it contradicts the information, or NOT GIVEN if there is no information on this.",
      },
      {
        key: "multiple-choice",
        start: 5,
        end: 7,
        type: "multiple_choice",
        instructions: "Choose the correct letter, A, B, C or D.",
        options: [
          "REPLACE — Option A",
          "REPLACE — Option B",
          "REPLACE — Option C",
          "REPLACE — Option D",
        ],
      },
      {
        key: "note-completion",
        start: 8,
        end: 10,
        type: "note_completion",
        instructions:
          "Complete the notes below. Choose ONE WORD ONLY from the passage for each answer.",
        wordLimit: 1,
        contentLayout: "notes",
        documentTitle: "REPLACE — Notes title",
      },
      {
        key: "short-answer",
        start: 11,
        end: 13,
        type: "short_answer",
        instructions:
          "Answer the questions below. Choose NO MORE THAN THREE WORDS AND/OR A NUMBER from the passage for each answer.",
        wordLimit: 3,
      },
    ],
  },
  {
    index: 2,
    start: 14,
    end: 26,
    taskGroups: [
      {
        key: "matching-headings",
        start: 14,
        end: 17,
        type: "matching_headings",
        instructions:
          "Reading Passage 2 has six marked paragraphs, A–F. Choose the correct heading for each paragraph from the list of headings. There are more headings than paragraphs, so you will not use all of them. Each heading may be used only once.",
        options: [
          "REPLACE — Heading i",
          "REPLACE — Heading ii",
          "REPLACE — Heading iii",
          "REPLACE — Heading iv",
          "REPLACE — Heading v",
          "REPLACE — Heading vi",
          "REPLACE — Heading vii",
        ],
      },
      {
        key: "matching-features",
        start: 18,
        end: 20,
        type: "matching",
        instructions:
          "Match each statement with the correct feature, A–E. You may use any letter more than once.",
        options: ["Feature A", "Feature B", "Feature C", "Feature D", "Feature E"],
      },
      {
        key: "sentence-completion",
        start: 21,
        end: 23,
        type: "sentence_completion",
        instructions:
          "Complete the sentences below. Choose NO MORE THAN TWO WORDS from the passage for each answer.",
        wordLimit: 2,
        contentLayout: "sentences",
        documentTitle: "REPLACE — Sentence completion",
      },
      {
        key: "table-completion",
        start: 24,
        end: 26,
        type: "table_completion",
        instructions:
          "Complete the table below. Choose NO MORE THAN TWO WORDS AND/OR A NUMBER from the passage for each answer.",
        wordLimit: 2,
        contentLayout: "table",
        documentTitle: "REPLACE — Table title",
      },
    ],
  },
  {
    index: 3,
    start: 27,
    end: 40,
    taskGroups: [
      {
        key: "writers-views",
        start: 27,
        end: 30,
        type: "yes_no_notgiven",
        instructions:
          "Do the following statements agree with the views or claims of the writer in Reading Passage 3? Choose YES if the statement agrees with the writer, NO if it contradicts the writer, or NOT GIVEN if it is impossible to say what the writer thinks about this.",
      },
      {
        key: "multiple-choice-multiple-answers",
        start: 31,
        end: 32,
        type: "multi_select",
        instructions:
          "Choose TWO letters, A–E. Select exactly two answers for each numbered question.",
        options: [
          "REPLACE — Option A",
          "REPLACE — Option B",
          "REPLACE — Option C",
          "REPLACE — Option D",
          "REPLACE — Option E",
        ],
      },
      {
        key: "matching-information",
        start: 33,
        end: 35,
        type: "matching",
        instructions:
          "Which paragraph contains the following information? Choose the correct letter, A–F. You may use any letter more than once.",
        options: ["Paragraph A", "Paragraph B", "Paragraph C", "Paragraph D", "Paragraph E", "Paragraph F"],
      },
      {
        key: "summary-completion",
        start: 36,
        end: 38,
        type: "summary_completion",
        instructions:
          "Complete the summary below. Choose NO MORE THAN TWO WORDS AND/OR A NUMBER from the passage for each answer.",
        wordLimit: 2,
        contentLayout: "summary",
        documentTitle: "REPLACE — Summary title",
      },
      {
        key: "diagram-label-completion",
        start: 39,
        end: 40,
        type: "map_labelling",
        instructions:
          "Complete the labels on the diagram. Choose NO MORE THAN TWO WORDS from the passage for each answer. Add the diagram image in Exam Builder after import if required.",
        wordLimit: 2,
      },
    ],
  },
] as const;

interface ListeningBlockBlueprint {
  start: number;
  end: number;
  type: TemplateQuestionType;
  instructions: string;
  options?: string[];
  wordLimit?: number;
}

interface ListeningPartBlueprint {
  index: 1 | 2 | 3 | 4;
  start: number;
  end: number;
  context: string;
  contentLayout: "document" | "table" | "notes";
  blocks: ListeningBlockBlueprint[];
}

/**
 * Official IELTS Listening shape: four recordings, ten marks per Part.
 * Not every official task type appears in one test, so the full scaffold uses
 * a realistic mix while keeping exactly one persisted group per Part.
 */
const LISTENING_PARTS: readonly ListeningPartBlueprint[] = [
  {
    index: 1,
    start: 1,
    end: 10,
    context: "Everyday social conversation between two speakers",
    contentLayout: "table",
    blocks: [
      {
        start: 1,
        end: 10,
        type: "table_completion",
        instructions:
          "Questions 1-10. Complete the form or table. Write ONE WORD AND/OR A NUMBER for each answer.",
        wordLimit: 2,
      },
    ],
  },
  {
    index: 2,
    start: 11,
    end: 20,
    context: "Everyday social monologue about a place, service or facility",
    contentLayout: "document",
    blocks: [
      {
        start: 11,
        end: 15,
        type: "map_labelling",
        instructions:
          "Questions 11-15. Label the plan, map or diagram. Write NO MORE THAN TWO WORDS for each answer. Upload the visual in the Part editor after import.",
        wordLimit: 2,
      },
      {
        start: 16,
        end: 20,
        type: "multiple_choice",
        instructions: "Questions 16-20. Choose the correct letter, A, B or C.",
        options: [
          "REPLACE - Option A",
          "REPLACE - Option B",
          "REPLACE - Option C",
        ],
      },
    ],
  },
  {
    index: 3,
    start: 21,
    end: 30,
    context: "Educational or training discussion with two to four speakers",
    contentLayout: "document",
    blocks: [
      {
        start: 21,
        end: 25,
        type: "matching",
        instructions:
          "Questions 21-25. Match each statement with the correct speaker, opinion or category, A-E. You may use any letter more than once.",
        options: [
          "REPLACE - Option A",
          "REPLACE - Option B",
          "REPLACE - Option C",
          "REPLACE - Option D",
          "REPLACE - Option E",
        ],
      },
      {
        start: 26,
        end: 30,
        type: "multiple_choice",
        instructions: "Questions 26-30. Choose the correct letter, A, B or C.",
        options: [
          "REPLACE - Option A",
          "REPLACE - Option B",
          "REPLACE - Option C",
        ],
      },
    ],
  },
  {
    index: 4,
    start: 31,
    end: 40,
    context: "Academic monologue or lecture",
    contentLayout: "notes",
    blocks: [
      {
        start: 31,
        end: 40,
        type: "note_completion",
        instructions:
          "Questions 31-40. Complete the notes. Write NO MORE THAN TWO WORDS for each answer.",
        wordLimit: 2,
      },
    ],
  },
] as const;

function safeStamp(now: Date): string {
  return now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function numbers(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function optionsFor(task: TaskBlueprint): string[] {
  if (task.options) return task.options;
  if (task.type === "true_false_notgiven") return ["TRUE", "FALSE", "NOT GIVEN"];
  if (task.type === "yes_no_notgiven") return ["YES", "NO", "NOT GIVEN"];
  return [];
}

function placeholderAnswers(task: TaskBlueprint): string[] {
  if (task.type === "true_false_notgiven") return ["TRUE"];
  if (task.type === "yes_no_notgiven") return ["YES"];
  if (task.type === "multi_select") return ["A", "B"];
  if (
    task.type === "multiple_choice" ||
    task.type === "matching" ||
    task.type === "matching_headings"
  ) {
    return ["A"];
  }
  return ["REPLACE"];
}

function questionPrompt(task: TaskBlueprint, number: number): string {
  if (task.type === "true_false_notgiven" || task.type === "yes_no_notgiven") {
    return `REPLACE — Statement for question ${number}.`;
  }
  if (task.type === "matching_headings") {
    const paragraph = String.fromCharCode(65 + (number - task.start));
    return `Paragraph ${paragraph}`;
  }
  if (task.type === "matching") return `REPLACE — Information statement for question ${number}.`;
  if (task.type === "multiple_choice") return `REPLACE — Multiple-choice question ${number}.`;
  return `REPLACE — Completion prompt for question ${number}.`;
}

function makeQuestion(task: TaskBlueprint, number: number) {
  return {
    key: `reading-question-${number}`,
    number,
    type: task.type,
    prompt: questionPrompt(task, number),
    options: optionsFor(task),
    // Schema-valid placeholders keep the package importable as a draft. A
    // package-level review issue still blocks publication until source review.
    correctAnswers: placeholderAnswers(task),
    acceptedVariants: [],
    points: 1,
    ...(task.wordLimit ? { wordLimit: task.wordLimit } : {}),
    sourceRef: `REPLACE — Passage source location for question ${number}`,
  };
}

function contentHtmlFor(task: TaskBlueprint): string {
  if (!task.contentLayout) return "";
  if (task.contentLayout === "table") {
    const rows = numbers(task.start, task.end)
      .map(
        (number) =>
          `<tr><td>REPLACE — Row ${number}</td><td><span data-gap="${number}"></span></td></tr>`,
      )
      .join("");
    return `<h3>${task.documentTitle}</h3><table><thead><tr><th>REPLACE — Category</th><th>REPLACE — Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const items = numbers(task.start, task.end)
    .map(
      (number) =>
        `<li>REPLACE — Question ${number} context: <span data-gap="${number}"></span></li>`,
    )
    .join("");
  return `<h3>${task.documentTitle}</h3><ol>${items}</ol>`;
}

function listeningQuestionPrompt(
  block: ListeningBlockBlueprint,
  number: number,
): string {
  if (block.type === "table_completion") {
    return `REPLACE - Form or table field for question ${number}: ______`;
  }
  if (block.type === "note_completion") {
    return `REPLACE - Note for question ${number}: ______`;
  }
  if (block.type === "map_labelling") {
    return `REPLACE - Label the numbered location or feature for question ${number}.`;
  }
  if (block.type === "matching") {
    return `REPLACE - Statement to match for question ${number}.`;
  }
  return `REPLACE - Multiple-choice question ${number}.`;
}

function makeListeningQuestion(
  block: ListeningBlockBlueprint,
  number: number,
) {
  const choice =
    block.type === "multiple_choice" ||
    block.type === "matching" ||
    block.type === "matching_headings";
  return {
    key: `listening-question-${number}`,
    number,
    type: block.type,
    prompt: listeningQuestionPrompt(block, number),
    options: block.options ?? [],
    correctAnswers: choice ? ["A"] : ["REPLACE"],
    acceptedVariants: [],
    points: 1,
    ...(block.wordLimit ? { wordLimit: block.wordLimit } : {}),
    sourceRef: `REPLACE - Recording Part source location for question ${number}`,
  };
}

function listeningContentHtml(part: ListeningPartBlueprint): string {
  if (part.contentLayout === "document") return "";
  const block = part.blocks[0];
  if (part.contentLayout === "table") {
    const rows = numbers(block.start, block.end)
      .map(
        (number) =>
          `<tr><td>REPLACE - Field ${number}</td><td><span data-gap="${number}"></span></td></tr>`,
      )
      .join("");
    return `<h3>REPLACE - Part 1 form or table title</h3><table><thead><tr><th>REPLACE - Field</th><th>REPLACE - Details</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const items = numbers(block.start, block.end)
    .map(
      (number) =>
        `<li>REPLACE - Lecture note ${number}: <span data-gap="${number}"></span></li>`,
    )
    .join("");
  return `<h3>REPLACE - Part 4 lecture notes title</h3><ul>${items}</ul>`;
}

function makeListeningPart(part: ListeningPartBlueprint) {
  return {
    key: `listening-part-${part.index}`,
    title: `Part ${part.index} - REPLACE - ${part.context}`,
    instructions: part.blocks.map((block) => block.instructions).join("\n\n"),
    // Listening transcripts are staff review material, never the student-side
    // passage. The teacher can add the transcript and audio in the Part editor.
    passageText: "",
    contentHtml: listeningContentHtml(part),
    contentLayout: part.contentLayout,
    audioScript: "",
    partNumber: part.index,
    audioPlayLimit: 1,
    questions: part.blocks.flatMap((block) =>
      numbers(block.start, block.end).map((number) =>
        makeListeningQuestion(block, number),
      ),
    ),
  };
}

function selectedListeningParts(
  id: ExamImportTemplateId,
): readonly ListeningPartBlueprint[] {
  if (id === "listening-full") return LISTENING_PARTS;
  const match = id.match(/^listening-part-([1-4])$/);
  if (!match) return [];
  const index = Number(match[1]);
  return LISTENING_PARTS.filter((part) => part.index === index);
}

function createListeningImportTemplate(
  id: ExamImportTemplateId,
  now: Date,
): Record<string, unknown> {
  const parts = selectedListeningParts(id);
  const full = id === "listening-full";
  const first = parts[0];
  const last = parts[parts.length - 1];

  return {
    schemaVersion: "1.0",
    packageId: `${id}-${safeStamp(now)}`,
    revision: 1,
    // Listening is identical for IELTS Academic and General Training. This is
    // a single-skill practice component, not a four-skill full mock.
    profile: "practice",
    source: {
      kind: "provided_material",
      label: full
        ? "IELTS Listening - four-part template"
        : `IELTS Listening Part ${first.index} template`,
      notes:
        "Replace every REPLACE placeholder and answer key using licensed or original material. After import, upload audio in each Part editor. Do not add audioRef or media entries when the teacher will upload audio later.",
    },
    exam: {
      type: "ielts_academic",
      title: full
        ? "REPLACE - IELTS Listening Practice Test"
        : `REPLACE - IELTS Listening Part ${first.index} Practice`,
      description: full
        ? "A 30-minute IELTS Listening practice test with four recordings and 40 questions."
        : `Single-part IELTS Listening practice for Questions ${first.start}-${last.end}.`,
      level: "IELTS",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections: [
        {
          key: "listening",
          skill: "listening",
          title: "IELTS Listening",
          instructions: full
            ? "You will hear four recordings once only. Answer Questions 1-40. Each correct answer receives one mark."
            : `You will hear the Part ${first.index} recording once only. Answer Questions ${first.start}-${last.end}.`,
          durationMinutes: full ? 30 : 10,
          groups: parts.map(makeListeningPart),
        },
      ],
    },
    // Audio is deliberately omitted from JSON. The teacher uploads one file
    // per Part from the editor; server readiness blocks publish until then.
    media: [],
    reviewIssues: [
      {
        key: "replace-listening-template-placeholders",
        code: "OTHER",
        path: "/exam/sections/0",
        message: full
          ? "Replace and verify all Listening placeholders and answer keys, upload audio for Parts 1-4 in the teacher editor, and upload the Part 2 plan/map/diagram if that task is used."
          : `Replace and verify all Part ${first.index} placeholders and answer keys, then upload its audio in the teacher editor${first.index === 2 ? " and add the plan/map/diagram visual" : ""}.`,
        sourceRef: "Generated IELTS Listening import template",
      },
    ],
  };
}

function makePassageGroups(passage: PassageBlueprint) {
  const passageText = [
    `REPLACE WITH THE COMPLETE TEXT FOR READING PASSAGE ${passage.index}.`,
    "Preserve all paragraph breaks. For matching tasks, include paragraph labels such as A, B, C and so on in the passage text.",
    "For a complete Academic Reading test, the combined length of all three passages should be approximately 2,150–2,750 words.",
  ].join("\n\n");
  const passageTitle = `REPLACE — Reading Passage ${passage.index} title`;

  return passage.taskGroups.map((task) => ({
    key: `reading-passage-${passage.index}-${task.key}`,
    title: passageTitle,
    instructions: task.instructions,
    // The schema has no shared-passage reference. Exact repetition allows the
    // existing preview adapter to cluster these task groups into one passage.
    passageText,
    contentHtml: contentHtmlFor(task),
    contentLayout: task.contentLayout ?? "document",
    audioScript: "",
    questions: numbers(task.start, task.end).map((number) => makeQuestion(task, number)),
  }));
}

function selectedPassages(id: ExamImportTemplateId): readonly PassageBlueprint[] {
  if (id === "academic-reading-full") return PASSAGES;
  const index = Number(id.at(-1));
  return PASSAGES.filter((passage) => passage.index === index);
}

function createWritingImportTemplate(
  id: ExamImportTemplateId,
  now: Date,
): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    packageId: `writing-full-${safeStamp(now)}`,
    revision: 1,
    profile: "practice",
    source: {
      kind: "provided_material",
      label: "Multi-Level Writing Template",
      notes: "Replace stimulus text and task prompts before publication.",
    },
    exam: {
      type: "multilevel",
      title: "REPLACE — Multi-Level Writing Practice",
      description: "60-minute Multi-Level writing test containing Tasks 1.1, 1.2 and Task 2.",
      level: "B1–C1",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections: [
        {
          key: "writing",
          skill: "writing",
          title: "Writing",
          instructions:
            "The Writing section consists of Task 1 (Informal and Formal letters) and Task 2 (Discursive essay). Total duration: 60 minutes.",
          durationMinutes: 60,
          groups: [
            {
              key: "writing-task-1-1",
              title: "Task 1.1 — Informal Letter",
              instructions: "Write an informal letter to your friend. Write at least 150 words.",
              passageText: "REPLACE — Shared stimulus for Task 1.1 and 1.2.",
              stimulusRef: "writing-task-1",
              maxScore: 5,
              questions: [
                {
                  key: "writing-q-1",
                  number: 1,
                  type: "essay_task1",
                  prompt: "REPLACE — Prompt for informal letter to a friend. Write at least 150 words.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 5,
                  wordLimit: 150,
                },
              ],
            },
            {
              key: "writing-task-1-2",
              title: "Task 1.2 — Formal Letter",
              instructions: "Write a formal email or letter. Write at least 150 words.",
              passageText: "REPLACE — Shared stimulus for Task 1.1 and 1.2.",
              stimulusRef: "writing-task-1",
              maxScore: 5,
              questions: [
                {
                  key: "writing-q-2",
                  number: 2,
                  type: "essay_task1",
                  prompt: "REPLACE — Prompt for formal email/letter. Write at least 150 words.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 5,
                  wordLimit: 150,
                },
              ],
            },
            {
              key: "writing-task-2",
              title: "Task 2 — Publication Essay",
              instructions: "Write an essay discussing both views and give your opinion. Write at least 250 words.",
              passageText: "",
              maxScore: 6,
              questions: [
                {
                  key: "writing-q-3",
                  number: 3,
                  type: "essay_task2",
                  prompt: "REPLACE — Prompt for Task 2 essay. Discuss both views and give your opinion. Write at least 250 words.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 6,
                  wordLimit: 250,
                },
              ],
            },
          ],
        },
      ],
    },
    media: [],
    reviewIssues: [
      {
        key: "replace-writing-placeholders",
        code: "OTHER",
        path: "/exam/sections/0",
        message: "Replace all writing task prompts and stimuli before publishing.",
        sourceRef: "Generated Multi-Level Writing template",
      },
    ],
  };
}

function createSpeakingImportTemplate(
  id: ExamImportTemplateId,
  now: Date,
): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    packageId: `speaking-full-${safeStamp(now)}`,
    revision: 1,
    profile: "practice",
    source: {
      kind: "provided_material",
      label: "Multi-Level Speaking Template",
      notes: "Replace interview questions, monologue cue card, and discussion questions.",
    },
    exam: {
      type: "multilevel",
      title: "REPLACE — Multi-Level Speaking Practice",
      description: "15-minute Speaking assessment with Part 1 (Interview), Part 2 (Monologue), and Part 3 (Discussion).",
      level: "B1–C1",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections: [
        {
          key: "speaking",
          skill: "speaking",
          title: "Speaking",
          instructions: "Ensure your microphone is tested and calibrated before starting the Speaking section.",
          durationMinutes: 15,
          groups: [
            {
              key: "speaking-part-1-1",
              title: "Part 1.1 — Personal Interview",
              instructions: "Answer the questions naturally and clearly.",
              maxScore: 5,
              questions: [
                {
                  key: "speaking-q-1",
                  number: 1,
                  type: "speaking_task",
                  prompt: "REPLACE — Speaking question 1: Personal interview.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 5,
                },
                {
                  key: "speaking-q-2",
                  number: 2,
                  type: "speaking_task",
                  prompt: "REPLACE — Speaking question 2: Personal interview.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 5,
                },
                {
                  key: "speaking-q-3",
                  number: 3,
                  type: "speaking_task",
                  prompt: "REPLACE — Speaking question 3: Personal interview.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 5,
                },
              ],
            },
            {
              key: "speaking-part-2",
              title: "Part 2 — Topic Monologue",
              instructions: "You will have 1 minute to prepare and 2 minutes to speak.",
              maxScore: 5,
              questions: [
                {
                  key: "speaking-q-4",
                  number: 4,
                  type: "speaking_task",
                  prompt: "REPLACE — Speaking Part 2 cue card: Describe an experience or project.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 5,
                },
              ],
            },
            {
              key: "speaking-part-3",
              title: "Part 3 — Discussion & Analysis",
              instructions: "Give in-depth answers analyzing broader social issues.",
              maxScore: 6,
              questions: [
                {
                  key: "speaking-q-5",
                  number: 5,
                  type: "speaking_task",
                  prompt: "REPLACE — Speaking Part 3 discussion question.",
                  options: [],
                  correctAnswers: [],
                  acceptedVariants: [],
                  points: 6,
                },
              ],
            },
          ],
        },
      ],
    },
    media: [],
    reviewIssues: [
      {
        key: "replace-speaking-placeholders",
        code: "OTHER",
        path: "/exam/sections/0",
        message: "Replace all speaking prompts and cue cards before publishing.",
        sourceRef: "Generated Multi-Level Speaking template",
      },
    ],
  };
}

function createMultilevelFullImportTemplate(now: Date): Record<string, unknown> {
  const listeningPkg = createListeningImportTemplate("listening-full", now) as {
    exam: { sections: Array<{ groups: unknown[] }> };
  };
  const readingPassages = PASSAGES;
  const writingPkg = createWritingImportTemplate("writing-full", now) as {
    exam: { sections: Array<{ groups: unknown[] }> };
  };
  const speakingPkg = createSpeakingImportTemplate("speaking-full", now) as {
    exam: { sections: Array<{ groups: unknown[] }> };
  };

  return {
    schemaVersion: "1.0",
    packageId: `multilevel-cbt-full-${safeStamp(now)}`,
    revision: 1,
    profile: "full_mock",
    source: {
      kind: "provided_material",
      label: "Multi-Level CEFR CBT Full Mock Template",
      notes:
        "Official 4-section CBT sequence: 1. Listening -> 2. Reading -> 3. Writing -> 4. Speaking. Replace all placeholders before publishing.",
    },
    exam: {
      type: "multilevel",
      title: "REPLACE — Multi-Level CEFR CBT Mock Exam",
      description:
        "Full 4-section CBT mock exam: Listening (45 min), Reading (60 min), Writing (60 min), and Speaking (15 min).",
      level: "B1–C1",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections: [
        {
          key: "listening",
          skill: "listening",
          title: "Listening",
          instructions: "You will hear each recording twice. Answer all 35 questions.",
          durationMinutes: 45,
          groups: listeningPkg.exam.sections[0].groups,
        },
        {
          key: "reading",
          skill: "reading",
          title: "Reading",
          instructions: "Spend about 60 minutes on Questions 1–35 based on the texts.",
          durationMinutes: 60,
          groups: readingPassages.flatMap(makePassageGroups),
        },
        writingPkg.exam.sections[0],
        speakingPkg.exam.sections[0],
      ],
    },
    media: [],
    reviewIssues: [
      {
        key: "replace-multilevel-full-placeholders",
        code: "OTHER",
        path: "/exam",
        message:
          "Replace and verify all placeholders across Listening, Reading, Writing, and Speaking before publishing.",
        sourceRef: "Generated Multi-Level CBT Full Mock template",
      },
    ],
  };
}

/**
 * Produces an import scaffold for IELTS or Multi-Level.
 */
export function createExamImportTemplate(
  id: ExamImportTemplateId,
  now = new Date(),
): Record<string, unknown> {
  if (id === "multilevel-full") {
    return createMultilevelFullImportTemplate(now);
  }
  if (id === "writing-full") {
    return createWritingImportTemplate(id, now);
  }
  if (id === "speaking-full") {
    return createSpeakingImportTemplate(id, now);
  }
  if (id.startsWith("listening-")) {
    return createListeningImportTemplate(id, now);
  }
  const passages = selectedPassages(id);
  const full = id === "academic-reading-full";
  const first = passages[0];
  const last = passages[passages.length - 1];
  const packageStem = full ? "academic-reading-full" : `reading-passage-${first.index}`;

  return {
    schemaVersion: "1.0",
    packageId: `${packageStem}-${safeStamp(now)}`,
    revision: 1,
    // This is a complete Reading component, not a four-skill IELTS mock.
    profile: "practice",
    source: {
      kind: "provided_material",
      label: full
        ? "IELTS Academic Reading — three-passage template"
        : `IELTS Academic Reading Passage ${first.index} template`,
      notes:
        "Replace every REPLACE placeholder with licensed or original material and supply source-verified answer keys before importing.",
    },
    exam: {
      type: "ielts_academic",
      title: full
        ? "REPLACE — IELTS Academic Reading Practice Test"
        : `REPLACE — IELTS Academic Reading Passage ${first.index}`,
      description: full
        ? "A 60-minute Academic Reading practice test with three passages and 40 questions."
        : `Single-passage Academic Reading practice for Questions ${first.start}–${last.end}.`,
      level: "Academic",
      isDemo: false,
      price: 0,
      isFreeForApproved: false,
      sections: [
        {
          key: "reading",
          skill: "reading",
          title: "Academic Reading",
          instructions: full
            ? "You should spend about 60 minutes on Questions 1–40, which are based on Reading Passages 1, 2 and 3. Answer all questions."
            : `You should spend about 20 minutes on Questions ${first.start}–${last.end}, which are based on Reading Passage ${first.index}.`,
          durationMinutes: full ? 60 : 20,
          groups: passages.flatMap(makePassageGroups),
        },
      ],
    },
    media: [],
    reviewIssues: [
      {
        key: "replace-template-placeholders",
        code: "OTHER",
        path: "/exam",
        message:
          "Template placeholders and sample answer keys must be replaced and verified against the source before publication.",
        sourceRef: "Generated IELTS Reading import template",
      },
    ],
  };
}

export function serializeExamImportTemplate(id: ExamImportTemplateId, now = new Date()): string {
  return `${JSON.stringify(createExamImportTemplate(id, now), null, 2)}\n`;
}
