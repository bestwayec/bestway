// @vitest-environment jsdom
// Regression: the exam definition loads asynchronously. A doSubmit memoised on the first
// render (exam undefined => total 0) used to refuse every hand-in with the "0/0" toast.
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockAttemptDetail, MockExamDetail } from '@/lib/types';

const hooks = vi.hoisted(() => ({
  save: vi.fn(async (answers: unknown[]) => ({ saved: answers.length })),
  other: vi.fn(async () => ({})),
  toastError: vi.fn(),
  exam: undefined as MockExamDetail | undefined,
}));
// next-intl returns a referentially stable `t`; a fresh function per render would hide the stale closure.
const translate = vi.hoisted(() => (key: string) => key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('sonner', () => ({ toast: { error: hooks.toastError, success: vi.fn(), message: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/use-mock', () => ({
  useMockExam: () => ({ data: hooks.exam }),
  useAudioTimestamps: () => ({ data: null }),
  useBulkMockAnswers: () => ({ isPending: false, mutate: hooks.other, mutateAsync: hooks.save }),
  useSubmitMock: () => ({ isPending: false, mutateAsync: hooks.other }),
  useAdvanceMockSection: () => ({ isPending: false, mutateAsync: hooks.other }),
  useFlagMockCheat: () => ({ mutate: hooks.other }),
  useReportLiveRoomProgress: () => ({ isPending: false, mutate: hooks.other }),
  useUploadMockSpeaking: () => ({ isPending: false, mutate: hooks.other }),
}));
vi.mock('@/lib/durable-recordings', () => ({ hasPendingRecordings: async () => false, hasActiveRecording: () => false }));
import { MockRunner } from './mock-runner';

let host: HTMLDivElement;
let root: Root;

const exam = {
  id: 'exam', title: 'Late exam', type: 'ielts_academic', questionCount: 1,
  sections: [{ id: 'reading', skill: 'reading', groups: [{ id: 'group', title: 'Passage', questions: [
    { id: 'question', number: 1, type: 'short_answer', prompt: 'Where?', response: 'station' },
  ] }] }],
} as unknown as MockExamDetail;
const attempt = {
  id: 'attempt', examId: 'exam', mode: 'practice', flowMode: 'single_skill', currentSkill: 'reading',
  serverTime: new Date().toISOString(), sections: exam.sections,
} as unknown as MockAttemptDetail;

beforeEach(() => {
  hooks.save.mockClear(); hooks.other.mockClear(); hooks.toastError.mockClear();
  hooks.exam = undefined;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('MockRunner submit when the exam definition arrives after the first render', () => {
  it('uses the loaded question total instead of the stale first-render zero', async () => {
    vi.stubGlobal('confirm', () => true);
    const render = () => act(async () => root.render(React.createElement(MockRunner, { attempt })));
    await render();            // first render: exam not loaded yet
    hooks.exam = exam;
    await render();            // exam query resolved
    const finish = [...host.querySelectorAll('button')].find((button) => button.textContent === 'submit');
    expect(finish).toBeTruthy();
    await act(async () => finish!.click());
    expect(hooks.toastError).not.toHaveBeenCalledWith(expect.stringContaining('0/0'));
    expect(hooks.other).toHaveBeenCalledTimes(1);
  });
});
