import type { GroupAiRankingCohort, GroupAiRankingData, GroupAiRankingRow } from "./ai-ranking-types";
import { rankingScoreLabel, rankingStatusKey } from "./ai-ranking-types";
import { encodeCsv, type CsvCell } from "./csv-export";

export type GroupSkillGrade = { row: GroupAiRankingRow; cohort?: GroupAiRankingCohort };
export type GroupGradeSummary = { studentId: string; name: string; writing?: GroupSkillGrade; speaking?: GroupSkillGrade };
type Translate = (key: string) => string;

/** Each skill keeps its own latest attempt and comparable task scope. */
export function groupGradeRows(writing: GroupAiRankingData, speaking: GroupAiRankingData): GroupGradeSummary[] {
  if (writing.group.id !== speaking.group.id || !writing.selectedExamId || writing.selectedExamId !== speaking.selectedExamId || writing.skill !== "writing" || speaking.skill !== "speaking") return [];
  const students = new Map<string, GroupGradeSummary>();
  for (const data of [writing, speaking]) {
    for (const item of [...data.cohorts.flatMap(cohort => cohort.rows.map(row => ({ row, cohort }))), ...data.unranked.map(row => ({ row }))]) {
      const student = students.get(item.row.studentId) ?? { studentId: item.row.studentId, name: item.row.name };
      student[data.skill] = item;
      students.set(student.studentId, student);
    }
  }
  return [...students.values()].sort((a, b) => a.name.localeCompare(b.name) || a.studentId.localeCompare(b.studentId));
}

export function finalGradeLabel(grade?: GroupSkillGrade): string {
  if (!grade || grade.row.finalScore == null) return "—";
  return rankingScoreLabel(grade.row.finalPracticeGrade?.score ?? grade.row.finalScore,
    grade.row.finalPracticeGrade?.scaleMax ?? grade.row.finalScoreScaleMax);
}

function scoreCell(value: number | null | undefined, maximum?: number | null): string {
  return value == null || !Number.isFinite(value) ? "" : rankingScoreLabel(value, maximum);
}

export function groupGradesCsv(writing: GroupAiRankingData, speaking: GroupAiRankingData, t: Translate): string {
  const columns = ["exportRank", "aiScore", "rawScore", "teacherScore", "finalScore", "exportSource", "status", "exportConfidence", "exportReview", "exportScope", "exportAttempt"];
  const headers: CsvCell[] = [t("student"), t("exam"), ...(["writing", "speaking"] as const).flatMap(skill => columns.map(column => `${t(skill)} · ${column === "status" ? t("aiScore") + " / " + t("status") : t(column)}`))];
  const cells = (grade?: GroupSkillGrade): CsvCell[] => {
    if (!grade) return columns.map(() => "");
    const { row, cohort } = grade;
    const finalized = row.finalScore != null;
    const source = !finalized || !row.finalScoreSource ? "" : t(row.finalScoreSource === "TEACHER" ? "sourceTeacher" : row.finalScoreSource === "ADJUDICATED" ? "sourceAdjudicated" : "sourceAi");
    return [row.eligible ? row.rank : null, scoreCell(row.aiScore, cohort?.scaleMax), scoreCell(row.aiRawScore, cohort?.rawMax),
      scoreCell(row.teacherScore, row.finalScoreScaleMax), finalized ? finalGradeLabel(grade) : "", source,
      t(rankingStatusKey(row)), row.confidence, t(row.reviewRequired ? "exportYes" : "exportNo"),
      cohort ? `${cohort.label} · ${cohort.specificationVersion ?? ""} · ${cohort.id}` : "", row.attemptId];
  };
  const exam = writing.exams.find(item => item.id === writing.selectedExamId);
  return encodeCsv([headers, ...groupGradeRows(writing, speaking).map(student => [student.name, exam?.title ?? writing.selectedExamId, ...cells(student.writing), ...cells(student.speaking)])]);
}

export function groupLeaderboardExcelCsv(
  writing: GroupAiRankingData,
  speaking: GroupAiRankingData,
  phoneMap?: Map<string, string>,
  t?: Translate
): string {
  const headers: CsvCell[] = [
    "O'rin",
    "O'quvchi ismi",
    "Telefon raqam",
    "Writing balli",
    "Speaking balli",
    "Listening balli",
    "Reading balli",
    "Umumiy ball",
    "CEFR darajasi",
    "Holati",
  ];

  const students = groupGradeRows(writing, speaking);

  const rows = students.map((st) => {
    const wScore = st.writing?.row.finalPracticeGrade?.score ?? st.writing?.row.finalScore ?? st.writing?.row.aiScore ?? null;
    const sScore = st.speaking?.row.finalPracticeGrade?.score ?? st.speaking?.row.finalScore ?? st.speaking?.row.aiScore ?? null;

    let overallScore: number | null = null;
    if (wScore != null && sScore != null) {
      overallScore = Math.round(((wScore + sScore) / 2) * 10) / 10;
    } else if (wScore != null) {
      overallScore = wScore;
    } else if (sScore != null) {
      overallScore = sScore;
    }

    let cefrLevel = "—";
    if (overallScore != null) {
      if (overallScore >= 60) cefrLevel = "C1";
      else if (overallScore >= 45) cefrLevel = "B2";
      else if (overallScore >= 35) cefrLevel = "B1";
      else cefrLevel = "A2";
    }

    const rank = st.writing?.row.rank ?? st.speaking?.row.rank ?? null;
    const phone = phoneMap?.get(st.studentId) ?? "—";
    const writingLabel = st.writing ? finalGradeLabel(st.writing) : "—";
    const speakingLabel = st.speaking ? finalGradeLabel(st.speaking) : "—";
    const overallLabel = overallScore != null ? String(overallScore) : "—";

    const statusRow = st.writing?.row ?? st.speaking?.row;
    let statusLabel = "Kutilmoqda";
    if (statusRow) {
      const key = rankingStatusKey(statusRow);
      statusLabel = t ? t(key) : key;
      if (statusLabel === "graded") statusLabel = "Baholangan";
      else if (statusLabel === "notAttempted") statusLabel = "Topshirmagan";
      else if (statusLabel === "inProgress") statusLabel = "Topshirmoqda";
      else if (statusLabel === "reviewRequired") statusLabel = "Tekshiruv kutilmoqda";
    }

    return {
      rank,
      overallScore,
      cells: [
        rank != null ? rank : "—",
        st.name,
        phone,
        writingLabel,
        speakingLabel,
        "—",
        "—",
        overallLabel,
        cefrLevel,
        statusLabel,
      ] as CsvCell[],
    };
  });

  rows.sort((a, b) => {
    if (a.overallScore != null && b.overallScore != null) {
      return b.overallScore - a.overallScore;
    }
    if (a.overallScore != null) return -1;
    if (b.overallScore != null) return 1;
    return 0;
  });

  rows.forEach((r, idx) => {
    if (r.overallScore != null && (r.cells[0] === "—" || r.cells[0] == null)) {
      r.cells[0] = idx + 1;
    }
  });

  return encodeCsv([headers, ...rows.map((r) => r.cells)]);
}
