import { examContentUnits, type ContentGroup } from "@/lib/exam-content-units";

export interface ReadingClusterGroup extends ContentGroup {
  title?: string | null;
  passageText?: string | null;
  questions: Array<{ number: number }>;
}

export interface ReadingPassageCluster<T extends ReadingClusterGroup> {
  ordinal: number;
  title: string | null;
  passageText: string | null;
  groups: T[];
  questions: T["questions"];
  min: number | null;
  max: number | null;
  rangeLabel: string | null;
}

export function clusterReadingPassages<T extends ReadingClusterGroup>(
  groups: readonly T[],
): ReadingPassageCluster<T>[] {
  return examContentUnits(groups, "reading").map(({ groups: passageGroups, source, number }) => {
    const questions = passageGroups.flatMap((group) => group.questions);
    const numbers = questions.map((question) => question.number);
    const min = numbers.length > 0 ? Math.min(...numbers) : null;
    const max = numbers.length > 0 ? Math.max(...numbers) : null;

    return {
      ordinal: number,
      title: source.title?.trim() || null,
      passageText: source.passageText?.trim() ? source.passageText : null,
      groups: passageGroups,
      questions,
      min,
      max,
      rangeLabel:
        min == null || max == null
          ? null
          : min === max
            ? `${min}`
            : `${min}–${max}`,
    };
  });
}
