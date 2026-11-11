// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { HydrationGate } from './hydration-gate';

// createElement passes children positionally; type the component accordingly.
const Gate = HydrationGate as unknown as React.FC<{ fallback: React.ReactNode; children?: React.ReactNode }>;
const view = (text: string) => React.createElement(Gate,
  { fallback: React.createElement('p', null, 'loading') }, React.createElement('p', null, text));

describe('HydrationGate', () => {
  it('server HTML is the fallback, and hydrating with client-only data does not mismatch', async () => {
    const html = renderToString(view('Hello, Ali'));
    expect(html).toContain('loading');
    expect(html).not.toContain('Ali');
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const recoverable = vi.fn();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    await act(async () => { hydrateRoot(host, view('Hello, Ali'), { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.textContent).toBe('Hello, Ali');
  });
});
