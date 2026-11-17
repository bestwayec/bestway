import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const node = (en as unknown as Record<string, Record<string, string>>)[namespace];
    const t = (key: string, values?: Record<string, unknown>) =>
      (node?.[key] ?? key).replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_m, name: string, one: string, other: string) =>
        (Number(values?.[name]) === 1 ? one : other).replace("#", String(values?.[name]))).replace(/\{(\w+)\}/g, (_m, name: string) => String(values?.[name] ?? ""));
    return Object.assign(t, { rich: (key: string, values?: Record<string, unknown>) => t(key, values) });
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
}));

import { InstantAiCheckerModal } from "./InstantAiCheckerModal";

describe("instant assessment availability", () => {
  it("explains the unavailable feature and prevents submitting fabricated scores", () => {
    const html = renderToStaticMarkup(React.createElement(InstantAiCheckerModal, { isOpen: true, onClose: () => {} }));
    expect(html).toContain("Instant checking is not available right now");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Check now/);
    // No real-time or official-result claim for a feature that is switched off.
    expect(html).not.toContain("Real-Time");
    expect(html).toContain("0 words (suggested 150–250+)");
  });
});
