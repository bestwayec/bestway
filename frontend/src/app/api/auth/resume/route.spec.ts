import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

const me = (role = "super_admin") => Response.json({ success: true, data: { user: { role } } });
const renewed = () => Response.json({ success: true, data: { accessToken: "renewed-access", refreshToken: "renewed-refresh", user: { role: "super_admin" } } });
const request = (next: string, cookie: string) => new NextRequest(
  `https://bestwayec.uz/api/auth/resume?${new URLSearchParams({ next })}`, { headers: { cookie } },
);
const location = (response: Response) => new URL(response.headers.get("location")!);

afterEach(() => vi.unstubAllGlobals());

describe("dashboard session recovery", () => {
  it.each([false, true])("silently rotates a valid refresh token when expired access is present=%s", async (expired) => {
    const fetch = vi.fn();
    if (expired) fetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    fetch.mockResolvedValueOnce(renewed()).mockResolvedValueOnce(me());
    vi.stubGlobal("fetch", fetch);
    const response = await GET(request("/en/super-admin", `${expired ? "bw_at=expired-access; " : ""}bw_rt=valid-refresh; bw_role=super_admin`));
    expect(location(response).pathname).toBe("/en/super-admin");
    expect(response.cookies.get("bw_at")?.value).toBe("renewed-access");
    expect(response.cookies.get("bw_rt")?.value).toBe("renewed-refresh");
    expect(response.cookies.get("bw_role")?.value).toBe("super_admin");
    const cookieHeader = response.headers.get("set-cookie")!;
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=lax");
    expect(cookieHeader).toContain("Max-Age=900");
    expect(cookieHeader).toContain("Max-Age=2592000");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const refreshCall = fetch.mock.calls.find(([url]) => String(url).endsWith("/auth/refresh"));
    expect(refreshCall?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ refreshToken: "valid-refresh" }) });
    expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({ headers: { authorization: "Bearer renewed-access" }, cache: "no-store" });
  });

  it("repairs stale role hints using the current backend role without refreshing valid access", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(me());
    vi.stubGlobal("fetch", fetch);
    const response = await GET(request("/super-admin", "bw_at=valid-access; bw_rt=valid-refresh; bw_role=admin"));
    expect(location(response).pathname).toBe("/super-admin");
    expect(response.cookies.get("bw_role")?.value).toBe("super_admin");
    expect(response.cookies.get("bw_at")).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses the current role after refresh even when refresh metadata has an old super-admin role", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(renewed()).mockResolvedValueOnce(me("admin")));
    const response = await GET(request("/en/super-admin", "bw_rt=valid-refresh; bw_role=super_admin"));
    expect(location(response).pathname).toBe("/en/dashboard");
    expect(response.cookies.get("bw_role")?.value).toBe("admin");
  });

  it.each(["", "bw_rt=revoked-refresh"])("requires login when no valid session can be recovered (%s)", async (cookie) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 })));
    const response = await GET(request("/en/super-admin", cookie));
    const target = location(response);
    expect(target.pathname).toBe("/en/login");
    expect(target.searchParams.get("next")).toBe("/en/super-admin");
    expect(target.searchParams.get("reauth")).toBe("1");
    expect(response.cookies.get("bw_at")?.value).toBe("");
    expect(response.cookies.get("bw_rt")?.value).toBe("");
    expect(response.cookies.get("bw_role")?.value).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each(["https://evil.example", "//evil.example", "\\\\evil.example", "/%2f%2fevil.example", "/en/super-admin?next=https://evil.example", "/api/auth/resume"])("rejects unsafe/unlisted return target %s", async (next) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(me()));
    const response = await GET(request(next, "bw_at=valid-access"));
    expect(location(response).href).toBe("https://bestwayec.uz/dashboard");
  });

  it("fails closed and preserves session cookies during a backend outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
    const response = await GET(request("/super-admin", "bw_at=valid-access; bw_rt=valid-refresh"));
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json()).success).toBe(false);
  });

  it("preserves newly rotated tokens during a subsequent verification outage without granting privileges", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(renewed()).mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
    const response = await GET(request("/super-admin", "bw_rt=valid-refresh; bw_role=student"));
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.get("bw_at")?.value).toBe("renewed-access");
    expect(response.cookies.get("bw_rt")?.value).toBe("renewed-refresh");
    expect(response.cookies.get("bw_role")).toBeUndefined();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects renewed tokens that fail authoritative verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(renewed()).mockResolvedValueOnce(new Response("{}", { status: 401 })));
    const response = await GET(request("/super-admin", "bw_rt=valid-refresh"));
    expect(location(response).pathname).toBe("/login");
    expect(response.cookies.get("bw_role")?.value).toBe("");
  });
});
