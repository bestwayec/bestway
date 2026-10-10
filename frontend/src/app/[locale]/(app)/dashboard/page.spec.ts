import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRefreshToken, getSessionRole, getVerifiedSessionRole, redirect } = vi.hoisted(() => ({
  getRefreshToken: vi.fn(),
  getSessionRole: vi.fn(),
  getVerifiedSessionRole: vi.fn(),
  redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`); }),
}));
vi.mock("@/lib/auth", () => ({ getRefreshToken, getSessionRole, getVerifiedSessionRole }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string }) => locale === "en" ? `/en${href}` : href,
}));

import DashboardPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  getRefreshToken.mockResolvedValue(undefined);
});

describe("canonical dashboard landing", () => {
  it("redirects a current super-admin only after backend verification", async () => {
    getSessionRole.mockResolvedValue("super_admin");
    getVerifiedSessionRole.mockResolvedValue("super_admin");
    await expect(DashboardPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:/en/super-admin");
    expect(getVerifiedSessionRole).toHaveBeenCalledOnce();
  });

  it.each(["admin", "teacher", "student", "parent"])("renders the current %s dashboard after demotion without a redirect loop", async (role) => {
    getSessionRole.mockResolvedValue("super_admin");
    getVerifiedSessionRole.mockResolvedValue(role);
    expect(await DashboardPage({ params: Promise.resolve({ locale: "uz" }) })).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("allows reauthentication after a revoked super-admin session", async () => {
    getSessionRole.mockResolvedValue("super_admin");
    getVerifiedSessionRole.mockResolvedValue(undefined);
    await expect(DashboardPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:");
    const target = new URL(redirect.mock.calls[0][0], "https://bestwayec.uz");
    expect(target.pathname).toBe("/en/login");
    expect(target.searchParams.get("reauth")).toBe("1");
  });

  it("resumes a valid refresh session before canonical dashboard selection", async () => {
    getSessionRole.mockResolvedValue("super_admin");
    getVerifiedSessionRole.mockResolvedValue(undefined);
    getRefreshToken.mockResolvedValue("valid-refresh");
    await expect(DashboardPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:/api/auth/resume?next=%2Fen%2Fdashboard");
  });

  it.each(["admin", "teacher", "student", "parent"])("preserves the existing %s landing", async (role) => {
    getSessionRole.mockResolvedValue(role);
    expect(await DashboardPage({ params: Promise.resolve({ locale: "uz" }) })).toBeTruthy();
    expect(getVerifiedSessionRole).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
