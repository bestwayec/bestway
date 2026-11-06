// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children);
  return { Dialog: Box, DialogContent: Box, DialogDescription: Box, DialogFooter: Box, DialogHeader: Box, DialogTitle: Box };
});
vi.mock("@/hooks/use-mock", () => {
  const data = { students: [{ studentId: "s", state: "absent", isExcused: null }] };
  return { useGroupAttendanceSummary: () => ({ data, refetch: vi.fn() }) };
});

import { SmartAttendanceDialog } from "./smart-attendance-dialog";

it("does not label an absence with an unknown reason as unexcused", async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(SmartAttendanceDialog, {
      groupId: "g", groupName: "Group", open: true, onOpenChange: () => {},
      students: [{ studentId: "s", studentName: "Synthetic student" }],
    })));
    expect(container.textContent).toContain("Kelmaganlik sababi saqlanmagan");
    expect(container.textContent).toContain("Kelmaganlik sababi hozircha alohida saqlanmaydi");
    const unexcused = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Sababsiz"));
    expect(unexcused).toBeDefined();
    expect(unexcused?.className).not.toContain("bg-rose-600");
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
