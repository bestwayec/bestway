// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentAssignmentsWidget, type StudentAssignmentItem } from './StudentAssignmentsWidget';
import { apiClient } from '@/lib/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const widget = (props?: React.ComponentProps<typeof StudentAssignmentsWidget>) =>
  React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    React.createElement(StudentAssignmentsWidget, props));

// React Query resolves the mocked request on a later tick than the initial render.
async function renderWidget(props?: React.ComponentProps<typeof StudentAssignmentsWidget>) {
  await act(async () => {
    root.render(widget(props));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mockPush = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, 'data-href': href, ...rest }, children),
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('next-intl', async () => {
  const en = (await import('../../../messages/en.json')).default as Record<string, unknown>;
  const lookup = (ns: string, key: string) =>
    `${ns}.${key}`.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), en);
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = lookup(ns, key);
      return typeof found === 'string'
        ? found.replace(/\{(\w+)[^}]*\}/g, (_, n: string) => String(values?.[n] ?? ''))
        : key;
    },
    useFormatter: () => ({ dateTime: (value: Date) => value.toISOString().slice(0, 16) }),
  };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

const sampleAssignments: StudentAssignmentItem[] = [
  {
    id: 'asg-vocab-1',
    cohort_id: 'grp-1',
    cohort_name: 'IELTS Intensive',
    title: 'Oxford 3000 Words Unit 1',
    deadline: new Date(Date.now() + 86400000 * 3).toISOString(),
    min_pass_percent: 80,
    is_submitted: false,
    score_percent: null,
    is_passed: false,
    is_overdue: false,
    status: 'pending',
    vocabulary_set_id: 'vocab-set-1',
    exam_id: null,
  },
  {
    id: 'asg-exam-2',
    cohort_id: 'grp-1',
    cohort_name: 'IELTS Intensive',
    title: 'Full Mock Listening Test #4',
    deadline: new Date(Date.now() + 86400000 * 2).toISOString(),
    min_pass_percent: 75,
    is_submitted: false,
    score_percent: null,
    is_passed: false,
    is_overdue: false,
    status: 'pending',
    vocabulary_set_id: null,
    exam_id: 'exam-mock-4',
    can_launch_exam: true,
  },
  {
    id: 'asg-done-3',
    cohort_id: 'grp-1',
    cohort_name: 'IELTS Intensive',
    title: 'Grammar Foundations Review',
    deadline: new Date(Date.now() - 86400000).toISOString(),
    min_pass_percent: 70,
    is_submitted: true,
    score_percent: 88,
    is_passed: true,
    is_overdue: false,
    status: 'passed',
    vocabulary_set_id: 'vocab-set-review',
    exam_id: null,
  },
];

describe('StudentAssignmentsWidget interactive behavior', () => {
  it('switches between Active, All, and Completed tabs on click', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(sampleAssignments);

    await renderWidget();

    // Default tab is "active": shows 2 pending assignments, 1 completed hidden
    expect(host.textContent).toContain('Oxford 3000 Words Unit 1');
    expect(host.textContent).toContain('Full Mock Listening Test #4');
    expect(host.textContent).toContain('Deadline: ');
    expect(host.textContent).not.toContain('Muddat');
    expect(host.textContent).not.toContain('Grammar Foundations Review');

    // Click "All" tab
    const allTabBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('All (3)'));
    expect(allTabBtn).toBeDefined();
    await act(async () => {
      allTabBtn!.click();
    });

    expect(host.textContent).toContain('Oxford 3000 Words Unit 1');
    expect(host.textContent).toContain('Full Mock Listening Test #4');
    expect(host.textContent).toContain('Grammar Foundations Review');

    // Click "Completed" tab
    const completedTabBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Completed (1)'));
    expect(completedTabBtn).toBeDefined();
    await act(async () => {
      completedTabBtn!.click();
    });

    expect(host.textContent).not.toContain('Oxford 3000 Words Unit 1');
    expect(host.textContent).not.toContain('Full Mock Listening Test #4');
    expect(host.textContent).toContain('Grammar Foundations Review');
  });

  it('renders direct deep link to vocabulary assignment', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([sampleAssignments[0]]);

    await renderWidget();

    const vocabLink = host.querySelector('a[data-href="/vocabulary/assignment/asg-vocab-1"]');
    expect(vocabLink).not.toBeNull();
    expect(vocabLink?.getAttribute('href')).toBe('/vocabulary/assignment/asg-vocab-1');
  });

  it('navigates to assigned exam when exam start button is clicked', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/student/my-assignments') {
        return [sampleAssignments[1]];
      }
      if (url.includes('/student/assignments/asg-exam-2/exam')) {
        return { id: 'exam-mock-4' };
      }
      return null;
    });

    await renderWidget();

    expect(host.textContent).toContain('Full Mock Listening Test #4');
    const startBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Start'));
    expect(startBtn).toBeDefined();

    await act(async () => {
      startBtn!.click();
    });

    expect(mockPush).toHaveBeenCalledWith('/mock/exam-mock-4');
  });
});

describe('StudentAssignmentsWidget enrollment-aware empty state', () => {
  it('does not tell an enrolled student to join a group when there are no assignments', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([]);
    await renderWidget({ groupName: 'Local Group A' });
    const text = host.textContent ?? '';
    expect(text).toContain('No assignments from your teacher yet');
    expect(text).toContain('You are in Local Group A');
    expect(text).toContain('No assignments yet');
    expect(text).not.toContain('All assignments are done');
    expect(text).not.toMatch(/not in a group/i);
    expect(text).not.toContain('Muddat');
    expect(Array.from(host.querySelectorAll('button')).some((b) => /join/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('keeps the join-by-code path for a student without a classroom', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([]);
    await renderWidget({ groupName: null });
    expect(host.textContent).toMatch(/not in a group/i);
    expect(Array.from(host.querySelectorAll('button')).some((b) => /join/i.test(b.textContent ?? ''))).toBe(true);
  });
});
