import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRefreshToken, getSessionRole, redirect } = vi.hoisted(() => ({
  getRefreshToken: vi.fn(),
  getSessionRole: vi.fn(),
  redirect: vi.fn((target: string): never => { throw new Error(`REDIRECT:${target}`); }),
}));
vi.mock("@/lib/auth", () => ({ getRefreshToken, getSessionRole }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string }) => locale === "en" ? `/en${href}` : href,
}));
vi.mock("@/components/app/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/app/app-topbar", () => ({ AppTopbar: () => null }));
vi.mock("@/components/app/mobile-nav", () => ({ MobileNav: () => null }));

import AppLayout from "./layout";

beforeEach(() => {
  vi.clearAllMocks();
  getRefreshToken.mockResolvedValue(undefined);
});

describe("missing role cookie", () => {
  it("recovers missing role cookies using a valid refresh session", async () => {
    getSessionRole.mockResolvedValue(undefined);
    getRefreshToken.mockResolvedValue("valid-refresh");
    await expect(AppLayout({ children: null, params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("REDIRECT:/api/auth/resume?next=%2Fen%2Fdashboard");
  });
  it.each(["uz", "en"])("requires reauthentication in locale %s instead of cycling through cookie redirects", async (locale) => {
    getSessionRole.mockResolvedValue(undefined);
    await expect(AppLayout({ children: null, params: Promise.resolve({ locale }) })).rejects.toThrow(
      `REDIRECT:${locale === "en" ? "/en/login" : "/login"}?reauth=1`,
    );
  });
});
