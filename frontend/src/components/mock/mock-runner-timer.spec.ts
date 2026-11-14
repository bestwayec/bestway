// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockAttemptDetail, MockExamDetail } from '@/lib/types';

const hooks = vi.hoisted(() => ({
  save: vi.fn(async () => ({ saved: 1 })), submit: vi.fn(async () => ({ status: 'completed' })), other: vi.fn(async () => ({})),
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
import { MockRunner } from './mock-runner';

let host: HTMLDivElement;
let root: Root;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const timer = () => host.querySelector('[role="timer"]')!;
async function mount(skill: 'reading' | 'writing' | 'listening', secondsLeft: number) {
  const type = skill === 'writing' ? 'essay_task1' : 'short_answer';
  hooks.exam = {
    id: 'exam', title: 'Timer', type: 'ielts_academic', questionCount: 1,
    sections: [{ id: skill, skill, groups: [{ id: 'g', title: 'Part', questions: [{ id: 'q', number: 1, type, prompt: 'Q?', response: 'x' }] }] }],
  } as unknown as MockExamDetail;
  const attempt = {
    id: 'att', examId: 'exam', mode: 'timed', flowMode: 'single_skill', currentSkill: skill,
    deadlineAt: new Date(Date.now() + secondsLeft * 1000).toISOString(), serverTime: new Date().toISOString(),
    specificationVersion: null, sections: hooks.exam.sections,
  } as unknown as MockAttemptDetail;
  await act(async () => root.render(React.createElement(MockRunner, { attempt })));
  await tick(1000);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  hooks.submit.mockClear(); localStorage.clear(); Element.prototype.scrollIntoView = () => {};
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('exam timer', () => {
  it.each(['reading', 'writing'] as const)('%s: flashes and announces at 10:00 and 5:00, danger colour in the last minute', async (skill) => {
    await mount(skill, 10 * 60 + 3);
    expect(timer().getAttribute('data-timer-alert')).toBe('none');
    await tick(3000);
    expect(timer().getAttribute('data-timer-alert')).toBe('ten');
    expect(host.textContent).toContain('timeWarning:{"minutes":10}');
    await tick(11_000);
    expect(timer().getAttribute('data-timer-alert')).toBe('none');
    await tick((5 * 60 - 14) * 1000 + 3000);
    expect(timer().getAttribute('data-timer-alert')).toBe('five');
    await tick((4 * 60) * 1000);
    expect(timer().getAttribute('data-timer-tone')).toBe('danger');
  });

  it('listening has no 10/5 minute flash but keeps the last-minute colour', async () => {
    await mount('listening', 10 * 60 + 2);
    await tick(3000);
    expect(timer().getAttribute('data-timer-alert')).toBe('none');
    await tick(9 * 60 * 1000 + 5000);
    expect(timer().getAttribute('data-timer-tone')).toBe('danger');
  });

  it('time is counted from the server deadline: a reload does not give time back', async () => {
    await mount('reading', 600);
    await act(async () => root.unmount()); root = createRoot(host);
    vi.setSystemTime(new Date('2026-11-13T10:05:00Z'));
    const attempt = {
      id: 'att', examId: 'exam', mode: 'timed', flowMode: 'single_skill', currentSkill: 'reading',
      deadlineAt: '2026-11-13T10:10:01.000Z', serverTime: new Date().toISOString(), specificationVersion: null, sections: hooks.exam!.sections,
    } as unknown as MockAttemptDetail;
    await act(async () => root.render(React.createElement(MockRunner, { attempt })));
    await tick(1000);
    expect(timer().textContent).toBe('05:00');
  });

  it('hands the section in automatically when the time is up', async () => {
    await mount('reading', 3);
    await tick(4000);
    expect(hooks.submit).toHaveBeenCalled();
  });
});
