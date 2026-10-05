import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockExamDetail } from '@/lib/types';

const harness = vi.hoisted(() => ({
  stateIndex: 0,
  image: null as File | null,
  effects: [] as Array<() => unknown>,
  saveContent: vi.fn(),
  setMedia: vi.fn(),
}));

// Exercise the registered save callbacks with a pending image and stable refs.
// The controls themselves are covered by rendered preview/editor regressions.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const value = harness.stateIndex++ === 0 ? harness.image : typeof initial === 'function' ? initial() : initial;
      return [value, vi.fn()];
    },
    useRef: (current: unknown) => ({ current }),
    useMemo: (calculate: () => unknown) => calculate(),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-mock', () => ({
  useSaveMockGroupContent: () => ({ mutateAsync: harness.saveContent }),
  useSetMockGroupMedia: () => ({ mutateAsync: harness.setMedia }),
  useDeleteMockGroup: () => ({ mutateAsync: vi.fn() }),
}));

import { GroupEditor } from './GroupEditor';
import { ListeningPartEditor } from './ListeningPartEditor';
import { ReadingPassageEditor } from './ReadingPassageEditor';

const detail = {
  id: 'exam', type: 'ielts_academic', profile: 'practice', contentVersion: 1,
  sections: [{ id: 'section', skill: 'reading', groups: [{
    id: 'group', sortOrder: 0, title: 'Passage', instructions: 'Choose one answer.',
    passageText: 'A complete source passage.', hasAudio: true, audioPlayLimit: 1,
    questions: [{ id: 'question', number: 1, sortOrder: 0, type: 'multiple_choice',
      prompt: 'Where is the station?', options: ['River', 'Park'], correctAnswers: ['River'],
      acceptedVariants: [], points: 1 }],
  }] }],
} as unknown as MockExamDetail;

beforeEach(() => {
  harness.stateIndex = 0;
  harness.image = new File(['image'], 'map.png', { type: 'image/png' });
  harness.effects = [];
  harness.saveContent.mockReset();
  harness.setMedia.mockReset();
});

describe.each([
  ['generic', GroupEditor],
  ['listening', ListeningPartEditor],
  ['reading', ReadingPassageEditor],
] as const)('%s editor save versions', (_name, Editor) => {
  it.each([false, true])('uses the committed version for the next save after an upload (initial failure: %s)', async (failFirstUpload) => {
    let version = 1;
    let failUpload = failFirstUpload;
    harness.saveContent.mockImplementation(async (input: { expectedContentVersion: number }) => {
      if (input.expectedContentVersion !== version) throw new Error('Stale draft version');
      return { version: ++version, questions: [{ id: 'question', number: 1 }], group: detail.sections[0].groups[0] };
    });
    harness.setMedia.mockImplementation(async () => {
      if (failUpload) { failUpload = false; throw new Error('Temporary upload failure'); }
      return { id: 'group', hasAudio: true, audioUrl: null, imageUrl: '/image', version: ++version };
    });
    let save: (() => Promise<boolean>) | null = null;
    Editor({ examId: 'exam', detail, sectionId: 'section', groupId: 'group',
      onSelect: vi.fn(), onDirty: vi.fn(), registerSave: (callback) => { save = callback; } });
    harness.effects.forEach((effect) => effect());
    expect(save).not.toBeNull();
    const runSave = save as unknown as () => Promise<boolean>;
    expect(await runSave()).toBe(!failFirstUpload);
    expect(await runSave()).toBe(true);
    expect(await runSave()).toBe(true);
    expect(harness.saveContent.mock.calls.map(([input]) => input.expectedContentVersion))
      .toEqual(failFirstUpload ? [1, 2, 4] : [1, 3, 5]);
    expect(harness.setMedia).toHaveBeenCalledTimes(3);
  });
});
