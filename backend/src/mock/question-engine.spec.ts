import { describe, expect, it } from 'vitest';
import { MockQuestionType } from '@prisma/client';
import { isAnswerCorrect } from './mock-answer';
import { shapeGroup } from './mock-shape';
import { canonicalDecision, duplicateMatchingResponses, objectiveGroupIssues, objectiveQuestionIssues, respectsAnswerRule } from './question-engine';
import { validateImportPackage } from './mock-import-validate';

const cases: Array<{ name: string; type: MockQuestionType; layout?: string; options: string[]; keys: string[]; response: string; rule?: 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER'; skill?: string }> = [
  { name: 'MULTIPLE_CHOICE', type: 'multiple_choice', options: ['North room', 'South room', 'Hall'], keys: ['A'], response: 'North room' },
  { name: 'SHORT_ANSWER', type: 'short_answer', options: [], keys: ['library'], response: ' LIBRARY ' },
  { name: 'ONE_WORD_GAP_FILL', type: 'short_answer', options: [], keys: ['library'], response: ' LIBRARY ', rule: 'ONE_WORD' },
  { name: 'NOTE_COMPLETION', type: 'note_completion', options: [], keys: ['gate 7'], response: 'Gate 7', rule: 'ONE_WORD_AND_OR_NUMBER', skill: 'listening' },
  { name: 'SENTENCE_COMPLETION', type: 'sentence_completion', options: [], keys: ['evening'], response: 'EVENING', rule: 'ONE_WORD' },
  { name: 'TRUE_FALSE_NOT_GIVEN', type: 'true_false_notgiven', options: ['TRUE', 'FALSE', 'NOT GIVEN'], keys: ['NOT_GIVEN'], response: 'NOT GIVEN' },
  { name: 'MATCHING', type: 'matching', options: ['Workshop', 'Library', 'Café'], keys: ['B'], response: 'Library' },
  { name: 'HEADING_MATCH', type: 'matching_headings', layout: 'headings', options: ['City transport', 'Community gardens', 'History'], keys: ['B'], response: 'Community gardens' },
  { name: 'SPEAKER_MATCH', type: 'matching', layout: 'speakers', options: ['Enjoys cycling', 'Studies art', 'Likes music'], keys: ['A'], response: 'Enjoys cycling', skill: 'listening' },
  { name: 'SHORT_TEXT_MATCH', type: 'matching', layout: 'short_texts', options: ['Evening course', 'Morning class', 'Weekend club'], keys: ['C'], response: 'Weekend club' },
  { name: 'PARAGRAPH_MATCH', type: 'matching', layout: 'paragraphs', options: ['Paragraph A', 'Paragraph B', 'Paragraph C'], keys: ['B'], response: 'Paragraph B' },
  { name: 'MAP_PLAN_LABEL', type: 'map_labelling', layout: 'map', options: ['A courtyard', 'B entrance', 'C café'], keys: ['B'], response: 'B entrance', skill: 'listening' },
  { name: 'MULTI_EXTRACT_MCQ', type: 'multiple_choice', layout: 'multi_extract', options: ['Train', 'Bus', 'Bicycle'], keys: ['C'], response: 'Bicycle', skill: 'listening' },
];

