import { MockExamType, MockQuestionType, MockSkill } from '@prisma/client';
import { MULTILEVEL_AUDIO, MULTILEVEL_SPECIFICATION, MULTILEVEL_VERSION, taskGuidance } from './multilevel-specification';
import { MULTILEVEL_SPEAKING_V2, BESTWAY_MULTILEVEL_SPEAKING_2026_V2 } from './multilevel-speaking-profile';

/**
 * Exam tuzilmasini javobga o'girish — sof funksiyalar.
 * includeAnswers=false bo'lsa o'quvchiga to'g'ri javob YUBORILMAYDI.
 */

export interface QuestionRow {
  id: string;
  number: number;
  sortOrder: number;
  type: MockQuestionType;
  prompt: string;
  options: unknown;
  correctAnswers: unknown;
  acceptedVariants: unknown;
  points: number;
  wordLimit: number | null;
}

export interface GroupRow {
  id: string;
  sortOrder: number;
  title: string | null;
  instructions: string | null;
  passageText: string | null;
  contentHtml: string | null;
  audioScript: string | null;
  contentLayout: string | null;
  audioKey: string | null;
  imageKey: string | null;
  partNumber: number | null;
  audioDurationSec: number | null;
  audioPlayLimit: number;
  questions: QuestionRow[];
}

export interface SectionRow {
  id: string;
  skill: MockSkill;
  title: string | null;
  sortOrder: number;
  durationMinutes: number | null;
  instructions: string | null;
  groups: GroupRow[];
}

export interface ExamRow {
  id: string;
  specificationVersion?: string | null;
  speakingProfileVersion?: string | null;
  assessmentPolicy?: string | null;
  type: MockExamType;
  title: string;
  description: string | null;
  level: string | null;
  isPublished: boolean;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic content version (stale-tab save guard). Defaults to 1. */
  contentVersion?: number;
  sections: SectionRow[];
}

function asStringArray(v: unknown): string[] | null {
  return Array.isArray(v) ? (v as string[]) : null;
}

export function shapeQuestion(q: QuestionRow, includeAnswers: boolean) {
  return {
    id: q.id,
    number: q.number,
    sortOrder: q.sortOrder,
    type: q.type,
    prompt: q.prompt,
    options: asStringArray(q.options),
    points: q.points,
    wordLimit: q.wordLimit,
    ...(includeAnswers
      ? {
          correctAnswers: asStringArray(q.correctAnswers),
          acceptedVariants: asStringArray(q.acceptedVariants),
        }
      : {}),
  };
}

export function shapeGroup(g: GroupRow, includeAnswers: boolean, base: string) {
  return {
    id: g.id,
    sortOrder: g.sortOrder,
    title: g.title,
    instructions: g.instructions,
    passageText: g.passageText,
    contentHtml: g.contentHtml,
    contentLayout: g.contentLayout,
    hasAudio: !!g.audioKey,
    audioUrl: g.audioKey ? `${base}/mock/groups/${g.id}/audio` : null,
    imageUrl: g.imageKey ? `${base}/mock/groups/${g.id}/image` : null,
    partNumber: g.partNumber,
    audioDurationSec: g.audioDurationSec,
    audioPlayLimit: g.audioPlayLimit,
    questions: [...g.questions]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
      .map((q) => shapeQuestion(q, includeAnswers)),
    ...(includeAnswers ? { audioScript: g.audioScript } : {}),
  };
}

export function shapeSection(s: SectionRow, includeAnswers: boolean, base: string, multilevel = false, speakingProfileVersion?: string | null) {
  return {
    id: s.id,
    skill: s.skill,
    title: s.title,
    sortOrder: s.sortOrder,
    durationMinutes: s.durationMinutes,
    instructions: s.instructions,
    groups: [...s.groups]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g, index) => {
        const shaped = shapeGroup(g, includeAnswers, base);
        if (!multilevel) return shaped;
        return { ...shaped,
          passageText: s.skill === 'listening' && !includeAnswers ? null : shaped.passageText,
          audioPlayLimit: s.skill === 'listening' ? MULTILEVEL_AUDIO.playLimit : shaped.audioPlayLimit,
          questions: shaped.questions.map((q, qi) => ({ ...q, guidance: taskGuidance(s.skill, index, qi, speakingProfileVersion) })),
        };
      }),
  };
}

