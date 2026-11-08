import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => `t:${key}` }));

import { LoadErrorPanel } from "./load-error-panel";

describe("LoadErrorPanel (U4)", () => {
  it("renders title, reason, retry and a home link", () => {
    const html = renderToStaticMarkup(React.createElement(LoadErrorPanel, { reason: "Network down", onRetry: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("t:title");
    expect(html).toContain("Network down");
    expect(html).toContain("t:retry");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("t:home");
  });

  it("falls back to the translated default reason", () => {
    const html = renderToStaticMarkup(React.createElement(LoadErrorPanel, { reason: null }));
    expect(html).toContain("t:reason");
  });
});
