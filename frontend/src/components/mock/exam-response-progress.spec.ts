// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObjectiveQuestion } from '@/lib/objective-question';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, string | number>) => `${key}${values ? ` ${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(' ')}` : ''}` }));

import { ResponseProgress, WritingResponseGuide } from './exam-response-progress';
import { ObjectiveQuestionInput } from './objective-question-input';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; host = undefined; });

describe('honest response and Writing progress', () => {
  it('shows entered responses without presenting a score and caps invalid progress', () => {
    const html = renderToStaticMarkup(React.createElement(ResponseProgress, { answered: 9, total: 6 }));
    expect(html).toContain('value="6"'); expect(html).toContain('max="6"');
    expect(html).toContain('responseProgressHint'); expect(html).not.toContain('75');
    expect(renderToStaticMarkup(React.createElement(ResponseProgress, { answered: 0, total: 0 }))).toBe('');
  });

  it('counts typed words and presents an advisory target rather than blocking the response', () => {
    const html = renderToStaticMarkup(React.createElement(WritingResponseGuide, { value: '  first\nsecond\tthird  ', minimum: 5, maximum: 8 }));
    expect(html).toContain('wordCount count=3'); expect(html).toContain('wordsRemaining count=2');
    expect(html).toContain('value="3"'); expect(html).toContain('writingReviewHint');
    expect(html).not.toContain('disabled');
  });

  it('shows target reached without implying a grade', () => {
    const html = renderToStaticMarkup(React.createElement(WritingResponseGuide, { value: 'one two three four five', minimum: 3, maximum: 6 }));
    expect(html).toContain('targetReached'); expect(html).toContain('value="3"'); expect(html).toContain('writingReviewHint');
  });

  it('distinguishes a range maximum from an approximate single-value target', () => {
    const above = renderToStaticMarkup(React.createElement(WritingResponseGuide, { value: 'one two three four five', minimum: 3, maximum: 4 }));
    expect(above).toContain('aboveTarget');
    const approximate = renderToStaticMarkup(React.createElement(WritingResponseGuide, { value: 'one two three four five', minimum: 3, maximum: 3 }));
    expect(approximate).toContain('~3'); expect(approximate).toContain('targetReached'); expect(approximate).not.toContain('aboveTarget');
  });

  it('does not invent a target for a question without one', () => {
    const html = renderToStaticMarkup(React.createElement(WritingResponseGuide, { value: '' }));
    expect(html).toContain('wordCount count=0'); expect(html).not.toContain('<progress'); expect(html).toContain('writingStartHint');
  });
});

describe('objective answer interaction', () => {
  const question = { id: 'q', number: 1, type: 'multiple_choice', prompt: 'Select a response.', options: ['A', 'B'], wordLimit: null } satisfies ObjectiveQuestion;

  async function render(disabled = false, unavailableOptions: string[] = [], type = question.type as string) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    function Fixture() {
      const [value, setValue] = React.useState('');
      return React.createElement(ObjectiveQuestionInput, { question: { ...question, type }, value, onChange: setValue, disabled, unavailableOptions });
    }
    await act(async () => root!.render(React.createElement(Fixture)));
  }

  it('shows selection feedback and allows clearing without revealing correctness', async () => {
    await render();
    await act(async () => host!.querySelector<HTMLInputElement>('input[value="B"]')!.click());
    expect(host!.textContent).toContain('answerSelected'); expect(host!.textContent).not.toContain('Correct');
    expect(host!.querySelector<HTMLInputElement>('input[value="B"]')!.checked).toBe(true);
    await act(async () => host!.querySelector('button')!.click());
    expect(host!.querySelector<HTMLInputElement>('input[value="B"]')!.checked).toBe(false);
    expect(host!.textContent).not.toContain('answerSelected'); expect(host!.querySelector('button')).toBeNull();
  });

  it('counts multiple selections and clearing removes the whole answer', async () => {
    await render(false, [], 'multi_select');
    await act(async () => host!.querySelector<HTMLInputElement>('input[value="A"]')!.click());
    await act(async () => host!.querySelector<HTMLInputElement>('input[value="B"]')!.click());
    expect(host!.textContent).toContain('choicesSelected count=2');
    await act(async () => host!.querySelector('button')!.click());
    expect([...host!.querySelectorAll<HTMLInputElement>('input')].every((input) => !input.checked)).toBe(true);
  });

  it('preserves disabled author previews and matching option constraints', async () => {
    await render(true);
    expect([...host!.querySelectorAll<HTMLInputElement>('input')].every((input) => input.disabled)).toBe(true);
    await act(async () => root!.unmount()); host!.remove(); root = undefined;
    await render(false, ['B'], 'matching');
    expect(host!.querySelector<HTMLInputElement>('input[value="B"]')!.disabled).toBe(true);
    expect(host!.querySelector<HTMLInputElement>('input[value="A"]')!.disabled).toBe(false);
  });
});
