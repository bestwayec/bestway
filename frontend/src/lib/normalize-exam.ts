import type { MockExamDetail, MockGroup, MockQuestion, MockSection, MockSkill } from "./types";

/**
 * Robust normalizer for exam payloads from the backend.
 * Handles all backend variants:
 * - res.data.exam.questions
 * - res.data.questions
 * - res.data.sections (with parts or groups)
 * - res.exam / res.sections / res.parts
 * - snake_case (duration_minutes, time_limit, question_type, passage_text)
 */
export function normalizeExamPayload(raw: any): MockExamDetail | null {
  if (!raw || typeof raw !== "object") {
    console.error("[normalizeExamPayload] Invalid payload: raw is not an object", raw);
    return null;
  }

  // Unwrap potential ApiResponse envelope
  const payload = raw.data !== undefined ? raw.data : raw;
  const examObj = (payload && typeof payload === "object" && payload.exam) ? payload.exam : payload;

  if (!examObj || typeof examObj !== "object") {
    console.error("[normalizeExamPayload] Cannot find exam object in payload", raw);
    return null;
  }

  // Determine sections
  const rawSections: any[] = Array.isArray(payload.sections)
    ? payload.sections
    : Array.isArray(examObj.sections)
    ? examObj.sections
    : Array.isArray(raw.sections)
    ? raw.sections
    : [];

  const rawParts: any[] = Array.isArray(payload.parts)
    ? payload.parts
    : Array.isArray(examObj.parts)
    ? examObj.parts
    : Array.isArray(raw.parts)
    ? raw.parts
    : [];

  const rawQuestions: any[] = Array.isArray(payload.questions)
    ? payload.questions
    : Array.isArray(examObj.questions)
    ? examObj.questions
    : Array.isArray(raw.questions)
    ? raw.questions
    : [];

  let normalizedSections: MockSection[] = [];

  if (rawSections.length > 0) {
    normalizedSections = rawSections.map((s: any, sIdx: number) => {
      const skill: MockSkill = (s.skill || (s.title ? s.title.toLowerCase() : "listening")) as MockSkill;
      const rawGroups = Array.isArray(s.groups) && s.groups.length > 0
        ? s.groups
        : Array.isArray(s.parts) && s.parts.length > 0
        ? s.parts
        : Array.isArray(s.items) && s.items.length > 0
        ? s.items
        : [];

      // If section has no groups but has questions directly
      const sectionQuestions = Array.isArray(s.questions) ? s.questions : [];
      let groupsToMap = rawGroups;
      if (groupsToMap.length === 0 && sectionQuestions.length > 0) {
        groupsToMap = [{
          id: `${s.id || sIdx}-g1`,
          title: s.title || `${skill} Section`,
          questions: sectionQuestions,
        }];
      }

      const groups: MockGroup[] = groupsToMap.map((g: any, gIdx: number) => {
        const rawQs: any[] = Array.isArray(g.questions)
          ? g.questions
          : Array.isArray(g.items)
          ? g.items
          : [];

        const questions: MockQuestion[] = rawQs.map((q: any, qIdx: number) => {
          const prompt = q.prompt ?? q.text ?? "";
          const text = q.text ?? q.prompt ?? "";
          const qType = q.type || q.kind || q.questionType || "single_choice";
          const rawOptions = Array.isArray(q.options)
            ? q.options
            : Array.isArray(q.payload?.options)
            ? q.payload.options
            : [];

          return {
            id: String(q.id || `q-${sIdx}-${gIdx}-${qIdx}`),
            number: typeof q.number === "number" ? q.number : q.order ?? (qIdx + 1),
            ...(typeof q.displayNumber === "number" ? { displayNumber: q.displayNumber } : {}),
            sortOrder: q.sortOrder ?? q.order ?? qIdx,
            prompt,
            text,
            type: qType,
            kind: q.kind || qType,
            questionType: qType,
            options: rawOptions,
            points: typeof q.points === "number" ? q.points : q.score ?? 1,
            score: typeof q.score === "number" ? q.score : q.points ?? 1,
            maxScore: typeof q.maxScore === "number" ? q.maxScore : q.points ?? 1,
            wordLimit: q.wordLimit ?? q.word_limit ?? null,
            answerRule: q.answerRule ?? q.answer_rule ?? null,
            guidance: q.guidance ?? undefined,
            payload: q.payload || {},
          } as MockQuestion;
        });

        const partNum = typeof g.partNumber === "number" ? g.partNumber : g.part_number ?? (gIdx + 1);

        return {
          id: String(g.id || `${s.id || sIdx}-g-${gIdx}`),
          key: g.key || g.id || `grp-${gIdx}`,
          label: g.label || `Part ${partNum}`,
          partNumber: partNum,
          sortOrder: g.sortOrder ?? g.sort_order ?? gIdx,
          title: g.title || `Part ${partNum}`,
          instructions: g.instructions || "",
          passageText: g.passageText ?? g.passage_text ?? "",
          passageHtml: g.passageHtml ?? g.passage_html ?? "",
          contentHtml: g.contentHtml ?? g.content_html ?? null,
          contentLayout: g.contentLayout || null,
          audioUrl: g.audioUrl ?? g.audio_url ?? null,
          imageUrl: g.imageUrl ?? g.image_url ?? null,
          hasAudio: Boolean(g.hasAudio || g.audioUrl || g.audio_url),
          audioDurationSec: g.audioDurationSec ?? null,
          audioPlayLimit: g.audioPlayLimit ?? 1,
          strictAudio: Boolean(g.strictAudio ?? g.strict_audio ?? false),
          questions,
          items: questions,
        } as MockGroup;
      });

      const durationMin = s.durationMinutes ?? s.duration_minutes ?? s.timeLimit ?? s.time_limit ?? 45;

      return {
        id: String(s.id || `sec-${sIdx}-${skill}`),
        skill,
        title: s.title || `${skill.charAt(0).toUpperCase() + skill.slice(1)}`,
        order: s.order ?? s.sortOrder ?? s.sort_order ?? sIdx,
        sortOrder: s.sortOrder ?? s.sort_order ?? s.order ?? sIdx,
        instructions: s.instructions || "",
        durationMinutes: durationMin,
        timeLimit: s.timeLimit ?? s.time_limit ?? durationMin,
        groups,
        parts: groups,
        questionCount: groups.reduce((acc, grp) => acc + grp.questions.length, 0),
      } as MockSection;
    });
  } else if (rawParts.length > 0) {
    // If parts are flat at root level
    const defaultSec: MockSection = {
      id: "sec-default",
      skill: "listening",
      title: "Exam Questions",
      order: 0,
      sortOrder: 0,
      instructions: "",
      durationMinutes: 150,
      timeLimit: 150,
      groups: rawParts.map((p: any, pIdx: number) => ({
        id: String(p.id || `part-${pIdx}`),
        key: p.key || `part-${pIdx}`,
        label: p.label || `Part ${pIdx + 1}`,
        partNumber: p.partNumber || pIdx + 1,
        sortOrder: pIdx,
        title: p.title || `Part ${pIdx + 1}`,
        instructions: p.instructions || "",
        passageText: p.passageText ?? p.passage_text ?? "",
        passageHtml: p.passageHtml ?? p.passage_html ?? "",
        contentHtml: p.contentHtml ?? p.content_html ?? null,
        contentLayout: p.contentLayout || null,
        audioUrl: p.audioUrl ?? p.audio_url ?? null,
        imageUrl: p.imageUrl ?? p.image_url ?? null,
        hasAudio: Boolean(p.hasAudio || p.audioUrl || p.audio_url),
        audioDurationSec: p.audioDurationSec ?? null,
        audioPlayLimit: p.audioPlayLimit ?? 1,
        strictAudio: Boolean(p.strictAudio ?? p.strict_audio ?? false),
        questions: (p.questions || []).map((q: any, qIdx: number) => ({
          id: String(q.id || `q-${pIdx}-${qIdx}`),
          number: q.number ?? (qIdx + 1),
          sortOrder: qIdx,
          prompt: q.prompt ?? q.text ?? "",
          text: q.text ?? q.prompt ?? "",
          type: q.type || q.kind || "single_choice",
          kind: q.kind || q.type || "single_choice",
          questionType: q.type || q.kind || "single_choice",
          options: Array.isArray(q.options) ? q.options : [],
          points: q.points ?? 1,
          score: q.score ?? 1,
          maxScore: q.maxScore ?? 1,
          wordLimit: null,
          answerRule: null,
          guidance: undefined,
        })),
        items: [],
      })),
      parts: [],
      questionCount: 0,
    };
    defaultSec.parts = defaultSec.groups;
    defaultSec.questionCount = defaultSec.groups.reduce((acc, g) => acc + g.questions.length, 0);
    normalizedSections = [defaultSec];
  } else if (rawQuestions.length > 0) {
    // If questions are flat at root level
    const defaultSec: MockSection = {
      id: "sec-flat",
      skill: "listening",
      title: "Exam Questions",
      order: 0,
      sortOrder: 0,
      instructions: "",
      durationMinutes: 150,
      timeLimit: 150,
      groups: [{
        id: "grp-all",
        key: "grp-all",
        label: "All Questions",
        partNumber: 1,
        sortOrder: 0,
        title: "Questions",
        instructions: "",
        passageText: "",
        passageHtml: "",
        contentHtml: null,
        contentLayout: null,
        audioUrl: null,
        imageUrl: null,
        hasAudio: false,
        audioDurationSec: null,
        audioPlayLimit: 1,
        strictAudio: false,
        questions: rawQuestions.map((q: any, qIdx: number) => ({
          id: String(q.id || `q-${qIdx}`),
          number: q.number ?? (qIdx + 1),
          sortOrder: qIdx,
          prompt: q.prompt ?? q.text ?? "",
          text: q.text ?? q.prompt ?? "",
          type: q.type || q.kind || "single_choice",
          kind: q.kind || q.type || "single_choice",
          questionType: q.type || q.kind || "single_choice",
          options: Array.isArray(q.options) ? q.options : [],
          points: q.points ?? 1,
          score: q.score ?? 1,
          maxScore: q.maxScore ?? 1,
          wordLimit: null,
          answerRule: null,
          guidance: undefined,
        })),
        items: [],
      }],
      parts: [],
      questionCount: rawQuestions.length,
    };
    defaultSec.parts = defaultSec.groups;
    normalizedSections = [defaultSec];
  }

  const totalQuestions = normalizedSections.reduce(
    (acc, sec) => acc + sec.groups.reduce((gAcc, grp) => gAcc + (grp.questions?.length || 0), 0),
    0
  );

  const durationMinutes =
    examObj.durationMinutes ??
    examObj.duration_minutes ??
    payload.durationMinutes ??
    payload.duration_minutes ??
    (normalizedSections.length > 0
      ? normalizedSections.reduce((acc, s) => acc + (s.durationMinutes || s.timeLimit || 0), 0)
      : 150);

  if (totalQuestions === 0) {
    console.error("[normalizeExamPayload] Warning: Exam parsed with 0 total questions!", {
      rawSectionsCount: rawSections.length,
      rawPartsCount: rawParts.length,
      rawQuestionsCount: rawQuestions.length,
      examId: examObj.id,
      title: examObj.title,
    });
  }

  return {
    id: String(examObj.id || payload.id || "cd-exam-active"),
    code: examObj.code || payload.code || "MOCK-RECORD-01",
    title: examObj.title || payload.title || "Multi-Level (CEFR) Mock Test 1 (Record Mock)",
    type: examObj.type || payload.type || "multilevel",
    examType: examObj.examType || payload.examType || "CEFR_MULTILEVEL",
    durationMinutes: durationMinutes > 0 ? durationMinutes : 150,
    isCdFormat: true,
    isPublished: true,
    isDemo: true,
    description: examObj.description || payload.description || "",
    level: examObj.level || "B2",
    createdAt: examObj.createdAt || new Date().toISOString(),
    updatedAt: examObj.updatedAt || new Date().toISOString(),
    contentVersion: examObj.contentVersion ?? 1,
    profile: examObj.profile || "full_mock",
    price: typeof examObj.price === "number" ? examObj.price : 0,
    isFreeForApproved: Boolean(examObj.isFreeForApproved ?? true),
    access: (examObj.access || "granted") as any,
    questionCount: totalQuestions,
    totalQuestions,
    sections: normalizedSections,
    parts: normalizedSections.flatMap((s) => s.groups),
  } as unknown as MockExamDetail;
}
