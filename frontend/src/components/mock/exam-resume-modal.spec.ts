// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock("next-intl", async () => {
  const uz = (await import("../../../messages/uz.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), uz);
  return { useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const found = lookup(`${ns}.${key}`);
    return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
  } };
});

import { ExamResumeModal } from "./exam-resume-modal";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockPush.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

describe("ExamResumeModal", () => {
  it("renders writing and speaking section options and navigates on click", async () => {
    const onOpenChange = vi.fn();

    await React.act(async () => {
      root.render(
        React.createElement(ExamResumeModal, {
          open: true,
          onOpenChange,
          attemptId: "att-123",
          skills: ["writing", "speaking"],
          examTitle: "Multi-Level Test 1",
        })
      );
    });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Qaysi bo'limni davom ettirmoqchisiz?");
    expect(bodyText).toContain("Writing");
    expect(bodyText).toContain("Speaking");
    expect(bodyText).toContain("Multi-Level Test 1 — istalgan bo'limni tanlab");

    // Click Writing button
    const buttons = document.querySelectorAll("button");
    const writingBtn = Array.from(buttons).find((b) => b.textContent?.includes("Writing"));
    expect(writingBtn).toBeDefined();

    await React.act(async () => {
      writingBtn?.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockPush).toHaveBeenCalledWith("/mock/attempt/att-123?skill=writing");
  });
});
