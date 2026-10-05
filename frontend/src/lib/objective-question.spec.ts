import { describe, expect, it } from 'vitest';
import { selectedObjectiveOptions, toggleObjectiveOption } from './objective-question';

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
});
