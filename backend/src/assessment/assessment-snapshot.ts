import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { MockAnswer, MockAttempt } from '@prisma/client';
import { ExamRow } from '../mock/mock-shape';
import { audioContentType } from '../mock/mock-storage';
import { MULTILEVEL_SPECIFICATION, taskGuidance } from '../mock/multilevel-specification';
import { AssessmentInput, AssessmentPart, AssessmentProgram, AssessmentSkill } from './contracts';
import { PROMPT_VERSION, rubricVersionFor } from './prompts';

export function assessmentProgram(type: string): AssessmentProgram {
  return type === 'multilevel' ? 'MULTILEVEL' : type === 'ielts_general' ? 'IELTS_GENERAL' : 'IELTS_ACADEMIC';
}

export async function audioChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function buildAssessmentInput(exam: ExamRow, attempt: Pick<MockAttempt, 'specificationVersion' | 'speakingProfileVersion' | 'mediaState'>, skill: AssessmentSkill, answers: MockAnswer[], hashAudio: (key: string) => Promise<string>): Promise<AssessmentInput> {
  const program = assessmentProgram(exam.type);
  const section = exam.sections.find((s) => s.skill === skill);
  const groups = [...(section?.groups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const parts: AssessmentPart[] = [];
  for (const [index, group] of groups.entries()) {
    const responses = [];
    for (const question of group.questions) {
      const answer = byQuestion.get(question.id);
      const phase = (attempt.mediaState as Record<string, { prepEndsAt?: string; expiresAt?: string }> | null)?.[question.id];
      const durationMs = phase?.prepEndsAt && phase.expiresAt ? Date.parse(phase.expiresAt) - Date.parse(phase.prepEndsAt) : undefined;
      responses.push({ questionId: question.id, prompt: question.prompt, originalResponse: answer?.response ?? '', partNumber: group.partNumber ?? index + 1,
        ...(answer?.audioKey ? { audioKey: answer.audioKey, audioHash: await hashAudio(answer.audioKey), mimeType: audioContentType(answer.audioKey) } : {}),
        ...(durationMs && Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
      });
    }
    const spec = program === 'MULTILEVEL' ? MULTILEVEL_SPECIFICATION[skill].parts[index] : null;
    const guidance = group.questions.map((_, qi) => taskGuidance(skill, index, qi, attempt.speakingProfileVersion, attempt.specificationVersion));
    if (program === 'MULTILEVEL') {
      parts.push({ id: spec?.key ?? `part:${group.id}`, max: spec?.rawMax ?? group.questions[0]?.points ?? 0,
        task: [group.title, group.instructions].filter(Boolean).join('\n'), context: [group.passageText, group.contentHtml].filter(Boolean).join('\n'), responses,
        ...(group.imageKey ? { imageKeys: [group.imageKey] } : {}),
        ...(skill === 'speaking' ? { prepSeconds: guidance.map((g) => g?.prepSeconds ?? 0), responseSeconds: guidance.map((g) => g?.responseSeconds ?? 0) } : {}),
      });
    } else if (skill === 'writing') {
      for (const response of responses) {
        const question = group.questions.find((q) => q.id === response.questionId)!;
        const task2 = question.type === 'essay_task2';
        parts.push({ id: `${task2 ? 'task2' : 'task1'}:${question.id}`, max: 9, weight: task2 ? 2 : 1,
          task: [group.title, group.instructions, question.prompt].filter(Boolean).join('\n'), context: [group.passageText, group.contentHtml].filter(Boolean).join('\n'), responses: [response],
          ...(group.imageKey ? { imageKeys: [group.imageKey] } : {}),
        });
      }
    } else {
      if (!parts.length) parts.push({ id: 'speaking', max: 9, task: 'IELTS Speaking Parts 1, 2 and 3, assessed holistically', context: '', responses: [] });
      parts[0].responses.push(...responses);
      parts[0].context += `\nPart ${group.partNumber ?? index + 1}: ${[group.title, group.instructions, group.passageText].filter(Boolean).join('\n')}`;
    }
  }
  return { program, skill, specificationVersion: attempt.specificationVersion, speakingProfileVersion: attempt.speakingProfileVersion ?? null,
    rubricVersion: rubricVersionFor(program, skill), promptVersion: PROMPT_VERSION, pronunciationEvidence: 'UNAVAILABLE', parts };
}

export function assessmentBlueprintFailure(input: AssessmentInput): string | null {
  if (!input.parts.length || input.parts.some((p) => !p.responses.length)) return 'ASSESSMENT_INCOMPLETE_BLUEPRINT';
  if (input.program === 'MULTILEVEL') {
    const spec = MULTILEVEL_SPECIFICATION[input.skill];
    if (input.parts.length !== spec.parts.length || input.parts.some((p, i) => p.id !== spec.parts[i].key || p.responses.length !== spec.parts[i].count || p.max !== spec.parts[i].rawMax)) return 'ASSESSMENT_INCOMPLETE_BLUEPRINT';
  } else if (input.skill === 'writing' && input.parts.some((p) => !p.id.startsWith('task1:') && !p.id.startsWith('task2:'))) return 'ASSESSMENT_INCOMPLETE_BLUEPRINT';
  if (input.skill === 'speaking' && input.parts.some((p) => p.responses.some((r) => !r.audioKey || !r.audioHash))) return 'ASSESSMENT_AUDIO_MISSING';
  return null;
}
