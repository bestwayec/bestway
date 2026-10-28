import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "uz",
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/auth/google-auth-button", () => ({
  GoogleAuthButton: () => React.createElement("button", { "data-testid": "google-auth-btn" }, "Google Sign In"),
}));

import {
  ExpressPlacementTest,
  LOCAL_STORAGE_PLACEMENT_KEY,
} from "./ExpressPlacementTest";

describe("ExpressPlacementTest Component", () => {
  it("renders idle landing card with 10-minute diagnostic badges and action button", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExpressPlacementTest, {
        autoStart: false,
        isAuthenticated: false,
      })
    );

    expect(html).toContain("10 Daqiqalik Bepul");
    expect(html).toContain("CEFR &amp; IELTS");
    expect(html).toContain("20 ta savol");
    expect(html).toContain("10 daqiqa");
    expect(html).toContain("0 so&#x27;m");
    expect(html).toContain("⚡️ Bepul Darajangizni Aniqlang (10 daqiqa)");
  });

  it("exports the standard localStorage key for guest-to-user state migration", () => {
    expect(LOCAL_STORAGE_PLACEMENT_KEY).toBe("bestway_placement_result_token");
  });

  it("renders with custom className without crashing", () => {
    const html = renderToStaticMarkup(
      React.createElement(ExpressPlacementTest, {
        className: "custom-placement-test-class",
      })
    );

    expect(html).toContain("custom-placement-test-class");
    expect(html).toContain("placement-test");
  });
});