export function countQuestions(exam: ExamRow): number {
  return exam.sections.reduce(
    (sum, s) => sum + s.groups.reduce((gs, g) => gs + g.questions.length, 0),
    0,
  );
}

export function shapeExam(exam: ExamRow, includeAnswers: boolean, base: string) {
  return {
    id: exam.id,
    type: exam.type,
    speakingProfileVersion: exam.speakingProfileVersion ?? null,
    ...(includeAnswers ? { assessmentPolicy: exam.assessmentPolicy ?? null } : {}),
    ...(exam.speakingProfileVersion === BESTWAY_MULTILEVEL_SPEAKING_2026_V2 ? { speakingProfile: MULTILEVEL_SPEAKING_V2 } : {}),
    ...(exam.type === 'multilevel' && exam.specificationVersion === MULTILEVEL_VERSION ? { specificationVersion: exam.specificationVersion, specification: MULTILEVEL_SPECIFICATION } : {}),
    profile: (exam as { profile?: string }).profile ?? 'practice',
    title: exam.title,
    description: exam.description,
    level: exam.level,
    isPublished: exam.isPublished,
    isDemo: exam.isDemo,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
    contentVersion: exam.contentVersion ?? 1,
    questionCount: countQuestions(exam),
    sections: [...exam.sections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => shapeSection(s, includeAnswers, base, exam.type === 'multilevel' && exam.specificationVersion === MULTILEVEL_VERSION, exam.speakingProfileVersion)),
  };
}

/** `totalDuration` uchun minimal kirish shakli — display hisobi audio va
 * skill'ga bog'liq, shuning uchun to'liq `ExamRow` shart emas. */
export interface DurationSectionInput {
  skill: MockSkill;
  durationMinutes?: number | null;
  groups?: Array<{ audioDurationSec?: number | null }>;
}

/** Bo'lim bo'yicha jami vaqt (daqiqa) — imtihon davomiyligi taxminiy hisobi.
 * FAQAT ko'rinish uchun (exam list kartalari, "X min"). Timed deadline
 * hisobi uchun ishlatilmaydi — deadline `computeSkillTiming` orqali
 * skill-specific hisoblanadi (listening = audio, speaking = yo'q).
 *
 * `computeSkillTiming()` BILAN SINXRON SAQLANSIN: listening bo'limining
 * saqlangan `durationMinutes` qiymati taymerda HECH QACHON ishlatilmaydi,
 * shuning uchun u bu yig'indiga HAM kiritilmaydi — o'rniga audio yig'indisi
 * + `LISTENING_REVIEW_SEC` (daqiqaga yaxlitlangan) olinadi. Speaking
 * untimed bo'lgani uchun 0 hissa qo'shadi. Reading/writing da
 * `durationMinutes` bo'lmasa `computeSkillTiming` dagi kabi 60min default
 * qo'llanadi. Bu funksiyani o'zgartirsangiz `computeSkillTiming` ni ham
 * tekshiring (va aksincha). */
export function totalDuration(exam: { type?: MockExamType; sections: DurationSectionInput[] }): number | null {
  if (exam.type === 'multilevel') return exam.sections.reduce((sum, sec) => sum + MULTILEVEL_SPECIFICATION[sec.skill].durationSeconds / 60, 0) || null;
  let sum = 0;
  for (const sec of exam.sections) {
    if (sec.skill === 'listening') {
      const audioSec = (sec.groups ?? []).reduce((s, g) => s + (g.audioDurationSec ?? 0), 0);
      sum += Math.ceil(
        ((audioSec > 0 ? audioSec : FALLBACK_LISTENING_SEC) + LISTENING_REVIEW_SEC) / 60,
      );
    } else if (sec.skill === 'speaking') {
      continue;
    } else {
      sum +=
        sec.durationMinutes ?? (sec.skill === 'reading' ? DEFAULT_READING_MIN : DEFAULT_WRITING_MIN);
    }
  }
  return sum > 0 ? sum : null;
}