describe('shared objective question engine', () => {
  it.each(cases)('$name validates, grades deterministically and hides keys in student payloads', (format) => {
    const q = { id: 'q1', number: 1, sortOrder: 0, type: format.type, prompt: 'Original synthetic prompt', options: format.options, correctAnswers: format.keys, acceptedVariants: [], points: 1, wordLimit: null, answerRule: format.rule ?? null };
    const group = { id: 'group1', sortOrder: 0, title: 'Original fixture', instructions: 'Choose or complete.', passageText: 'Original synthetic information.', contentHtml: null, audioScript: 'Secret transcript', contentLayout: format.layout ?? null, optionsReusable: false, audioKey: format.skill === 'listening' ? 'mock/extract1.mp3' : null, imageKey: format.type === 'map_labelling' ? 'mock/plan.png' : null, partNumber: null, audioDurationSec: 30, audioPlayLimit: 1, questions: [q] };
    expect(objectiveGroupIssues(group, true)).toEqual([]);
    const opts = { options: format.options, answerRule: format.rule, wordLimit: 1 };
    expect(isAnswerCorrect(format.type, format.response, format.keys, opts)).toBe(true);
    expect(isAnswerCorrect(format.type, 'unrelated answer', format.keys, opts)).toBe(false);
    const student = shapeGroup(group, false, '/v1');
    expect(student.optionsReusable).toBe(false);
    expect(student.questions[0].answerRule).toBe(format.rule ?? null);
    expect(student.questions[0]).not.toHaveProperty('correctAnswers');
    expect(student.questions[0]).not.toHaveProperty('acceptedVariants');
    expect(student).not.toHaveProperty('audioScript');
    expect(shapeGroup(group, true, '/v1').questions[0].correctAnswers).toEqual(format.keys);
  });

  it('only accepts configured text alternatives under explicit one-word rules', () => {
    expect(isAnswerCorrect('short_answer', 'color', ['colour'], { answerRule: 'ONE_WORD' })).toBe(false);
    expect(isAnswerCorrect('short_answer', 'color', ['colour'], { answerRule: 'ONE_WORD', acceptedVariants: ['color'] })).toBe(true);
    expect(isAnswerCorrect('short_answer', 'twenty', ['20'], { answerRule: 'ONE_WORD_AND_OR_NUMBER' })).toBe(false);
    expect(isAnswerCorrect('short_answer', 'the library', ['library'], { answerRule: 'ONE_WORD' })).toBe(false);
  });

  it('keeps legacy IELTS text normalization and word limits unchanged when no rule is configured', () => {
    expect(isAnswerCorrect('short_answer', 'twenty', ['20'])).toBe(true);
    expect(isAnswerCorrect('short_answer', 'the library', ['library'], { wordLimit: 2 })).toBe(true);
    expect(isAnswerCorrect('short_answer', 'the library', ['library'], { wordLimit: 1 })).toBe(false);
  });

  it('counts one word and/or one number without accepting extra words or numbers', () => {
    expect(respectsAnswerRule('gate 7', 'ONE_WORD_AND_OR_NUMBER')).toBe(true);
    expect(respectsAnswerRule('7', 'ONE_WORD_AND_OR_NUMBER')).toBe(true);
    expect(respectsAnswerRule('north gate', 'ONE_WORD_AND_OR_NUMBER')).toBe(false);
    expect(respectsAnswerRule('gate 7 8', 'ONE_WORD_AND_OR_NUMBER')).toBe(false);
    expect(respectsAnswerRule('7', 'ONE_WORD')).toBe(false);
  });

  it('resolves imported letter keys, legacy expanded keys and option-text wire for choices', () => {
    for (const type of ['multiple_choice', 'matching', 'matching_headings', 'map_labelling'] as const) {
      expect(isAnswerCorrect(type, 'Quiet room', ['B'], { options: ['Busy hall', 'Quiet room'] })).toBe(true);
      expect(isAnswerCorrect(type, 'B', ['Quiet room'], { options: ['Busy hall', 'Quiet room'] })).toBe(true);
      expect(isAnswerCorrect(type, 'Busy hall', ['B', 'Quiet room'], { options: ['Busy hall', 'Quiet room'] })).toBe(false);
    }
    expect(isAnswerCorrect('multi_select', 'Busy hall, Quiet room', ['A', 'B'], { options: ['Busy hall', 'Quiet room', 'Garden'] })).toBe(true);
    expect(isAnswerCorrect('multi_select', 'A C', ['A', 'B'], { options: ['Busy hall', 'Quiet room', 'Garden'] })).toBe(false);
  });

  it('never marks a legitimate text key wrong when the option bank does not contain it', () => {
    const bank = ['Botany garden', 'Rooftop terrace', 'Old mill'];
    // A stored legacy/malformed key absent from the bank keeps legacy normalization.
    expect(isAnswerCorrect('multiple_choice', 'fountain', ['fountain'], { options: bank })).toBe(true);
    expect(isAnswerCorrect('matching', ' The FoUnTaIn ', ['fountain'], { options: bank })).toBe(true);
    // A genuinely wrong response is still rejected.
    expect(isAnswerCorrect('multiple_choice', 'old mill', ['fountain'], { options: bank })).toBe(false);
    // When the key resolves to the bank, the bank decides the result.
    expect(isAnswerCorrect('multiple_choice', 'Old mill', ['C'], { options: bank })).toBe(true);
    expect(isAnswerCorrect('multiple_choice', 'Botany garden', ['C'], { options: bank })).toBe(false);
  });

  it('flags non-bank choice keys for publication while grading keeps legacy keys working', () => {
    const malformed = { type: 'matching', options: ['Botany garden', 'Rooftop terrace'], correctAnswers: ['fountain'] };
    expect(objectiveQuestionIssues(malformed, true)).toContain('answer key does not resolve to the option bank');
    const valid = { type: 'matching', options: ['Botany garden', 'Rooftop terrace'], correctAnswers: ['A'] };
    expect(objectiveQuestionIssues(valid, true)).toEqual([]);
  });

  it('keeps multi-select bank grading compatible with legacy text responses', () => {
    const bank = ['Botany garden', 'Rooftop terrace', 'Old mill'];
    expect(isAnswerCorrect('multi_select', 'Botany garden, Old mill', ['A', 'C'], { options: bank })).toBe(true);
    expect(isAnswerCorrect('multi_select', 'A C', ['Botany garden', 'Old mill'], { options: bank })).toBe(true);
    expect(isAnswerCorrect('multi_select', 'A', ['A', 'C'], { options: bank })).toBe(false);
  });

  it('canonicalizes no-information aliases without changing NOT GIVEN display responses', () => {
    expect(canonicalDecision('NO_INFORMATION')).toBe('NOT_GIVEN');
    expect(isAnswerCorrect('true_false_notgiven', 'NOT GIVEN', ['NO_INFORMATION'])).toBe(true);
    expect(isAnswerCorrect('true_false_notgiven', 'FALSE', ['NOT_GIVEN'])).toBe(false);
    const shaped = shapeGroup({ id: 'tfng', sortOrder: 0, title: null, instructions: null, passageText: null, contentHtml: null, audioScript: null, contentLayout: null, audioKey: null, imageKey: null, partNumber: null, audioDurationSec: null, audioPlayLimit: 1, questions: [{ id: 'q', number: 1, sortOrder: 0, type: 'true_false_notgiven', prompt: 'Synthetic', options: ['TRUE', 'FALSE', 'NO_INFORMATION'], correctAnswers: ['NOT_GIVEN'], acceptedVariants: [], points: 1, wordLimit: null, answerRule: null }] }, false, '/v1');
    expect(shaped.questions[0].options).toEqual(['TRUE', 'FALSE', 'NOT GIVEN']);
  });

  it('allows incomplete drafts but rejects their publication and malformed metadata', () => {
    const incomplete = { type: 'multiple_choice', prompt: '', options: [], correctAnswers: [] };
    expect(objectiveQuestionIssues(incomplete, true, false)).toEqual([]);
    expect(objectiveQuestionIssues(incomplete, true)).toContain('objective answer key is missing');
    expect(objectiveQuestionIssues({ ...incomplete, answerRule: 'UNKNOWN' }, true, false)).toContain('answer rule is only valid for text completion');
    expect(objectiveQuestionIssues({ type: 'short_answer', options: [], correctAnswers: ['north gate'], answerRule: 'ONE_WORD' }, true)).toContain('answer key exceeds the configured answer rule');
  });

  it('validates shared banks, extra distractors, one-use mappings and required map media', () => {
    const q = { type: 'matching', options: ['Library', 'Hall', 'Garden'], correctAnswers: ['A'] };
    expect(objectiveGroupIssues({ optionsReusable: true, contentLayout: 'paragraphs', questions: [q, q] }, true)).toEqual([]);
    expect(objectiveGroupIssues({ optionsReusable: false, contentLayout: 'paragraphs', questions: [q, q] }, true)).toContain('one-use option bank has repeated answer mappings');
    expect(objectiveGroupIssues({ contentLayout: 'speakers', questions: [q, { ...q, options: ['Hall', 'Library'] }] }, true)).toContain('matching questions must share the same option bank');
    expect(objectiveGroupIssues({ contentLayout: 'map', questions: [{ ...q, type: 'map_labelling' }] }, true)).toContain('map/plan questions require an image');
  });

  it('finds duplicate one-use selections across letter and option-text responses', () => {
    const questions = [{ id: '1', type: 'matching', options: ['Library', 'Hall'] }, { id: '2', type: 'matching', options: ['Library', 'Hall'] }];
    expect([...duplicateMatchingResponses(questions, new Map([['1', 'A'], ['2', 'Library']]))]).toEqual(['1', '2']);
    expect(duplicateMatchingResponses(questions, new Map([['1', 'A'], ['2', 'Hall']])).size).toBe(0);
  });

  it('keeps each extract attached to its own secure audio endpoint', () => {
    const groups = ['extract1', 'extract2'].map((id) => shapeGroup({ id, sortOrder: 0, title: id, instructions: null, passageText: null, contentHtml: null, audioScript: null, contentLayout: 'multi_extract', audioKey: `mock/${id}.mp3`, imageKey: null, partNumber: 1, audioDurationSec: 30, audioPlayLimit: 1, questions: [] }, false, '/v1'));
    expect(groups.map((group) => group.audioUrl)).toEqual(['/v1/mock/groups/extract1/audio', '/v1/mock/groups/extract2/audio']);
  });

  it('imports normalized practice metadata and decision aliases', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../docs/ai-test-import/example-reading.json'), 'utf8'));
    pkg.exam.practiceLevel = 'A2';
    const decision = pkg.exam.sections[0].groups[1].questions.find((q: { type: string }) => q.type === 'true_false_notgiven');
    decision.correctAnswers = ['NO_INFORMATION'];
    decision.options = ['TRUE', 'FALSE', 'NO_INFORMATION'];
    expect(validateImportPackage(pkg).canImport).toBe(true);
    pkg.exam.practiceLevel = 'A0';
    expect(validateImportPackage(pkg).canImport).toBe(false);
  });
});
