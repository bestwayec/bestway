import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { setSessionCookies } from "@/lib/auth";
import type { ApiResponse, AuthTokens } from "@/lib/types";

/**
 * Telegram 6-xonali OTP orqali kirish.
 * Kod tekshiriladi, tokenlar cookie'ga yoziladi va user ma'lumotlari qaytariladi.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/auth/telegram-otp/verify/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
