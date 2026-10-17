import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/types";

vi.mock("next-intl/middleware", () => ({
  default: () => () => new NextResponse(null, { headers: { "x-intl": "pass" } }),
}));

import proxy from "./proxy";

function request(path: string, role?: Role) {
  const token = role ? `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature` : undefined;
  return new NextRequest(`https://bestwayec.uz${path}`, {
    headers: role ? { cookie: `bw_at=${token}; bw_role=${role}` } : undefined,
  });
}

function destination(response: Response) {
  return new URL(response.headers.get("location")!);
}

describe("super-admin URL routing", () => {
  it("lets divergent JWT and role-cookie hints reach authoritative super-admin verification", () => {
    const token = `header.${Buffer.from(JSON.stringify({ role: "admin" })).toString("base64url")}.signature`;
    const req = new NextRequest("https://bestwayec.uz/super-admin", { headers: { cookie: `bw_at=${token}; bw_role=super_admin` } });
    expect(proxy(req).headers.get("x-intl")).toBe("pass");
  });

  it.each(["/super-admin", "/en/dashboard"])("restores %s when only a refresh cookie remains", (path) => {
    const req = new NextRequest(`https://bestwayec.uz${path}`, { headers: { cookie: "bw_rt=valid-refresh" } });
    const result = destination(proxy(req));
    expect(result.pathname).toBe("/api/auth/resume");
    expect(result.searchParams.get("next")).toBe(path);
  });
  it.each(["/super-admin", "/en/super-admin"])("sends anonymous %s to login with its return URL", (path) => {
    const result = destination(proxy(request(`${path}?view=month`)));
    expect(result.pathname).toBe(path.startsWith("/en/") ? "/en/login" : "/login");
    expect(result.searchParams.get("next")).toBe(`${path}?view=month`);
  });

  it.each(["admin", "teacher", "student", "parent"] as Role[])("leaves %s authorization to the protected server page", (role) => {
    expect(proxy(request("/en/super-admin", role)).headers.get("x-intl")).toBe("pass");
    expect(proxy(request("/dashboard", role)).headers.get("x-intl")).toBe("pass");
  });

  it("redirects legacy admin URLs with locale and query intact", () => {
    const result = destination(proxy(request("/en/admin?section=staff&view=week")));
    expect(result.pathname).toBe("/en/super-admin");
    expect(result.search).toBe("?section=staff&view=week");
    expect(destination(proxy(request("/admin/"))).pathname).toBe("/super-admin");
  });

  it("uses the canonical login home but leaves dashboard role verification to the server", () => {
    expect(destination(proxy(request("/login", "super_admin"))).pathname).toBe("/super-admin");
    expect(proxy(request("/en/dashboard?view=month", "super_admin")).headers.get("x-intl")).toBe("pass");
    expect(proxy(request("/super-admin", "super_admin")).headers.get("x-intl")).toBe("pass");
  });

  it("allows login after the server rejects stale or forged cookies", () => {
    expect(proxy(request("/en/login?next=%2Fen%2Fsuper-admin&reauth=1", "super_admin")).headers.get("x-intl")).toBe("pass");
  });
});
