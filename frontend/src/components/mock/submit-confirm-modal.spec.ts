// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import uz from "../../../messages/uz.json";

const locale = vi.hoisted(() => ({ current: "en" as "en" | "uz" }));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const messages = (locale.current === "en" ? en : uz) as unknown as Record<string, any>;
    return namespace.split(".").reduce((node, part) => node?.[part], messages)?.[key] ?? key;
  },
}));
import { SubmitConfirmModal } from "./submit-confirm-modal";

let host: HTMLDivElement;
let root: Root;
const onConfirm = vi.fn();
const onOpenChange = vi.fn();

const render = (props: Partial<React.ComponentProps<typeof SubmitConfirmModal>> = {}) =>
  act(async () =>
    root.render(
      React.createElement(SubmitConfirmModal, {
        open: true,
        onOpenChange,
        onConfirm,
        isSubmitting: false,
        answered: 36,
        total: 40,
        flaggedCount: 3,
        skillName: "reading",
        ...props,
      })
    )
  );

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onConfirm.mockReset();
  onOpenChange.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  locale.current = "en";
});

describe("SubmitConfirmModal", () => {
  it("renders summary grid with answered, unanswered, and flagged counts", async () => {
    await render({ answered: 36, total: 40, flaggedCount: 3 });
    const text = document.body.textContent ?? "";
    expect(text).toContain("36 / 40");
    expect(text).toContain("4"); // missing
    expect(text).toContain("3"); // flagged
    expect(text).toContain("Bayroqcha");
  });

  it("warns student when questions are flagged for review", async () => {
    await render({ answered: 38, total: 40, flaggedCount: 2 });
    expect(document.body.textContent).toContain("2 ta");
  });

  it("calls onConfirm when student clicks submit button", async () => {
    await render({ answered: 40, total: 40, flaggedCount: 0 });
    const btn = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Yes, finish")
    );
    expect(btn).toBeDefined();
    await act(async () => btn!.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
