"use client";

import { useTranslations } from "next-intl";
import type { MockAttemptSummary, MockPracticeSkill } from "@/lib/types";

const INTERNAL_POLICY = "BESTWAY_INTERNAL_PRACTICE_35_50_V1";
const ALL_SKILLS: MockPracticeSkill[] = ["listening", "reading", "writing", "speaking"];
type ScoreSummary = Pick<
  MockAttemptSummary,
  "examType" | "status" | "flowMode" | "practiceScope" | "rawScores" | "overallScore" | "cefrLevel" | "overallBand"
> & {
  singleSection?: string;
  isSingleSection?: boolean;
  attemptTypeLabel?: string;
};

/** Histories show persisted skill grades, clearly distinguishing Single Section vs Full Mock. */
export function AttemptScoreSummary({ attempt }: { attempt: ScoreSummary }) {
  const t = useTranslations("mock");
  const internal =
    attempt.examType === "multilevel" &&
    ALL_SKILLS.some(
      (skill) => attempt.rawScores?.[skill]?.practiceGrade?.policyId === INTERNAL_POLICY
    );
  const partial = attempt.flowMode === "partial_practice";
  const scopeSkills = attempt.practiceScope?.skills ?? [];
  const isSingle =
    attempt.isSingleSection ||
    !!attempt.singleSection ||
    (partial && scopeSkills.length === 1);
  const singleSkillName =
    attempt.singleSection || (scopeSkills.length === 1 ? scopeSkills[0] : null);

  if (internal || partial) {
    const skills = ALL_SKILLS.filter(
      (skill) => scopeSkills.includes(skill) || attempt.rawScores?.[skill] != null
    );

    return (
      <span
        className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm tabular-nums"
        aria-label={t(internal ? "internalPracticeScore" : "partialPracticeResult")}
      >
        <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-brand-subtle-fg">
          {isSingle && singleSkillName
            ? `Single Section: ${singleSkillName.charAt(0).toUpperCase() + singleSkillName.slice(1)}`
            : "Section Practice"}
        </span>

        {skills.length === 0 ? (
          <span className="text-fg-muted">{t("awaitingGrade")}</span>
        ) : (
          skills.map((skill) => {
            const raw = attempt.rawScores?.[skill];
            const grade = raw?.practiceGrade;
            const internalGrade = grade?.policyId === INTERNAL_POLICY ? grade : null;
            const historicalRaw = attempt.status === "completed" && raw != null && raw.max > 0;
            return (
              <span key={skill} className="text-fg-muted">
                {t(`skills.${skill}`)}:{" "}
                <strong className="font-semibold text-brand">
                  {internalGrade
                    ? `${internalGrade.score} /${internalGrade.scaleMax}`
                    : historicalRaw
                    ? `${raw.score} /${raw.max}`
                    : t("awaitingGrade")}
                </strong>
              </span>
            );
          })
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-600 dark:text-sky-400">
        Full Mock
      </span>
      {attempt.examType === "multilevel" ? (
        <span className="font-semibold text-brand tabular-nums">
          {attempt.overallScore != null ? `${attempt.overallScore}/75` : attempt.cefrLevel ? "" : "—"}
          {attempt.cefrLevel ? `${attempt.overallScore != null ? " · " : ""}${attempt.cefrLevel}` : ""}
        </span>
      ) : (
        <span className="font-semibold text-brand tabular-nums">
          {attempt.overallBand != null
            ? `${t("overallBand")}: ${attempt.overallBand.toFixed(1)}`
            : t("awaitingGrade")}
        </span>
      )}
    </span>
  );
}
