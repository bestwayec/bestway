/** Vocabulary Exam 3.0 question types (mirrors backend `vocabulary_questions.py`). */

export type QuizQuestionType =
  | "eng_uzb" | "uzb_eng" | "spelling"
  | "listen_choose" | "listen_type" | "fill_blank" | "context_meaning" | "synonym";

/** Questions answered by typing (the rest choose an option). */
export const TYPED_TYPES: ReadonlySet<QuizQuestionType> = new Set(["spelling", "listen_type", "fill_blank"]);
export const LISTENING_TYPES: ReadonlySet<QuizQuestionType> = new Set(["listen_choose", "listen_type"]);

/**
 * The English text that may be spoken for a question without giving the answer away:
 * the heard word for listening types, the prompt word where the prompt is English.
 * uzb_eng / spelling / fill_blank ask for the English word, so nothing is spoken.
 */
export function speakableText(q: { type: QuizQuestionType; prompt: string; speak?: string | null }): string | null {
  if (LISTENING_TYPES.has(q.type)) return q.speak ?? null;
  if (q.type === "eng_uzb" || q.type === "context_meaning" || q.type === "synonym") return q.prompt || null;
  return null;
}
