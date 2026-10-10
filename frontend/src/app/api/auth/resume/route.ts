import { NextRequest, NextResponse } from "next/server";
import { API_URL, COOKIE } from "@/lib/config";
import { sessionCookieOptions } from "@/lib/auth";
import type { ApiResponse, AuthTokens, Me, Role } from "@/lib/types";

const RESUME_PATHS = new Set(["/super-admin", "/dashboard", "/en/super-admin", "/en/dashboard"]);
const ROLES: Role[] = ["super_admin", "admin", "teacher", "student", "parent"];

function loginResponse(req: NextRequest, next: string) {
  const url = new URL(req.url);
  url.pathname = next.startsWith("/en/") ? "/en/login" : "/login";
  url.search = new URLSearchParams({ next, reauth: "1" }).toString();
  const response = NextResponse.redirect(url);
  for (const cookie of Object.values(COOKIE)) {
    response.cookies.set(cookie, "", sessionCookieOptions(req, 0));
  }
  response.headers.set("cache-control", "no-store");
  return response;
}

async function verifyAccess(accessToken: string): Promise<{ role?: Role; expired: boolean }> {
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) return { expired: true };
  if (response.status === 403) return { expired: false };
  if (!response.ok) throw new Error("Session backend unavailable");
  const json = (await response.json()) as ApiResponse<Me>;
  const role = json.success ? json.data?.user?.role : undefined;
  return { role: role && ROLES.includes(role) ? role : undefined, expired: false };
}

/** Restore only the dashboard session; current role always comes from the backend. */
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get("next") ?? "/dashboard";
  let next = RESUME_PATHS.has(requested) ? requested : "/dashboard";
  let accessToken = req.cookies.get(COOKIE.access)?.value;
  let refreshToken = req.cookies.get(COOKIE.refresh)?.value;
  let renewed = false;

  try {
    let session: { role?: Role; expired: boolean } = accessToken ? await verifyAccess(accessToken) : { expired: true };
    if (session.expired) {
      if (!refreshToken) return loginResponse(req, next);
      const refresh = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (refresh.status === 401 || refresh.status === 403) return loginResponse(req, next);
      if (!refresh.ok) throw new Error("Session backend unavailable");
      const json = (await refresh.json()) as ApiResponse<AuthTokens>;
      if (!json.success || !json.data?.accessToken || !json.data?.refreshToken) return loginResponse(req, next);
      accessToken = json.data.accessToken;
      refreshToken = json.data.refreshToken;
      renewed = true;
      session = await verifyAccess(accessToken);
    }
    if (!session.role) return loginResponse(req, next);
    if (next.endsWith("/super-admin") && session.role !== "super_admin") {
      next = next.startsWith("/en/") ? "/en/dashboard" : "/dashboard";
    }

    const url = new URL(req.url);
    url.pathname = next;
    url.search = "";
    const response = NextResponse.redirect(url);
    if (renewed) {
      response.cookies.set(COOKIE.access, accessToken!, sessionCookieOptions(req, 15 * 60));
      response.cookies.set(COOKIE.refresh, refreshToken!, sessionCookieOptions(req, 30 * 24 * 60 * 60));
    }
    response.cookies.set(COOKIE.role, session.role, sessionCookieOptions(req, 30 * 24 * 60 * 60));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch {
    const response = NextResponse.json(
      { success: false, error: { code: "BACKEND_UNREACHABLE", message: "Server bilan aloqa yo'q" } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
    // Rotation already consumed the old refresh token. Preserve its replacement
    // even if verification is temporarily unavailable, without granting a role.
    if (renewed) {
      response.cookies.set(COOKIE.access, accessToken!, sessionCookieOptions(req, 15 * 60));
      response.cookies.set(COOKIE.refresh, refreshToken!, sessionCookieOptions(req, 30 * 24 * 60 * 60));
    }
    return response;
  }
}
