// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import type { GroupListItem } from '@/lib/types';
import { StudentTransferDialog } from './student-transfer-dialog';

vi.mock('@/lib/api-client', () => ({ api: { post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', async () => {
  const en = (await import('../../../messages/en.json')).default as Record<string, unknown>;
  const lookup = (ns: string, key: string) =>
    `${ns}.${key}`.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), en);
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = lookup(ns, key);
      if (typeof found !== 'string') return `${ns}.${key}`;
      return found.replace(/\{(\w+), plural,[^}]*\{[^}]*\}[^}]*\{([^}]*)\}\}/g, (_, n: string, other: string) => other.replace('#', String(values?.[n] ?? '')))
        .replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? ''));
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group = (id: string, name: string, extra: Partial<GroupListItem> = {}): GroupListItem => ({
  id, name, teacherId: 't-1', teacherName: 'Teacher', schedule: null, createdAt: '2026-01-01T00:00:00Z', studentsCount: 4, ...extra,
});
const groups = [group('g-src', 'Source'), group('g-arch', 'Archived', { archived: true }), group('g-b', 'Beta'), group('g-c', 'Gamma')];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(student: { id: string; name: string } | null, onClose = vi.fn(), list = groups) {
  act(() => {
    root.render(React.createElement(QueryClientProvider, { client },
      React.createElement(StudentTransferDialog, { sourceGroupId: 'g-src', student, groups: list, onClose })));
  });
  return onClose;
}
const select = () => document.querySelector<HTMLSelectElement>('#transfer-target-group');
const submitButton = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Move student')!;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('StudentTransferDialog', () => {
  it('offers only other non-archived groups, labelled for assistive technology', () => {
    render({ id: 's-1', name: 'Ali' });
    const options = Array.from(select()!.options).map((o) => o.value);
    expect(options).toEqual(['g-b', 'g-c']);
    expect(document.querySelector('label[for="transfer-target-group"]')?.textContent).toBe('New group');
    expect(document.body.textContent).toContain('Move Ali to another active group');
    expect(select()!.options[0].textContent).toContain('4 students');
  });

  it('posts the student to the chosen target group and closes on success', async () => {
    vi.mocked(api.post).mockResolvedValue({ added: true });
    const onClose = render({ id: 's-1', name: 'Ali' });
    act(() => {
      select()!.value = 'g-c';
      select()!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { submitButton().click(); });
    expect(api.post).toHaveBeenCalledWith('/groups/g-c/students', { studentId: 's-1', sourceGroupId: 'g-src' });
    expect(toast.success).toHaveBeenCalledWith('Student moved to the selected group');
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the dialog open and surfaces the server refusal', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Forbidden by classroom ownership'));
    const onClose = render({ id: 's-1', name: 'Ali' });
    await act(async () => { submitButton().click(); });
    expect(toast.error).toHaveBeenCalledWith('Forbidden by classroom ownership');
    expect(onClose).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);
  });

  it('explains when no target group exists instead of offering a dead action', () => {
    render({ id: 's-1', name: 'Ali' }, vi.fn(), [group('g-src', 'Source'), group('g-arch', 'Archived', { archived: true })]);
    expect(select()).toBeNull();
    expect(document.body.textContent).toContain('There is no other active group');
    expect(submitButton().disabled).toBe(true);
  });
});
