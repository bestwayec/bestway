import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRefreshToken, getVerifiedSessionRole, redirect } = vi.hoisted(() => ({
  getRefreshToken: vi.fn(),
  getVerifiedSessionRole: vi.fn(),
  redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`); }),
}));
vi.mock("@/lib/auth", () => ({ getRefreshToken, getVerifiedSessionRole }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string }) => locale === "en" ? `/en${href}` : href,
}));

import SuperAdminPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  getRefreshToken.mockResolvedValue(undefined);
});

describe("super-admin page server authorization", () => {
  it.each(["uz", "en"])("requires login and preserves locale %s", async (locale) => {
    getVerifiedSessionRole.mockResolvedValue(undefined);
    await expect(SuperAdminPage({ params: Promise.resolve({ locale }) })).rejects.toThrow("REDIRECT:");
    const result = new URL(redirect.mock.calls[0][0], "https://bestwayec.uz");
    expect(result.pathname).toBe(locale === "en" ? "/en/login" : "/login");
    expect(result.searchParams.get("next")).toBe(locale === "en" ? "/en/super-admin" : "/super-admin");
    expect(result.searchParams.get("reauth")).toBe("1");
  });

  it("resumes a valid long-lived session when its access token expires", async () => {
    getVerifiedSessionRole.mockResolvedValue(undefined);
    getRefreshToken.mockResolvedValue("valid-refresh");
    await expect(SuperAdminPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:/api/auth/resume?next=%2Fen%2Fsuper-admin");
  });

  it.each(["admin", "teacher", "student", "parent"])("sends verified %s to the existing dashboard", async (role) => {
    getVerifiedSessionRole.mockResolvedValue(role);
    await expect(SuperAdminPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:/en/dashboard");
  });

  it("renders the existing admin dashboard only for a verified super-admin", async () => {
    getVerifiedSessionRole.mockResolvedValue("super_admin");
    const page = await SuperAdminPage({ params: Promise.resolve({ locale: "uz" }) });
    expect(page).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(getVerifiedSessionRole).toHaveBeenCalledOnce();
  });
});
