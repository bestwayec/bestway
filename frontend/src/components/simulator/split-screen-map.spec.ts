// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({ Link: 'a', useRouter: () => ({ push: vi.fn() }) }));
import { SplitScreenMap } from './CDLayout';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = (props: { groupId?: string; hasImage: boolean }) => act(async () => root.render(
  React.createElement(SplitScreenMap, { ...props, title: 'Plan' }, React.createElement('p', null, 'questions'))));

describe('simulator Part 4 map', () => {
  it('loads the map through the authenticated proxy, never a raw /media path', async () => {
    await render({ groupId: 'grp-l4', hasImage: true });
    const img = host.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/backend/mock/groups/grp-l4/image');
  });

  it('shows no invented map when the part has no image', async () => {
    await render({ groupId: 'grp-other', hasImage: false });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });
});
