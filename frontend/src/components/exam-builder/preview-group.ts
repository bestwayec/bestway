import type { PreviewGroup, PreviewQuestion } from "./StudentPreview";

export interface PreviewGroupSource extends Partial<Omit<PreviewGroup, "id" | "questions">> {
  id: string;
  questions?: Array<
    Pick<PreviewQuestion, "id" | "number" | "type" | "prompt"> &
    Partial<Pick<PreviewQuestion, "options" | "points" | "wordLimit" | "answerRule">>
  >;
}

/** Keep interaction metadata while explicitly excluding author answer keys. */
export function toPreviewGroup(group: PreviewGroupSource): PreviewGroup {
  return {
    id: group.id,
    title: group.title ?? null,
    instructions: group.instructions ?? null,
    passageText: group.passageText ?? null,
    contentHtml: group.contentHtml ?? null,
    contentLayout: group.contentLayout ?? null,
    optionsReusable: group.optionsReusable ?? null,
    hasAudio: !!group.hasAudio,
    imageUrl: group.imageUrl ?? null,
    questions: (group.questions ?? []).map((question) => ({
      id: question.id,
      number: question.number,
      type: question.type,
      prompt: question.prompt,
      options: question.options ?? null,
      points: question.points ?? 1,
      wordLimit: question.wordLimit ?? null,
      answerRule: question.answerRule ?? null,
    })),
  };
}
