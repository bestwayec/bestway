"use client";

import { useTranslations } from "next-intl";
import type { MockAttemptSummary, MockPracticeSkill } from "@/lib/types";

const INTERNAL_POLICY = "BESTWAY_INTERNAL_PRACTICE_35_50_V1";
const MANUAL_SKILLS: MockPracticeSkill[] = ["writing", "speaking"];
type ScoreSummary = Pick<MockAttemptSummary, "examType" | "status" | "flowMode" | "practiceScope" | "rawScores" | "overallScore" | "cefrLevel" | "overallBand">;

/** Histories show persisted skill grades, never invent a combined practice score. */
export function AttemptScoreSummary({ attempt }: { attempt: ScoreSummary }) {
  const t = useTranslations("mock");
  const internal = attempt.examType === "multilevel" && MANUAL_SKILLS.some((skill) =>
    attempt.rawScores?.[skill]?.practiceGrade?.policyId === INTERNAL_POLICY);
  const partial = attempt.flowMode === "partial_practice";

  if (internal || partial) {
    const skills = MANUAL_SKILLS.filter((skill) => attempt.practiceScope?.skills.includes(skill) || attempt.rawScores?.[skill] != null);
    return <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm tabular-nums" aria-label={t(internal ? "internalPracticeScore" : "partialPracticeResult")}>
      {internal && <span className="text-xs text-fg-muted">{t("internalPracticeScore")}</span>}
      {skills.length === 0 ? t("awaitingGrade") : skills.map((skill) => {
        const raw = attempt.rawScores?.[skill];
        const grade = raw?.practiceGrade;
        const internalGrade = grade?.policyId === INTERNAL_POLICY ? grade : null;
        // Partial raw aggregates exist even while manual marking is pending.
        // Preserve old completed raw results, without presenting partial sums as grades.
        const historicalRaw = !internal && attempt.status === "completed" && raw != null && raw.max > 0;
        return <span key={skill}>{t(`skills.${skill}`)}: <strong className="font-semibold text-brand">{internalGrade
          ? `${internalGrade.score} /${internalGrade.scaleMax}`
          : historicalRaw ? `${raw.score} /${raw.max}` : t("awaitingGrade")}</strong></span>;
      })}
    </span>;
  }

  if (attempt.examType === "multilevel") return <span className="font-semibold text-brand tabular-nums">
    {attempt.overallScore != null ? `${attempt.overallScore}/75` : attempt.cefrLevel ? "" : "—"}
    {attempt.cefrLevel ? `${attempt.overallScore != null ? " · " : ""}${attempt.cefrLevel}` : ""}
  </span>;
  return <span className="font-semibold text-brand tabular-nums">{attempt.overallBand != null ? `${t("overallBand")}: ${attempt.overallBand.toFixed(1)}` : t("awaitingGrade")}</span>;
}
