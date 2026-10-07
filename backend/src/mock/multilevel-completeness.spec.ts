import { describe, expect, it } from 'vitest';
import { multilevelMissingWork, multilevelMissingWorkMessage, type CompletenessAnswer, type CompletenessSection } from './multilevel-completeness';

/**
 * The rule the submit gate enforces. The same table of fixtures is asserted in
 * `frontend/src/lib/multilevel-completeness.spec.ts`, which mirrors the rule for
 * the pre-submit review surface.
 */
const sections: CompletenessSection[] = [
  { skill: 'listening', groups: [{ questions: [{ id: 'l1', type: 'multiple_choice' }, { id: 'l2', type: 'multiple_choice' }] }] },
  { skill: 'reading', groups: [{ questions: [{ id: 'r1', type: 'true_false_notgiven' }, { id: 'r2', type: 'summary_completion' }] }] },
  { skill: 'writing', groups: [{ questions: [{ id: 'w1', type: 'essay_task1' }] }] },
  { skill: 'speaking', groups: [{ questions: [{ id: 's1', type: 'speaking_task' }] }] },
];

function answer(questionId: string, response = 'library', audioKey: string | null = null): CompletenessAnswer {
  return { questionId, response, audioKey };
}

const complete: CompletenessAnswer[] = [
  answer('l1'), answer('l2'), answer('r1'), answer('r2'), answer('w1'),
  answer('s1', '', 'attempt/speaking-1.webm'),
];

function work(answers: CompletenessAnswer[], state: Parameters<typeof multilevelMissingWork>[2] = {}, now = new Date('2026-10-07T10:00:00Z')) {
  return multilevelMissingWork(sections, answers, state, now);
}

describe('Multilevel pre-submit completeness rule', () => {
  it('accepts an exam with every required section answered', () => {
    const result = work(complete);
    expect(result).toMatchObject({ complete: true, missing: 0, total: 6, timeExpired: false, timed: false });
    expect(result.requiredSections).toEqual(['listening', 'reading', 'writing', 'speaking']);
    expect(multilevelMissingWorkMessage(result)).toBe('Every required section is complete.');
  });

  it('reports a blank objective answer as unfinished work in that section', () => {
    const result = work(complete.map((item) => (item.questionId === 'r2' ? { ...item, response: '   ' } : item)));
    expect(result.complete).toBe(false);
    expect(result.unfinished.map((section) => section.skill)).toEqual(['reading']);
    expect(result.missing).toBe(1);
    expect(multilevelMissingWorkMessage(result)).toContain('Reading 1 of 2 unanswered');
  });

  it('counts a speaking prompt as answered only when a recording exists', () => {
    const result = work(complete.filter((item) => item.questionId !== 's1'));
    expect(result.unfinished.map((section) => section.skill)).toEqual(['speaking']);
    expect(result.sections.find((section) => section.skill === 'speaking')).toMatchObject({ recordings: 0, missing: 1 });
    expect(multilevelMissingWorkMessage(result)).toContain('Speaking 1 of 1 not recorded');
  });

  it('ignores a section whose own clock has run out', () => {
    const blank = complete.map((item) => (item.questionId.startsWith('r') ? { ...item, response: '' } : item));
    const result = work(blank, { sectionDeadlines: { reading: '2026-10-07T09:59:00Z' } });
    expect(result.complete).toBe(true);
    expect(result.expiredSections).toEqual(['reading']);
    expect(result.requiredSections).toEqual(['listening', 'writing', 'speaking']);
  });

  it('keeps a section required while its clock is still running', () => {
    const blank = complete.map((item) => (item.questionId.startsWith('r') ? { ...item, response: '' } : item));
    const running = work(blank, { sectionDeadlines: { reading: '2026-10-07T10:30:00Z' } });
    expect(running.complete).toBe(false);
    expect(running.requiredSections).toContain('reading');
  });

  it('accepts a partial exam once the whole attempt has run out of time (timeout auto-submit)', () => {
    const result = work([answer('l1')], { overallDeadlineAt: new Date('2026-10-07T09:59:00Z') });
    expect(result).toMatchObject({ complete: true, timeExpired: true, timed: true, missing: 0, total: 0 });
  });

  it('requires only the live section of a full-test attempt', () => {
    const state = { flowMode: 'full_test', currentSkill: 'writing' as const };
    const answered = complete.filter((item) => item.questionId === 'w1');
    const live = work(answered, state);
    expect(live.complete).toBe(true);
    expect(live.requiredSections).toEqual(['writing']);

    const unfinished = work(answered.filter((item) => item.questionId !== 'w1'), state);
    expect(unfinished.complete).toBe(false);
    expect(unfinished.unfinished.map((section) => section.skill)).toEqual(['writing']);
    expect(unfinished.requiredSections).toEqual(['writing']);
  });

  it('tolerates a sectionDeadlines column that lost its shape', () => {
    for (const value of [null, undefined, 'nonsense', 42, [], { reading: 7 }, { reading: 'not-a-date' }]) {
      const result = work(complete, { sectionDeadlines: value });
      expect(result.complete).toBe(true);
      expect(result.timed).toBe(false);
    }
  });

  it('falls back to the section deadline as the attempt clock', () => {
    const result = work([answer('l1')], { deadlineAt: '2026-10-07T09:00:00Z' });
    expect(result).toMatchObject({ timeExpired: true, complete: true });
  });
});
