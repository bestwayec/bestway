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
import { AdvanceConfirmModal } from "./advance-confirm-modal";

let host: HTMLDivElement;
let root: Root;
const onConfirm = vi.fn();
const onOpenChange = vi.fn();

const render = (open = true) => act(async () => root.render(React.createElement(AdvanceConfirmModal, { open, onOpenChange, onConfirm })));
const button = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  onConfirm.mockReset(); onOpenChange.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); locale.current = "en"; });

describe("AdvanceConfirmModal", () => {
  it("does nothing until the student confirms, and warns the move is one-way", async () => {
    await render();
    expect(document.body.textContent).toContain("cannot return to this section");
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => button("Yes, next section")!.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("lets the student stay in the section", async () => {
    await render();
    await act(async () => button("Stay here")!.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is written in Uzbek on the Uzbek site", async () => {
    locale.current = "uz";
    await render();
    expect(document.body.textContent).toContain("Keyingi bo‘limga o‘tasizmi?");
    expect(button("Ha, keyingi bo‘lim")).toBeTruthy();
  });

  it("renders nothing while closed", async () => {
    await render(false);
    expect(document.body.textContent).not.toContain("next section");
  });
});
