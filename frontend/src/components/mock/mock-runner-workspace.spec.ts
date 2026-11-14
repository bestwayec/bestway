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
  put: vi.fn<(path: string, body: unknown) => Promise<unknown>>(),
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
vi.mock('@/lib/api-client', async (original) => ({ ...(await original<typeof import('@/lib/api-client')>()), api: { get: (path: string) => hooks.get(path), post: vi.fn(), put: (path: string, body: unknown) => hooks.put(path, body) } }));
import { MockRunner } from './mock-runner';

let host: HTMLDivElement;
let root: Root;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const buttons = () => [...host.querySelectorAll('button')];
const flagButton = () => buttons().find((b) => /^(flag|flagged)$/.test((b.textContent ?? '').trim()))!;
async function mount(annotations: unknown[] = []) {
  hooks.exam = {
    id: 'exam', title: 'Workspace', type: 'ielts_academic', questionCount: 2,
    sections: [{ id: 'reading', skill: 'reading', groups: [{ id: 'g1', title: 'Passage', passageText: 'The sky is blue on a clear day.', questions: [
      { id: 'q1', number: 1, type: 'short_answer', prompt: 'Where?', response: '' },
      { id: 'q2', number: 2, type: 'short_answer', prompt: 'When?', response: '' },
    ] }] }],
  } as unknown as MockExamDetail;
  const attempt = {
    id: 'att', examId: 'exam', mode: 'practice', flowMode: 'single_skill', currentSkill: 'reading',
    deadlineAt: null, serverTime: new Date().toISOString(), specificationVersion: null,
    sections: hooks.exam.sections, annotations,
  } as unknown as MockAttemptDetail;
  await act(async () => root.render(React.createElement(MockRunner, { attempt })));
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  hooks.save.mockReset().mockResolvedValue({ saved: 1 }); hooks.put.mockReset().mockResolvedValue({ saved: true });
  localStorage.clear();
  Element.prototype.scrollIntoView = () => {};
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

const serverDoc = [
  { kind: 'meta', version: 1, savedAt: Date.parse('2026-11-13T09:59:00Z') },
  { kind: 'flag', questionId: 'q2' },
  { kind: 'marks', key: 'att.g1.passage', highlights: ['blue'], greenHighlights: [], pinkHighlights: [], underlines: [],
    notes: [{ id: 'n1', quote: 'clear day', text: 'weather words', createdAt: '2026-11-13T09:58:00Z' }] },
];
type Doc = { annotations: Array<Record<string, unknown>> };

describe('exam workspace kept with the attempt', () => {
  it('restores flags, highlights and notes from the server when the exam opens', async () => {
    await mount(serverDoc);
    expect(host.textContent).toContain('flaggedCount:{"count":1}');
    expect(host.textContent).toContain('notesButton:{"count":1}');
    expect(JSON.parse(localStorage.getItem('bestway.cbt_annotations.att.g1.passage')!).highlights).toEqual(['blue']);
    expect(hooks.put).not.toHaveBeenCalled();
  });

  it('sends a changed flag to the server one second after the change', async () => {
    await mount(serverDoc);
    await act(async () => { flagButton().click(); });
    await tick(999); expect(hooks.put).not.toHaveBeenCalled();
    await tick(1);
    expect(hooks.put).toHaveBeenCalledTimes(1);
    const [path, body] = hooks.put.mock.calls[0] as [string, Doc];
    expect(path).toBe('/mock/attempts/att/annotations');
    expect(body.annotations[0]).toMatchObject({ kind: 'meta', version: 1 });
    const flags = body.annotations.filter((i) => i.kind === 'flag').map((i) => i.questionId).sort();
    expect(flags).not.toEqual(['q2']);
    expect(body.annotations.some((i) => i.kind === 'marks' && (i.highlights as string[]).includes('blue'))).toBe(true);
  });

  it('a note is deleted only after confirming, and the deletion is sent to the server', async () => {
    await mount(serverDoc);
    await act(async () => { buttons().find((b) => b.textContent?.startsWith('notesButton'))!.click(); });
    const panel = () => host.querySelector('[data-testid="exam-notes-panel"]')!;
    const click = async (label: string) => { await act(async () => { [...panel().querySelectorAll('button')].find((b) => b.textContent === label)!.click(); }); };
    expect(panel().textContent).toContain('weather words');
    await click('noteDelete'); await click('noteDeleteNo');
    expect(panel().textContent).toContain('weather words');
    await click('noteDelete'); await click('noteDeleteYes');
    expect(panel().textContent).not.toContain('weather words');
    await tick(1000);
    const body = hooks.put.mock.calls.at(-1)![1] as Doc;
    const marks = body.annotations.find((i) => i.kind === 'marks') as { notes: unknown[] } | undefined;
    expect(marks?.notes ?? []).toEqual([]);
  });

  it('a failed send is retried when the connection comes back', async () => {
    hooks.put.mockRejectedValueOnce(new Error('offline'));
    await mount(serverDoc);
    await act(async () => { flagButton().click(); }); await tick(1000);
    expect(hooks.put).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('online')); }); await tick(0);
    expect(hooks.put).toHaveBeenCalledTimes(2);
  });

  it('unsent edits on this device are kept over an older server copy and sent when the exam opens', async () => {
    localStorage.setItem('bestway.cbt_annotations.att.g1.passage', JSON.stringify({ highlights: ['offline'], greenHighlights: [], pinkHighlights: [], underlines: [], notes: [] }));
    localStorage.setItem('bw_workspace_flags_att', JSON.stringify(['q1']));
    localStorage.setItem('bw_workspace_edited_att', String(Date.parse('2026-11-13T09:59:30Z')));
    await mount(serverDoc);
    expect(host.textContent).toContain('flaggedCount:{"count":1}');
    await tick(0);
    const body = hooks.put.mock.calls[0][1] as Doc;
    expect(body.annotations.filter((i) => i.kind === 'flag').map((i) => i.questionId)).toEqual(['q1']);
    expect(JSON.stringify(body.annotations)).toContain('offline');
  });
});
