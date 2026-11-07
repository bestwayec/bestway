import { NextRequest, NextResponse } from "next/server";
import { API_URL, COOKIE } from "@/lib/config";
import { sessionCookieOptions } from "@/lib/auth";
import { applyClientIp } from "@/lib/client-ip";

/**
 * Backend uchun proxy.
 *
 * Nima uchun kerak: access token httpOnly cookie'da yotadi, ya'ni brauzerdagi JS
 * uni o'qiy olmaydi (XSS bo'lsa ham o'g'irlanmaydi). Demak `Authorization: Bearer`
 * sarlavhasini faqat server qo'sha oladi. Client `/api/backend/...` ga uradi,
 * shu handler cookie'ni olib, backendga Bearer bilan uzatadi.
 *
 * Bonus: access token eskirsa (15 daqiqa), bu yerda jimgina refresh qilinadi va
 * so'rov qayta yuboriladi — foydalanuvchi hech narsani sezmaydi.
 */

/** fetch javobni o'zi ochadi/yig'adi — bu sarlavhalarni uzatish javobni buzadi */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cookie",
]);

const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

function buildTargetUrl(path: string[], search: string): string {
  const normalized = path[0] === "v1" ? path.slice(1) : path;
  const suffix = normalized.map(encodeURIComponent).join("/");
  return `${API_URL}/${suffix}${search}`;
}

function forwardHeaders(req: NextRequest, accessToken?: string): Headers {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  return applyClientIp(headers, req.headers);
}

/** Backenddan yangi tokenlar so'rash. Muvaffaqiyatsiz bo'lsa — null. */
async function refreshSession(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string } | "pending" | "unavailable" | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 409) return "pending";
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return "unavailable";
    const json = (await res.json()) as {
      success: boolean;
      data?: { accessToken?: string; refreshToken?: string };
    };
    if (!json.success || !json.data?.accessToken || !json.data.refreshToken) return "unavailable";
    return { accessToken: json.data.accessToken, refreshToken: json.data.refreshToken };
  } catch {
    return "unavailable";
  }
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = buildTargetUrl(path, req.nextUrl.search);

  const accessToken = req.cookies.get(COOKIE.access)?.value;
  const refreshToken = req.cookies.get(COOKIE.refresh)?.value;

  // Body'ni bir marta o'qib olamiz — 401 bo'lsa so'rovni qayta yuborish kerak
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  // Video uploadlar 500MB gacha bo'ladi va 2 hop'dan o'tadi
  // (brauzer→Next→backend) — 8s default ularga yetmaydi.
  // 500MB sekin tarmoqda bir necha daqiqa olishi mumkin.
  const isUpload = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  const isStream = req.nextUrl.pathname.includes("/stream") || req.headers.has("range");
  // AI JSON import (max 200 savol) validatsiyasi 8s dan oshishi mumkin —
  // faqat shu route uchun 60s (boshqa route'lar o'zgarmaydi).
  const isExamImport =
    req.nextUrl.pathname.includes("/mock/exam-imports") &&
    req.method !== "GET";
  const timeoutMs = isUpload || isStream ? 600_000 : isExamImport ? 60_000 : 8_000;

  const send = (token?: string) =>
    fetch(target, {
      method: req.method,
      headers: forwardHeaders(req, token),
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      ...(body && body.byteLength > 0 ? { duplex: "half" as const } : {}),
    } as RequestInit & { duplex?: "half"; signal?: AbortSignal });

  let upstream: Response;
  try {
    upstream = await send(accessToken);
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "BACKEND_UNREACHABLE", message: "Server bilan aloqa yo'q" } },
      { status: 502 },
    );
  }

  let renewed: { accessToken: string; refreshToken?: string } | null = null;
  let sessionExpired = false;

  if (upstream.status === 401) {
    const result = refreshToken ? await refreshSession(refreshToken) : null;
    if (result === "pending") {
      // Another request is rotating this cookie. Do not clear or replace it.
      return NextResponse.json(
        { success: false, error: { code: "REFRESH_IN_PROGRESS", message: "Sessiya yangilanmoqda; qayta urinib ko'ring" } },
        { status: 409, headers: { "retry-after": "1", "cache-control": "no-store" } },
      );
    }
    if (result === "unavailable") {
      return NextResponse.json(
        { success: false, error: { code: "BACKEND_UNREACHABLE", message: "Server bilan aloqa yo'q" } },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    renewed = result;
    if (renewed) {
      try {
        upstream = await send(renewed.accessToken);
      } catch {
        // Rotation consumed the old token. Keep the replacement on an outage.
        const response = NextResponse.json(
          { success: false, error: { code: "BACKEND_UNREACHABLE", message: "Server bilan aloqa yo'q" } },
          { status: 502, headers: { "cache-control": "no-store" } },
        );
        response.cookies.set(COOKIE.access, renewed.accessToken, sessionCookieOptions(req, ACCESS_MAX_AGE));
        if (renewed.refreshToken) response.cookies.set(COOKIE.refresh, renewed.refreshToken, sessionCookieOptions(req, REFRESH_MAX_AGE));
        return response;
      }
    }
    if (upstream.status === 401) {
      sessionExpired = true;
    }
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    // Do not strip content-length on video streams and range responses
    if (isStream && lowerKey === "content-length") {
      headers.set(key, value);
    } else if (!STRIPPED_RESPONSE_HEADERS.has(lowerKey)) {
      headers.set(key, value);
    }
  });

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  if (renewed) {
    response.cookies.set(
      COOKIE.access,
      renewed.accessToken,
      sessionCookieOptions(req, ACCESS_MAX_AGE),
    );
    if (renewed.refreshToken) {
      response.cookies.set(
        COOKIE.refresh,
        renewed.refreshToken,
        sessionCookieOptions(req, REFRESH_MAX_AGE),
      );
    }
  }

  // Refresh ham o'lgan — sessiya tugagan, cookie'larni tozalaymiz.
  // Client `SESSION_EXPIRED` ni ko'rib login sahifasiga o'tadi.
  // O'chirishda yaratishdagi atributlar (secure/path) takrorlanadi,
  // aks holda brauzer Secure cookie'ni o'chirmaydi.
  if (sessionExpired) {
    response.cookies.set(COOKIE.access, "", sessionCookieOptions(req, 0));
    response.cookies.set(COOKIE.refresh, "", sessionCookieOptions(req, 0));
    response.cookies.set(COOKIE.role, "", sessionCookieOptions(req, 0));
  }

  return response;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

export const dynamic = "force-dynamic";
