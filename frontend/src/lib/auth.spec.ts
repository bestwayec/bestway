import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined }) }));

import { getVerifiedSessionRole } from "./auth";

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllGlobals());

describe("backend-verified super-admin role", () => {
  it("does not trust a super-admin role cookie without an access token", async () => {
    jar.set("bw_role", "super_admin");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await getVerifiedSessionRole()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403])("rejects a forged/stale token when the backend returns %s", async (status) => {
    jar.set("bw_at", "forged-token");
    jar.set("bw_role", "super_admin");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    expect(await getVerifiedSessionRole()).toBeUndefined();
  });

  it.each(["super_admin", "admin", "student"])("uses current backend role %s instead of the cookie", async (role) => {
    jar.set("bw_at", "actual-access-token");
    jar.set("bw_role", "super_admin");
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { user: { role } } }));
    vi.stubGlobal("fetch", fetch);
    expect(await getVerifiedSessionRole()).toBe(role);
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/me$/), expect.objectContaining({
      headers: { authorization: "Bearer actual-access-token" }, cache: "no-store", signal: expect.any(AbortSignal),
    }));
  });

  it("never falls back to cookie privileges when the backend is unavailable", async () => {
    jar.set("bw_at", "actual-access-token");
    jar.set("bw_role", "super_admin");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(getVerifiedSessionRole()).rejects.toThrow("Unable to verify session");
  });

  it("rejects unknown backend roles", async () => {
    jar.set("bw_at", "actual-access-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, data: { user: { role: "owner" } } })));
    expect(await getVerifiedSessionRole()).toBeUndefined();
  });
});
