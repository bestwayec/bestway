import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MockAttemptDetail } from '@/lib/types';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/use-mock', () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() });
  return {
    useMockExam: () => ({ data: { title: 'Resume fixture', type: 'multilevel', questionCount: 0, sections: ['listening','reading','writing','speaking'].map((skill) => ({ id: skill, skill, instructions: `Current ${skill} content`, groups: [] })) } }),
    useBulkMockAnswers: mutation, useSubmitMock: mutation, useFlagMockCheat: mutation,
    useAdvanceMockSection: mutation, useUploadMockSpeaking: mutation,
  };
});
import { MockRunner } from './mock-runner';

describe('resuming the rendered full-test section', () => {
  it.each(['reading','writing','speaking'])('opens the server-selected %s section on the first render', (skill) => {
    const attempt = { id:'resume', examId:'exam', mode:'timed', flowMode:'full_test', currentSkill:skill, specificationVersion:'UZBMB_MULTILEVEL_EN_2026_V1', sections:[] } as unknown as MockAttemptDetail;
    const html = renderToStaticMarkup(React.createElement(MockRunner, { attempt }));
    expect(html).toContain(`Current ${skill} content`);
    expect(html).not.toContain('Current listening content');
  });
});
