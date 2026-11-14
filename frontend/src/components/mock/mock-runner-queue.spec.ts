// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockAttemptDetail, MockExamDetail } from '@/lib/types';

type Answer = { questionId: string; response: string; editedAt?: number };
const hooks = vi.hoisted(() => ({
  save: vi.fn<(answers: Answer[]) => Promise<unknown>>(),
  submit: vi.fn<(payload?: unknown) => Promise<unknown>>(),
  other: vi.fn(async () => ({})),
  get: vi.fn<(path: string) => Promise<unknown>>(),
  exam: undefined as MockExamDetail | undefined,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }));
vi.mock('@/hooks/use-mock', () => ({
  useMockExam: () => ({ data: hooks.exam }),
  useAudioTimestamps: () => ({ data: null }),
  useBulkMockAnswers: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: hooks.save }),
  useSubmitMock: () => ({ isPending: false, mutateAsync: hooks.submit }),
  useAdvanceMockSection: () => ({ isPending: false, mutateAsync: hooks.other }),
  useFlagMockCheat: () => ({ mutate: hooks.other }),
  useReportLiveRoomProgress: () => ({ isPending: false, mutate: hooks.other }),
  useUploadMockSpeaking: () => ({ isPending: false, mutate: hooks.other }),
}));
vi.mock('@/lib/durable-recordings', () => ({ hasPendingRecordings: async () => false, hasActiveRecording: () => false }));
vi.mock('@/lib/api-client', async (original) => ({ ...(await original<typeof import('@/lib/api-client')>()), api: { get: (path: string) => hooks.get(path), post: vi.fn(), put: vi.fn() } }));
import { ApiError } from '@/lib/api-client';
import { MockRunner } from './mock-runner';

let host: HTMLDivElement;
let root: Root;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const input = () => host.querySelector<HTMLInputElement>('input[aria-label^="answerFor"]')!;
async function answer(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(response = '') {
  hooks.exam = {
    id: 'exam', title: 'Queue', type: 'ielts_academic', questionCount: 1,
    sections: [{ id: 'reading', skill: 'reading', groups: [{ id: 'group', title: 'Passage', questions: [
      { id: 'question', number: 1, type: 'short_answer', prompt: 'Where?', response },
    ] }] }],
  } as unknown as MockExamDetail;
  const attempt = {
    id: 'attempt', examId: 'exam', mode: 'timed', flowMode: 'single_skill', currentSkill: 'reading',
    deadlineAt: new Date(Date.now() + 3600000).toISOString(), serverTime: new Date(Date.now() + 5000).toISOString(),
    specificationVersion: null, sections: hooks.exam.sections,
  } as unknown as MockAttemptDetail;
  await act(async () => root.render(React.createElement(MockRunner, { attempt })));
}
const finish = async () => {
  vi.stubGlobal('confirm', () => true);
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'submit')!;
  await act(async () => { button.click(); });
  await tick(0);
};

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  hooks.save.mockReset().mockResolvedValue({ saved: 1 }); hooks.submit.mockReset().mockResolvedValue({ status: 'completed' });
  hooks.get.mockReset(); hooks.other.mockClear(); localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('exam answer queue', () => {
  it('keeps an unsent edit on the device through a reload and sends it with its edit time on the server clock', async () => {
    hooks.save.mockRejectedValue(new Error('offline'));
    await mount('saved before');
    await answer('typed offline'); await tick(1500);
    const queued = JSON.parse(localStorage.getItem('bw_answer_queue_attempt')!);
    expect(queued.question.response).toBe('typed offline');
    expect(queued.question.editedAt).toBe(Date.parse('2026-11-13T10:00:05Z'));   // typed at 10:00:00 local, server clock 5 s ahead
    await act(async () => root.unmount()); root = createRoot(host);

    hooks.save.mockReset().mockResolvedValue({ saved: 1 });
    await mount('saved before');
    expect(input().value).toBe('typed offline');
    await tick(1500);
    expect(hooks.save).toHaveBeenLastCalledWith([{ questionId: 'question', response: 'typed offline', editedAt: queued.question.editedAt }]);
    expect(localStorage.getItem('bw_answer_queue_attempt')).toBeNull();
  });

  it('shows how many answers wait on the device while saving fails, and hides it once they are sent', async () => {
    hooks.save.mockRejectedValueOnce(new Error('offline'));
    await mount(); await answer('waiting'); await tick(1500);
    expect(host.querySelector('[data-testid="answer-queue-banner"]')?.textContent).toContain('queueWaiting:{"count":1}');
    await act(async () => window.dispatchEvent(new Event('online')));
    await tick(0);
    expect(host.querySelector('[data-testid="answer-queue-banner"]')).toBeNull();
  });

  it('shows the newer server answer when the sent edit was older (last edit wins)', async () => {
    hooks.save.mockResolvedValueOnce({ saved: 1, stale: { question: 'from the other tab' } });
    await mount(); await answer('old edit'); await tick(1500);
    expect(input().value).toBe('from the other tab');
    expect(localStorage.getItem('bw_answer_queue_attempt')).toBeNull();
  });
});

describe('finish when the hand-in cannot be confirmed', () => {
  it('a gateway error with the attempt still open shows "answers saved" and a retry, never a second attempt', async () => {
    hooks.submit.mockRejectedValueOnce(new ApiError('BACKEND_PROXY_ERROR', 'Bad gateway', 502));
    hooks.get.mockResolvedValue({ status: 'in_progress' });
    await mount('final'); await finish();
    expect(hooks.get).toHaveBeenCalledWith('/mock/attempts/attempt');
    const banner = host.querySelector('[data-testid="submit-unconfirmed"]');
    expect(banner?.textContent).toContain('submitUnconfirmed');
    const retry = [...banner!.querySelectorAll('button')].find((b) => b.textContent?.includes('retrySubmit'))!;
    await act(async () => { retry.click(); }); await tick(0);
    expect(hooks.submit).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
  });

  it('a lost response for a hand-in that did happen is confirmed by the server, with no banner', async () => {
    hooks.submit.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    hooks.get.mockResolvedValue({ status: 'grading' });
    await mount('final'); await finish();
    expect(hooks.submit).toHaveBeenCalledTimes(2);   // the repeat returns the stored state and refreshes the page
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
  });

  it('a refusal from the server (4xx) is reported as before, without the unconfirmed banner', async () => {
    hooks.submit.mockRejectedValueOnce(new ApiError('MOCK_ATTEMPT_INCOMPLETE', 'Missing work', 400));
    await mount('final'); await finish();
    expect(hooks.get).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
  });
});
