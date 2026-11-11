// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/microphone', () => ({ primeMicrophonePermission: vi.fn(async () => 'granted') }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
import { ExamLauncherModal } from './exam-launcher-modal';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const exam = (profile: string) => ({
  id: 'e1', type: 'ielts_academic', title: 'Synthetic', profile, rawProfile: profile,
  skills: ['listening', 'reading', 'writing', 'speaking'], practiceSkills: ['listening', 'reading', 'writing', 'speaking'],
  sectionDurations: {},
});
async function render(profile: string, onStart = vi.fn()) {
  await act(async () => root.render(React.createElement(ExamLauncherModal, {
    open: true, onOpenChange: () => {}, exam: exam(profile) as never, onStart,
  })));
  return onStart;
}
const buttons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent ?? '');

describe('exam launcher', () => {
  it('does not offer Full Mock on a practice exam; it starts all ready sections as practice', async () => {
    const onStart = await render('practice');
    expect(buttons().some((t) => t.includes('Full Mock'))).toBe(false);
    const all = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes("Barcha bo'limlarni boshlash"))!;
    await act(async () => all.click());
    expect(onStart).toHaveBeenCalledWith('practice', ['listening', 'reading', 'writing', 'speaking'], 'cdi');
  });

  it('offers Full Mock on a full_mock exam', async () => {
    await render('full_mock');
    expect(buttons().some((t) => t.includes('Full Mock'))).toBe(true);
  });
});
