import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './api-client';

const inProgress = () => Response.json(
  { success: false, error: { code: 'REFRESH_IN_PROGRESS', message: 'Sessiya yangilanmoqda' } },
  { status: 409, headers: { 'retry-after': '1' } });
const ok = (data: unknown) => Response.json({ success: true, data });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retries a request that lost the token-refresh race and returns its data', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(inProgress()).mockResolvedValueOnce(ok({ saved: true }));
  vi.stubGlobal('fetch', fetchMock);
  const pending = api.post<{ saved: boolean }>('/mock/attempts/a1/answer', { questionId: 'q1', response: 'B' });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toEqual({ saved: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ questionId: 'q1', response: 'B' }));
});

it('gives up after three retries and reports the error', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => inProgress());
  vi.stubGlobal('fetch', fetchMock);
  const pending = api.get<never>('/auth/me').catch((e: unknown) => e as ApiError);
  await vi.advanceTimersByTimeAsync(10_000);
  const error = await pending;
  expect(error).toBeInstanceOf(ApiError);
  expect(error.code).toBe('REFRESH_IN_PROGRESS');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('does not retry other 409 conflicts', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(
    { success: false, error: { code: 'MOCK_CONTENT_CONFLICT', message: 'x' } }, { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(api.post('/mock/exams/e/start', {})).rejects.toMatchObject({ code: 'MOCK_CONTENT_CONFLICT' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
