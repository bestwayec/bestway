import { isIP } from "node:net";

/**
 * Client IP forwarding for server-side calls to Django.
 *
 * Production path: browser -> Cloudflare -> cloudflared -> Next.js -> Django. Django sees the
 * Next.js container as the socket peer, so without a forwarded address every user shares one
 * throttle bucket. Cloudflare sets CF-Connecting-IP and overwrites any client-supplied value,
 * so it is the only address we trust. Client-supplied X-Forwarded-For / X-Real-IP / Forwarded
 * are dropped and replaced by exactly one hop, which Django reads with TRUSTED_PROXY_COUNT=1.
 */
export const CLIENT_SUPPLIED_FORWARDING_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded"] as const;

export function trustedClientIp(headers: Headers): string | null {
  const raw = headers.get("cf-connecting-ip")?.trim() ?? "";
  return raw && isIP(raw) ? raw : null;
}

/** Headers to add to an upstream request: `{ "x-forwarded-for": ip }` or nothing (local dev). */
export function forwardedForHeaders(headers: Headers): Record<string, string> {
  const ip = trustedClientIp(headers);
  return ip ? { "x-forwarded-for": ip } : {};
}

/** Mutates `target`: removes client-supplied forwarding headers, then sets the trusted hop. */
export function applyClientIp(target: Headers, source: Headers): Headers {
  for (const name of CLIENT_SUPPLIED_FORWARDING_HEADERS) target.delete(name);
  const ip = trustedClientIp(source);
  if (ip) target.set("x-forwarded-for", ip);
  return target;
}
