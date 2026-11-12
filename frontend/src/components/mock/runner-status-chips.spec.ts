import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a">) => React.createElement("a", { href, ...props }, children),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { SaveStatusChip, StatusChip } from "./mock-runner";

describe("runner header status chips", () => {
  it("announces the save state in one live region with the exact label", () => {
    const html = renderToStaticMarkup(React.createElement(SaveStatusChip, { state: "saved", label: "Saved" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(">Saved<");
    expect(html).toContain("text-success");
  });

  it("shows a failed save as danger and saving as neutral", () => {
    for (const state of ["error", "offline"] as const) {
      expect(renderToStaticMarkup(React.createElement(SaveStatusChip, { state, label: "x" }))).toContain("text-danger");
    }
    const saving = renderToStaticMarkup(React.createElement(SaveStatusChip, { state: "saving", label: "Saving…" }));
    expect(saving).toContain("animate-spin");
    expect(saving).toContain("text-fg-muted");
  });

  it("uses theme tokens for each tone", () => {
    expect(renderToStaticMarkup(React.createElement(StatusChip, { tone: "warning" }, "2 flagged"))).toContain("bg-warning-bg");
    expect(renderToStaticMarkup(React.createElement(StatusChip, null, "3 / 35 answered"))).toContain("3 / 35 answered");
  });
});
