// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadQueue } from "@/lib/answer-queue";
import type { MockAttemptDetail, MockExamDetail } from '@/lib/types';

type Answer = { questionId: string; response: string; editedAt: number; baseRevision?: string | null };
const revision = '2026-11-13T10:00:06.000Z';
const acknowledged = (answers: Answer[]) => ({
  saved: answers.length,
  receipts: Object.fromEntries(answers.map((item) => [item.questionId, { editedAt: item.editedAt, revision, status: 'saved' }])),
});
const conflict = (answers: Answer[]) => ({
  saved: 1,
  receipts: { question: { editedAt: answers[0].editedAt, status: 'conflict', revision, response: 'from the other tab' } },
});
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
  hooks.save.mockReset().mockImplementation(async (answers) => acknowledged(answers)); hooks.submit.mockReset().mockResolvedValue({ status: 'completed' });
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
    const queued = loadQueue('attempt');
    expect(queued.question.response).toBe('typed offline');
    expect(queued.question.editedAt).toBe(Date.parse('2026-11-13T10:00:05Z'));   // typed at 10:00:00 local, server clock 5 s ahead
    await act(async () => root.unmount()); root = createRoot(host);

    hooks.save.mockReset().mockImplementation(async (answers) => acknowledged(answers));
    await mount('saved before');
    expect(input().value).toBe('typed offline');
    await tick(1500);
    expect(hooks.save).toHaveBeenLastCalledWith([{ questionId: 'question', response: 'typed offline', editedAt: queued.question.editedAt, baseRevision: null }]);
    expect(loadQueue('attempt')).toEqual({});
  });

  it('shows how many answers wait on the device while saving fails, and hides it once they are sent', async () => {
    hooks.save.mockRejectedValueOnce(new Error('offline'));
    await mount(); await answer('waiting'); await tick(1500);
    expect(host.querySelector('[data-testid="answer-queue-banner"]')?.textContent).toContain('queueWaiting:{"count":1}');
    await act(async () => window.dispatchEvent(new Event('online')));
    await tick(0);
    expect(host.querySelector('[data-testid="answer-queue-banner"]')).toBeNull();
  });

  it('keeps a newer edit when an earlier save conflicts and requires an explicit choice', async () => {
    let reply!: (result: unknown) => void;
    hooks.save.mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    await mount(); await answer('old edit'); await tick(1500);
    await answer('new edit');
    await act(async () => reply(conflict(hooks.save.mock.calls[0][0])));
    expect(input().value).toBe('new edit');
    expect(loadQueue('attempt').question.response).toBe('new edit');
    expect(host.textContent).toContain('queueConflicts');
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'keepLocalAnswers')!;
    await act(async () => retry.click()); await tick(1500);
    expect(hooks.save).toHaveBeenLastCalledWith([expect.objectContaining({ response: 'new edit', baseRevision: revision })]);
    expect(loadQueue('attempt')).toEqual({});
  });

  it('keeps an edit pending when the response has a count but no matching receipt', async () => {
    hooks.save.mockResolvedValueOnce({ saved: 1 });
    await mount(); await answer('still pending'); await tick(1500);
    expect(loadQueue('attempt').question.response).toBe('still pending');
    expect(host.textContent).toContain('saveError');
  });

  it('reports when the browser cannot retain an edit', async () => {
    const cacheWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage full', 'QuotaExceededError');
    });
    try {
      await mount(); await answer('memory only');
      expect(host.textContent).toContain('queueStorageUnavailable');
      expect(input().value).toBe('memory only');
      await tick(1500);
      expect(host.textContent).not.toContain('queueStorageUnavailable');
    } finally {
      cacheWrite.mockRestore();
    }
  });

  it('retains an edit rejected after the server session expires until reauthentication', async () => {
    hooks.save.mockRejectedValueOnce(new ApiError('SESSION_EXPIRED', 'Sign in again', 401));
    await mount(); await answer('recover after sign-in'); await tick(1500);
    expect(loadQueue('attempt').question.response).toBe('recover after sign-in');
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(loadQueue('attempt')).toEqual({});
  });

  it.each([
    [403, 'SECTION_LOCKED'],
    [408, 'TIMEOUT'],
    [409, 'EXAM_SESSION_ELSEWHERE'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_ERROR'],
    [502, 'BACKEND_PROXY_ERROR'],
    [503, 'SERVICE_UNAVAILABLE'],
  ])('keeps a pending edit and never records a receipt after HTTP %s', async (status, code) => {
    hooks.save.mockRejectedValueOnce(new ApiError(code, 'Synthetic save rejection', status));
    await mount(); await answer('still on this device'); await tick(1500);
    expect(loadQueue('attempt').question.response).toBe('still on this device');
    const notice = host.querySelector('[data-testid="answer-queue-banner"]');
    // Session takeover has its own gate. Other failures announce the queued edit.
    if (status === 409) expect(notice).toBeNull();
    else expect(notice?.textContent).toContain('queueWaiting');
    expect(host.textContent).not.toContain('saveSaved');
    expect(hooks.submit).not.toHaveBeenCalled();
  });
});

describe('finish when the hand-in cannot be confirmed', () => {
  it('keeps the editor open when Finish is clicked offline before any request', async () => {
    const network = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      await mount('final'); await finish();
      expect(hooks.submit).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
      await answer('changed while offline');
      expect(loadQueue('attempt').question.response).toBe('changed while offline');
    } finally {
      network.mockRestore();
    }
  });

  it('recovers the uncertain hand-in on reload and verifies it without resending finished answers', async () => {
    hooks.submit.mockRejectedValueOnce(new ApiError('GATEWAY_TIMEOUT', 'Connection timed out', 503));
    hooks.get.mockRejectedValueOnce(new Error('offline'));
    await mount('final'); await finish();
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).not.toBeNull();
    await act(async () => root.unmount()); root = createRoot(host);
    await mount('final');
    const banner = host.querySelector('[data-testid="submit-unconfirmed"]')!;
    hooks.get.mockResolvedValueOnce({ status: 'completed' });
    await act(async () => banner.querySelector('button')!.click());
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
    expect(hooks.submit).toHaveBeenCalledTimes(1);
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it('a gateway error with the attempt still open shows "answers saved" and a retry, never a second attempt', async () => {
    hooks.submit.mockRejectedValueOnce(new ApiError('BACKEND_PROXY_ERROR', 'Bad gateway', 502));
    hooks.get.mockResolvedValue({ status: 'in_progress' });
    await mount('final'); await finish();
    expect(hooks.get).toHaveBeenCalledWith('/mock/attempts/attempt');
    expect(hooks.save).not.toHaveBeenCalled();
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
    expect(hooks.submit).toHaveBeenCalledTimes(1);   // the detail response confirmed the hand-in
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
  });

  it('a refusal from the server (4xx) is reported as before, without the unconfirmed banner', async () => {
    hooks.submit.mockRejectedValueOnce(new ApiError('MOCK_ATTEMPT_INCOMPLETE', 'Missing work', 400));
    await mount('final'); await finish();
    expect(hooks.get).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="submit-unconfirmed"]')).toBeNull();
  });
});
