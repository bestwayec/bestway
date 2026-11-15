// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    type Tree = { [key: string]: Tree | string | undefined };
    const node = namespace.split(".").reduce<Tree | undefined>((tree, part) => tree?.[part] as Tree | undefined, en as unknown as Tree);
    const template = typeof node?.[key] === "string" ? (node[key] as string) : key;
    // Enough ICU for these messages: {n, plural, one {# x} other {# xs}} and {name}.
    return template
      .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_, name, one, other) =>
        (Number(values?.[name]) === 1 ? one : other).replace("#", String(values?.[name])))
      .replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ""));
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ClearAnswersDialog, type ClearScope } from "./runner-tools";

describe("ClearAnswersDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

  const render = async (part: { name: string; count: number } | null, onConfirm: (scope: ClearScope) => void) => {
    await act(async () => root.render(React.createElement(ClearAnswersDialog, {
      open: true, sectionName: "Reading", count: 7, part, onCancel: () => {}, onConfirm,
    })));
  };
  const confirmButton = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Clear answers")!;
  const radio = (value: string) => document.body.querySelector<HTMLInputElement>(`input[name="clear-scope"][value="${value}"]`)!;

  it("offers the open part first, then the whole section", async () => {
    const onConfirm = vi.fn();
    await render({ name: "Passage 2", count: 3 }, onConfirm);
    expect(document.body.textContent).toContain("Only Passage 2 (3 answers)");
    expect(document.body.textContent).toContain("The whole Reading (7 answers)");
    expect(radio("part").checked).toBe(true);
    expect(document.body.textContent).toContain("3 answers in this part will be removed");
    await act(async () => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledWith("part");
  });

  it("clears the whole section when chosen", async () => {
    const onConfirm = vi.fn();
    await render({ name: "Passage 2", count: 3 }, onConfirm);
    await act(async () => radio("section").click());
    expect(document.body.textContent).toContain("7 answers in this section will be removed");
    await act(async () => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledWith("section");
  });

  it("an open part with no answers cannot be chosen; the section is", async () => {
    const onConfirm = vi.fn();
    await render({ name: "Part 1", count: 0 }, onConfirm);
    expect(radio("part").disabled).toBe(true);
    expect(radio("section").checked).toBe(true);
    await act(async () => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledWith("section");
  });

  it("a one-part section shows no choice", async () => {
    const onConfirm = vi.fn();
    await render(null, onConfirm);
    expect(document.body.querySelector('[data-testid="clear-scope"]')).toBeNull();
    expect(document.body.textContent).toContain("Clear the answers in Reading?");
  });
});
