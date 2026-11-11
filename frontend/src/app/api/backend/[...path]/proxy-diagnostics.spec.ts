import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
import { GET, POST } from './route';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

it('labels a backend timeout and logs it without secrets or query strings', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(timeout));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const request = new NextRequest('http://localhost/api/backend/mock/attempts/a1/submit?secret=x', {
    method: 'POST', body: '{"confirm":true}', headers: { cookie: 'bw_at=access-token-value; bw_rt=refresh-token-value' },
  });
  const response = await POST(request, params(['mock', 'attempts', 'a1', 'submit']));
  expect(response.status).toBe(502);
  expect(response.headers.get('x-bw-proxy-error')).toBe('timeout');
  expect((await response.json()).error.code).toBe('BACKEND_UNREACHABLE');
  const line = JSON.parse(log.mock.calls[0][0] as string);
  expect(line).toMatchObject({ event: 'backend_proxy_error', reason: 'timeout', method: 'POST',
    path: '/api/backend/mock/attempts/a1/submit', timeoutMs: 8000 });
  const raw = String(log.mock.calls[0][0]);
  for (const secret of ['access-token-value', 'refresh-token-value', 'secret=x', 'confirm']) expect(raw).not.toContain(secret);
});

it('distinguishes a network failure from a failed token refresh', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')));
  const down = await GET(new NextRequest('http://localhost/api/backend/x'), params(['x']));
  expect(down.headers.get('x-bw-proxy-error')).toBe('network');

  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockRejectedValueOnce(new Error('offline')));
  const refresh = await GET(new NextRequest('http://localhost/api/backend/x', { headers: { cookie: 'bw_at=a; bw_rt=r' } }), params(['x']));
  expect(refresh.status).toBe(502);
  expect(refresh.headers.get('x-bw-proxy-error')).toBe('refresh_unavailable');
});
