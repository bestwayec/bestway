import { describe, expect, it } from 'vitest';
import { newQuestion, type BuilderPart } from '@/components/mock/exam-builder/types';
import { applyFormatPreset, applySharedOptionBank, gapHtmlToText, gapTextToHtml, newPresetQuestion, presetForPart, QUESTION_FORMAT_PRESETS } from './question-format-model';

function part(): BuilderPart {
  return { clientId: 'part', title: 'Original title', instructions: 'Original instructions', passageText: 'Original source text', audioPlayLimit: 1, hasAudio: false,
    questions: [{ ...newQuestion(1, 'multiple_choice', true), prompt: 'Keep this authored question.', options: ['First', 'Second'], correctAnswers: ['B'] }] };
}
function preset(key: string) {
  return QUESTION_FORMAT_PRESETS.find((item) => item.key === key)!;
}

describe('question format authoring defaults', () => {
  it('applies layout and reuse metadata without converting or overwriting authored rows', () => {
    const original = part();
    const changed = applyFormatPreset(original, preset('headings'));
    expect(changed.contentLayout).toBe('headings');
    expect(changed.optionsReusable).toBe(false);
    expect(changed.questions).toBe(original.questions);
    expect(changed.passageText).toBe(original.passageText);
    expect(changed.questions[0].type).toBe('multiple_choice');
    expect(changed.questions[0].correctAnswers).toEqual(['B']);
    expect(newPresetQuestion(changed, 2, 'multiple_choice', preset('headings')).type).toBe('matching_headings');
  });

  it('creates explicit word rules and restores their format after reopening', () => {
    for (const [key, rule] of [['gap', 'ONE_WORD'], ['gap_number', 'ONE_WORD_AND_OR_NUMBER']] as const) {
      const original = part();
      const question = newPresetQuestion(original, 2, 'multiple_choice', preset(key));
      expect(question.type).toBe('short_answer');
      expect(question.answerRule).toBe(rule);
      expect(question.correctAnswers).toEqual([]);
      expect(presetForPart({ ...original, questions: [question] })?.key).toBe(key);
    }
  });

  it('shares a bank with extra distractors and preserves one-use mappings when adding a row', () => {
    const original = part();
    original.questions = [{ ...newQuestion(1, 'matching', true), prompt: 'First match.', correctAnswers: ['B'] }];
    const bank = ['A. Library', 'B. Garden', 'C. Hall'];
    original.questions = applySharedOptionBank(original.questions, bank);
    const added = newPresetQuestion(original, 2, 'multiple_choice', preset('speakers'));
    expect(added.options).toEqual(bank);
    expect(added.correctAnswers).toEqual([]);
    expect(original.questions[0].correctAnswers).toEqual(['B']);
    added.options.push('D. Station');
    expect(original.questions[0].options).toEqual(bank);
    expect(applyFormatPreset(original, preset('speakers')).optionsReusable).toBe(false);
    expect(applyFormatPreset(original, preset('paragraphs')).optionsReusable).toBe(true);
  });

  it('preserves a chosen type when no preset is selected', () => {
    expect(newPresetQuestion(part(), 3, 'yes_no_notgiven').type).toBe('yes_no_notgiven');
    expect(newPresetQuestion(part(), 3, 'essay_task2', undefined, false).points).toBe(9);
  });

  it('escapes prose and retains numbered gaps through the authoring round trip', () => {
    const text = 'Tools <script>never execute</script> {1}\nRoom & gate {2}';
    const html = gapTextToHtml(text);
    expect(html).not.toContain('<script>');
    expect(html).toContain('<span data-gap="1"></span>');
    expect(gapHtmlToText(html)).toBe(text);
  });
});
