import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const auth = vi.hoisted(() => ({ access: vi.fn(), refresh: vi.fn(), clear: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ getAccessToken: auth.access, getRefreshToken: auth.refresh, clearSessionCookies: auth.clear }));
import { POST } from './route';
const request = () => new NextRequest('http://localhost/api/auth/logout', { method: 'POST' });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('revokes with the refresh bearer even if the access token has expired', async () => {
  auth.access.mockResolvedValue('expired-access'); auth.refresh.mockResolvedValue('synthetic-refresh');
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/logout-refresh$/);
  expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ refreshToken: 'synthetic-refresh' }));
  expect(fetch.mock.calls[0][1].headers.authorization).toBeUndefined();
  expect(auth.clear).toHaveBeenCalledOnce();
});

it('clears local cookies but reports that server revocation is unconfirmed when offline', async () => {
  auth.access.mockResolvedValue(undefined); auth.refresh.mockResolvedValue('synthetic-refresh');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect((await response.json()).error.code).toBe('LOGOUT_UNCONFIRMED');
  expect(auth.clear).toHaveBeenCalledOnce();
});
