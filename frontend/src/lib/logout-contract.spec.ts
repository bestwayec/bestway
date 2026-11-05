import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi } from './api-client';

afterEach(() => vi.unstubAllGlobals());

describe('logout acknowledgement', () => {
  it('accepts a confirmed server logout', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(authApi.logout()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });

  it('does not report success when server-side revocation was not confirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 502 })));
    await expect(authApi.logout()).rejects.toMatchObject({ code: 'LOGOUT_UNCONFIRMED', status: 502 });
  });

  it('propagates a network failure for the caller to warn the user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(authApi.logout()).rejects.toThrow('offline');
  });
});
