import { describe, expect, it } from 'vitest';
import {
  isObjectiveChoice,
  MATCHING_TYPES,
  selectedObjectiveOptions,
  toggleObjectiveOption,
} from './objective-question';

describe('multi-select autosave and resume wire', () => {
  const options = ['North, South', 'Bus; train', 'Garden'];
  it('round-trips punctuation and removes a selection without splitting its text', () => {
    const value = toggleObjectiveOption(toggleObjectiveOption('', options[0], options), options[1], options);
    expect(selectedObjectiveOptions(value, options)).toEqual(options.slice(0, 2));
    expect(selectedObjectiveOptions(toggleObjectiveOption(value, options[0], options), options)).toEqual([options[1]]);
  });
  it('resumes legacy option text and canonical keys', () => {
    expect(selectedObjectiveOptions('North, South', options)).toEqual([options[0]]);
    expect(selectedObjectiveOptions('A B', options)).toEqual(options.slice(0, 2));
    expect(selectedObjectiveOptions('A,B', options)).toEqual(options.slice(0, 2));
    expect(selectedObjectiveOptions('[1]', options)).toEqual([]);
    expect(selectedObjectiveOptions('[broken', options)).toEqual([]);
  });
  it('recognizes matching features and matching information as objective choices and matching types', () => {
    expect(MATCHING_TYPES.has('matching_features')).toBe(true);
    expect(MATCHING_TYPES.has('matching_information')).toBe(true);
    expect(isObjectiveChoice({ id: '1', number: 1, type: 'matching_features', prompt: 'test', options: ['A', 'B'], wordLimit: null })).toBe(true);
    expect(isObjectiveChoice({ id: '2', number: 2, type: 'matching_information', prompt: 'test', options: ['A', 'B'], wordLimit: null })).toBe(true);
    expect(isObjectiveChoice({ id: '3', number: 3, type: 'short_answer', prompt: 'test', options: ['A', 'B', 'C'], wordLimit: null })).toBe(true);
  });
  it('toggles short options (Choose THREE Q38-40) correctly', () => {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    let val = toggleObjectiveOption('', 'A', letters);
    val = toggleObjectiveOption(val, 'C', letters);
    val = toggleObjectiveOption(val, 'D', letters);
    expect(selectedObjectiveOptions(val, letters)).toEqual(['A', 'C', 'D']);
    val = toggleObjectiveOption(val, 'C', letters);
    expect(selectedObjectiveOptions(val, letters)).toEqual(['A', 'D']);
  });
});
