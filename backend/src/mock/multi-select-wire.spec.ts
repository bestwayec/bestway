import { describe, expect, it } from 'vitest';
import { isAnswerCorrect } from './mock-answer';
import { respectsAnswerRule } from './question-engine';

describe('multi-select serialized answers', () => {
  const options = ['North, South', 'Bus; train', 'Garden'];
  it('grades JSON option arrays with punctuation and canonical letters', () => {
    expect(isAnswerCorrect('multi_select', JSON.stringify(options.slice(0, 2)), ['A', 'B'], { options })).toBe(true);
    expect(isAnswerCorrect('multi_select', '["A","B"]', options.slice(0, 2), { options })).toBe(true);
    expect(isAnswerCorrect('multi_select', '["A","C"]', ['A', 'B'], { options })).toBe(false);
  });
  it('preserves legacy keys and rejects malformed arrays', () => {
    expect(isAnswerCorrect('multi_select', 'A B', ['A', 'B'], { options })).toBe(true);
    expect(isAnswerCorrect('multi_select', 'A,B', ['A', 'B'], { options })).toBe(true);
    for (const response of ['[1]', '[broken', '[]']) expect(isAnswerCorrect('multi_select', response, ['A', 'B'], { options })).toBe(false);
  });
  it('distinguishes numeric tokens from actual words consistently with student controls', () => {
    for (const value of ['-7', '07:30', '7%']) {
      expect(respectsAnswerRule(value, 'ONE_WORD')).toBe(false);
      expect(respectsAnswerRule(value, 'ONE_WORD_AND_OR_NUMBER')).toBe(true);
    }
    expect(respectsAnswerRule('well-known', 'ONE_WORD')).toBe(true);
    expect(respectsAnswerRule('!!!', 'ONE_WORD_AND_OR_NUMBER')).toBe(false);
  });
});
