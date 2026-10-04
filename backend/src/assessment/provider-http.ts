import { AssessmentProviderError } from './contracts';

export function providerUrl(base: string, endpoint: string): URL {
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error();
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${endpoint}`;
    return url;
  } catch { throw new AssessmentProviderError('PROVIDER_CONFIG_INVALID'); }
}

export function boundedConfig(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

/** One request only. Durable job state owns retry decisions; private error bodies are discarded. */
export async function providerJson(url: URL, options: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const maxBytes = 2 * 1024 * 1024;
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      throw new AssessmentProviderError(status === 401 || status === 403 ? 'PROVIDER_AUTH_FAILED' : status === 429 ? 'PROVIDER_RATE_LIMITED' : status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED', status === 429 || status >= 500, status === 408);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new AssessmentProviderError('PROVIDER_RESPONSE_TOO_LARGE'); }
    if (!response.body) throw new AssessmentProviderError('PROVIDER_EMPTY_RESPONSE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new AssessmentProviderError('PROVIDER_RESPONSE_TOO_LARGE'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const content = Buffer.concat(chunks).toString('utf8');
    if (!content.trim()) throw new AssessmentProviderError('PROVIDER_EMPTY_RESPONSE');
    try { return JSON.parse(content); } catch { throw new AssessmentProviderError('PROVIDER_MALFORMED_JSON'); }
  } catch (error) {
    if (error instanceof AssessmentProviderError) throw error;
    // An interrupted POST may have been billed. Do not replay it automatically.
    throw new AssessmentProviderError(controller.signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_FAILURE', true, true);
  } finally { clearTimeout(timeout); }
}

export function providerRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssessmentProviderError('PROVIDER_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}
