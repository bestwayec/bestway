import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { clearSessionCookies, getAccessToken, getRefreshToken } from "@/lib/auth";

/** Revoke using the refresh bearer even when the access token has expired. */
export async function POST(req: NextRequest) {
  const accessToken = await getAccessToken();
  const refreshToken = await getRefreshToken();
  let revoked = true;
  if (refreshToken || accessToken) {
    try {
      const response = await fetch(`${API_URL}/auth/${refreshToken ? "logout-refresh" : "logout"}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(!refreshToken && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      revoked = response.ok;
    } catch {
      revoked = false;
    }
  }
  await clearSessionCookies(req);
  if (!revoked) {
    return NextResponse.json(
      { success: false, error: { code: "LOGOUT_UNCONFIRMED", message: "Sessiyani serverda yopish tasdiqlanmadi" } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json({ success: true, data: { loggedOut: true } }, { headers: { "cache-control": "no-store" } });
}
