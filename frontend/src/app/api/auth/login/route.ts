import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { setSessionCookies } from "@/lib/auth";
import type { ApiResponse, AuthTokens } from "@/lib/types";

/**
 * Login — tokenlar shu yerda cookie'ga yoziladi va brauzerga QAYTARILMAYDI.
 * Client faqat `user` obyektini ko'radi.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: body.phone || body.username || body.email || body.id,
        password: body.password,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "BACKEND_UNREACHABLE", message: "Server bilan aloqa yo'q" } },
      { status: 502 },
    );
  }

  let json: ApiResponse<AuthTokens>;
  try {
    json = (await upstream.json()) as ApiResponse<AuthTokens>;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "UPSTREAM_ERROR", message: "Serverdan noto'g'ri javob qaytdi" } },
      { status: upstream.status || 500 },
    );
  }

  if (!upstream.ok || !json.success) {
    return NextResponse.json(json, { status: upstream.status });
  }

  const { user, accessToken, refreshToken } = json.data;
  await setSessionCookies({ accessToken, refreshToken, role: user.role }, req);

  return NextResponse.json({ success: true, data: { user } });
}
