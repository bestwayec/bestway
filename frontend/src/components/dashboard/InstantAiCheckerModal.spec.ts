import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
    expect(html).toContain("Tezkor baholash vaqtincha mavjud emas");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Darhol Baholash/);
  });
});
