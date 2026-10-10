// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockAttemptDetail, MockExamDetail } from '@/lib/types';

type Answer = { questionId: string; response: string };
const hooks = vi.hoisted(() => {
  const save = vi.fn<(answers: Answer[]) => Promise<unknown>>();
  const mutate = vi.fn((answers: Answer[], options?: { onSuccess?: () => void; onError?: () => void }) => {
    void save(answers).then(() => options?.onSuccess?.(), () => options?.onError?.());
  });
  const other = vi.fn(async () => ({}));
  const translate = (key: string) => key;
  return { save, mutate, other, translate, exam: undefined as MockExamDetail | undefined };
});
vi.mock('next-intl', () => ({ useTranslations: () => hooks.translate }));
vi.mock('@/hooks/use-mock', () => ({
  useMockExam: () => ({ data: hooks.exam }),
  // React Query returns a NEW wrapper each render, but stable callbacks.
  useBulkMockAnswers: () => ({ isPending: false, mutate: hooks.mutate, mutateAsync: hooks.save }),
  useSubmitMock: () => ({ isPending: false, mutateAsync: hooks.other }),
  useAdvanceMockSection: () => ({ isPending: false, mutateAsync: hooks.other }),
  useFlagMockCheat: () => ({ mutate: hooks.other }),
  useUploadMockSpeaking: () => ({ isPending: false, mutate: hooks.other }),
}));
vi.mock('@/lib/durable-recordings', () => ({ hasPendingRecordings: async () => false, hasActiveRecording: () => false }));
import { MockRunner } from './mock-runner';

let host: HTMLDivElement;
let root: Root;
let attempt: MockAttemptDetail;

async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function answer(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Answer for question 1"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(versioned = false, initialResponse = '') {
  hooks.exam = {
    id: 'exam', title: 'Timed autosave', type: versioned ? 'multilevel' : 'ielts_academic', questionCount: 1,
    sections: [{ id: 'reading', skill: 'reading', groups: [{ id: 'group', title: 'Passage', questions: [
      { id: 'question', number: 1, type: 'short_answer', prompt: 'Where?', response: initialResponse },
    ] }] }],
  } as unknown as MockExamDetail;
  attempt = {
    id: 'attempt', examId: 'exam', mode: 'timed', flowMode: 'single_skill', currentSkill: 'reading',
    deadlineAt: new Date(Date.now() + 3600000).toISOString(), serverTime: new Date().toISOString(),
    specificationVersion: versioned ? 'UZBMB_MULTILEVEL_EN_2026_V1' : null,
    sections: hooks.exam.sections,
  } as unknown as MockAttemptDetail;
  await act(async () => root.render(React.createElement(React.StrictMode, {}, React.createElement(MockRunner, { attempt }))));
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  hooks.save.mockReset().mockResolvedValue({ saved: 1 }); hooks.mutate.mockClear(); hooks.other.mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('timed runner autosave with unstable mutation wrappers', () => {
  it.each([false, true])('restores server answers without treating them as dirty edits (versioned=%s)', async (versioned) => {
    await mount(versioned, 'persisted');
    expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('persisted');
    for (let i = 0; i < 12; i++) await tick(1000);
    expect(hooks.save).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves 1500ms debounce through clock renders (versioned=%s)', async (versioned) => {
    await mount(versioned); await answer('station');
    await tick(1000); expect(hooks.save).not.toHaveBeenCalled();
    await tick(499); expect(hooks.save).not.toHaveBeenCalled();
    await tick(1); expect(hooks.save).toHaveBeenCalledExactlyOnceWith([{ questionId: 'question', response: 'station' }]);
    for (let i = 0; i < 12; i++) await tick(1000);
    expect(hooks.save).toHaveBeenCalledTimes(1);
  });

  it('debounces edits to the latest answer rather than saving a stale closure', async () => {
    await mount(true); await answer('old'); await tick(1000); await answer('new');
    await tick(1000); expect(hooks.save).not.toHaveBeenCalled();
    await tick(500); expect(hooks.save).toHaveBeenCalledExactlyOnceWith([{ questionId: 'question', response: 'new' }]);
  });

  it.each([false, true])('serializes an edit made during an in-flight save (versioned=%s)', async (versioned) => {
    let resolve!: (value: unknown) => void;
    hooks.save.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await mount(versioned); await answer('first'); await tick(1000); await tick(500);
    expect(hooks.save).toHaveBeenCalledTimes(1);
    await answer('latest'); await tick(1000); await tick(500);
    expect(hooks.save).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ saved: 1 }));
    for (let i = 0; i < 10; i++) await tick(1000);
    expect(hooks.save.mock.calls.map(([answers]) => answers[0].response)).toEqual(['first', 'latest']);
  });

  it('retains failed dirty answers and retries on the existing online event', async () => {
    hooks.save.mockRejectedValueOnce(new Error('offline'));
    await mount(true); await answer('recover'); await tick(1000); await tick(500);
    expect(hooks.save).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(hooks.save).toHaveBeenCalledTimes(2);
    expect(hooks.save.mock.calls[1][0]).toEqual([{ questionId: 'question', response: 'recover' }]);
  });

  it.each([false, true])('submission waits for an older autosave before sending latest answers (versioned=%s)', async (versioned) => {
    let resolve!: (value: unknown) => void;
    hooks.save.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal('confirm', () => true);
    await mount(versioned); await answer('first'); await tick(1000); await tick(500);
    await answer('latest');
    const finish = [...host.querySelectorAll('button')].find((button) => button.textContent === 'submit')!;
    await act(async () => finish.click());
    if (versioned) {
      const confirmSubmission = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Submit exam')!;
      await act(async () => confirmSubmission.click());
    }
    expect(hooks.save).toHaveBeenCalledTimes(1); expect(hooks.other).not.toHaveBeenCalled();
    await act(async () => resolve({ saved: 1 }));
    expect(hooks.save.mock.calls.map(([answers]) => answers[0].response)).toEqual(['first', 'latest']);
    expect(hooks.other).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 12; i++) await tick(1000);
    expect(hooks.save).toHaveBeenCalledTimes(2);
  });
});
