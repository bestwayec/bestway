// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockQuestion } from '@/lib/types';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { EssayQuestionEditor } from './mock-runner';

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const question = { id: 'q1', number: 1, type: 'essay_task1', prompt: 'Write a letter' } as MockQuestion;
const render = (value: string) => act(async () => root.render(React.createElement(EssayQuestionEditor, {
  q: question, attemptId: 'attempt1', value, onChange, header: null,
})));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); onChange.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

describe('writing browser draft recovery', () => {
  it('does not silently replace an empty server answer and lets the student choose the draft', async () => {
    localStorage.setItem('bw_writing_draft_attempt1_q1', 'unsaved draft');
    await render('');
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain('unsaved draft');
    const restore = [...host.querySelectorAll('button')].find(b => b.textContent === 'writingDraftRestore')!;
    await act(async () => restore.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('unsaved draft');
  });

  it('keeps a different server answer and removes the recovery offer when a new edit is made', async () => {
    localStorage.setItem('bw_writing_draft_attempt1_q1', 'older draft');
    await render('server answer');
    expect(onChange).not.toHaveBeenCalled();
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toBe('server answer');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'new answer');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('new answer');
    expect(localStorage.getItem('bw_writing_draft_attempt1_q1')).toBe('new answer');
    expect(host.textContent).not.toContain('writingDraftFound');
  });

  it('offers an intentionally cleared draft without silently clearing the server answer', async () => {
    localStorage.setItem('bw_writing_draft_attempt1_q1', '');
    await render('server answer');
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain('writingDraftEmpty');
    const restore = [...host.querySelectorAll('button')].find(b => b.textContent === 'writingDraftRestore')!;
    await act(async () => restore.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('');
  });
});