/* ── IELTS skill-specific timing (full_test + single_skill, mode=timed) ── */

/** IELTS full-test/listening review vaqti — audio tugagach 2 daqiqa. */
export const LISTENING_REVIEW_SEC = 120;
/** Reading/Writing default bo'lim vaqti — section.durationMinutes bo'lmasa. */
export const DEFAULT_READING_MIN = 60;
export const DEFAULT_WRITING_MIN = 60;
/** Listening fallback — audioDurationSec kiritilmagan bo'lsa ~30 min. */
export const FALLBACK_LISTENING_SEC = 30 * 60;

/** Bo'limlarning skill bo'yicha qat'iy tartibi (deadline hisoblash uchun). */
export const SKILL_ORDER = ['listening', 'reading', 'writing', 'speaking'] as const;
export type TimedSkill = (typeof SKILL_ORDER)[number];

export interface SkillTimingInput {
  durationMinutes?: number | null;
  groups?: Array<{ audioDurationSec?: number | null }>;
}

/**
 * Bitta skill uchun timed deadline (IELTS qoidalari, sof funksiya):
 * - listening: guruhlardagi `audioDurationSec` yig'indisi + 120s review.
 *   Audio kiritilmagan bo'lsa 30min fallback. `durationMinutes` HECH QACHON
 *   ishlatilmaydi.
 * - reading/writing: `durationMinutes` (bo'lmasa 60min default) — qat'iy countdown.
 * - speaking: deadline yo'q ({seconds/deadline: null}) — o'quvchi o'zi submit qiladi.
 * `fromTs` — deadline shu timestamp'dan boshlab hisoblanadi (full_test da
 * zanjirlash uchun oldingi bo'lim oxiri, single_skill da start vaqti).
 */
export function computeSkillTiming(
  skill: TimedSkill,
  section: SkillTimingInput | undefined,
  fromTs: number,
  examType?: MockExamType,
): { seconds: number | null; deadline: Date | null } {
  if (examType === 'multilevel') {
    if (!section) return { seconds: null, deadline: null };
    const seconds = MULTILEVEL_SPECIFICATION[skill].durationSeconds;
    return { seconds, deadline: new Date(fromTs + seconds * 1000) };
  }
  if (skill === 'speaking') return { seconds: null, deadline: null };
  if (skill === 'listening') {
    const audioSec = (section?.groups ?? []).reduce((sum, g) => sum + (g.audioDurationSec ?? 0), 0);
    const seconds = (audioSec > 0 ? audioSec : FALLBACK_LISTENING_SEC) + LISTENING_REVIEW_SEC;
    return { seconds, deadline: new Date(fromTs + seconds * 1000) };
  }
  const minutes =
    section?.durationMinutes ?? (skill === 'reading' ? DEFAULT_READING_MIN : DEFAULT_WRITING_MIN);
  return { seconds: minutes * 60, deadline: new Date(fromTs + minutes * 60_000) };
}

/** Kirish huquqi yo'q o'quvchiga — tarkibsiz (sections/savollar/passages) metadata */
export function shapeExamMeta(exam: ExamRow) {
  return {
    id: exam.id,
    type: exam.type,
    title: exam.title,
    description: exam.description,
    level: exam.level,
    isPublished: exam.isPublished,
    isDemo: exam.isDemo,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
    contentVersion: exam.contentVersion ?? 1,
    questionCount: countQuestions(exam),
    durationMinutes: totalDuration(exam),
    sections: [],
  };
}
