import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { forwardedForHeaders } from "@/lib/client-ip";
import { setSessionCookies } from "@/lib/auth";
import type { ApiResponse, AuthTokens } from "@/lib/types";

/** Ro'yxatdan o'tish — backend faqat `student` va `parent` rollariga ruxsat beradi */
export async function POST(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", ...forwardedForHeaders(req.headers) },
      body: JSON.stringify({
        name: body.name,
        phone: body.phone,
        password: body.password,
        role: body.role,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "BACKEND_UNREACHABLE", message: "Server bilan aloqa yo'q" } },
      { status: 502 },
    );
  }

  const json = (await upstream.json()) as ApiResponse<AuthTokens>;
  if (!upstream.ok || !json.success) {
    return NextResponse.json(json, { status: upstream.status });
  }

  const { user, accessToken, refreshToken } = json.data;
  await setSessionCookies({ accessToken, refreshToken, role: user.role }, req);

  return NextResponse.json({ success: true, data: { user } });
}
