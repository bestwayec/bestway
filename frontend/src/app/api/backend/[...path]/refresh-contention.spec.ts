import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());

it('preserves existing cookies when another process holds the refresh lock', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  const request = new NextRequest('http://localhost/api/backend/example', {
    headers: { cookie: 'bw_at=old; bw_rt=synthetic-refresh' },
  });
  const response = await GET(request, { params: Promise.resolve({ path: ['example'] }) });
  expect(response.status).toBe(409);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect((await response.json()).error.code).toBe('REFRESH_IN_PROGRESS');
});

it('does not clear cookies on refresh network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockRejectedValueOnce(new Error('offline')));
  const request = new NextRequest('http://localhost/api/backend/example', { headers: { cookie: 'bw_at=old; bw_rt=synthetic-refresh' } });
  const response = await GET(request, { params: Promise.resolve({ path: ['example'] }) });
  expect(response.status).toBe(502);
  expect(response.headers.get('set-cookie')).toBeNull();
});

it('preserves rotated cookies when retrying the original request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ success: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh' } }))
    .mockRejectedValueOnce(new Error('offline')));
  const request = new NextRequest('http://localhost/api/backend/example', { headers: { cookie: 'bw_at=old; bw_rt=synthetic-refresh' } });
  const response = await GET(request, { params: Promise.resolve({ path: ['example'] }) });
  expect(response.status).toBe(502);
  expect(response.cookies.get('bw_rt')?.value).toBe('new-refresh');
});
