import type { BuilderPart, BuilderQuestion } from "@/components/mock/exam-builder/types";
import type { MockContentLayout, MockQuestionType } from "@/lib/types";
import { sanitizeGappedContent } from "@/components/mock/gapped-content";

export interface QuestionFormatPreset { key: string; label: string; type: MockQuestionType; layout: MockContentLayout; reusable?: boolean; oneWord?: boolean }
export const QUESTION_FORMAT_PRESETS: QuestionFormatPreset[] = [
  { key: "mcq", label: "Multiple choice", type: "multiple_choice", layout: "document" },
  { key: "gap", label: "One word gap fill", type: "short_answer", layout: "document", oneWord: true },
  { key: "tfng", label: "True / False / Not Given", type: "true_false_notgiven", layout: "document" },
  { key: "headings", label: "Heading match", type: "matching_headings", layout: "headings", reusable: false },
  { key: "short_texts", label: "Short text matching", type: "matching", layout: "short_texts", reusable: false },
  { key: "paragraphs", label: "Paragraph / information matching", type: "matching", layout: "paragraphs", reusable: true },
  { key: "notes", label: "Note completion", type: "note_completion", layout: "notes" },
  { key: "sentences", label: "Sentence completion", type: "sentence_completion", layout: "sentences" },
  { key: "speakers", label: "Speaker matching", type: "matching", layout: "speakers", reusable: false },
  { key: "matching", label: "Matching", type: "matching", layout: "document", reusable: false },
  { key: "map", label: "Map / plan labeling", type: "map_labelling", layout: "map", reusable: false },
  { key: "multi_extract", label: "Multiple audio extracts: MCQ", type: "multiple_choice", layout: "multi_extract" },
  { key: "short", label: "Short answer", type: "short_answer", layout: "document" },
];

export function presetForPart(part: BuilderPart): QuestionFormatPreset | undefined {
  return QUESTION_FORMAT_PRESETS.find((p) => p.layout === (part.contentLayout ?? "document") && p.type === part.questions[0]?.type && !!p.oneWord === (part.questions[0]?.answerRule === "ONE_WORD"));
}

/** A preset configures new questions. Existing authored questions are never converted. */
export function applyFormatPreset(part: BuilderPart, preset: QuestionFormatPreset): BuilderPart {
  return { ...part, contentLayout: preset.layout, optionsReusable: preset.reusable ?? null };
}

export function applySharedOptionBank(questions: BuilderQuestion[], bank: string[]): BuilderQuestion[] {
  return questions.map((q) => ["matching", "matching_headings", "map_labelling"].includes(q.type) ? { ...q, options: [...bank] } : q);
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only numbered markers become markup; all authored prose is escaped. */
export function gapTextToHtml(text: string): string {
  if (!text.trim()) return "";
  return text.split(/\r?\n/).map((line) => `<p>${escapeText(line).replace(/\{(\d{1,3})\}/g, (marker, raw: string) => Number(raw) >= 1 && Number(raw) <= 200 ? `<span data-gap="${Number(raw)}"></span>` : marker)}</p>`).join("");
}

export function gapHtmlToText(html: string | undefined): string {
  return sanitizeGappedContent(html ?? "").replace(/<span data-gap="(\d+)"><\/span>/g, "{$1}").replace(/<\/(?:p|li|tr|h3|h4)>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
}
