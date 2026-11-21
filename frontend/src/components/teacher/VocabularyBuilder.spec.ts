// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VocabularyBuilder } from "./VocabularyBuilder";
import { ApiError, api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ApiError: actual.ApiError, api: { post: vi.fn(), patch: vi.fn() } };
});
vi.mock("next-intl", async () => {
  const en = (await import("../../../messages/en.json")).default as Record<string, unknown>;
  const lookup = (ns: string, key: string) =>
    `${ns}.${key}`.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), en);
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = lookup(ns, key);
      if (typeof found !== "string") return `${ns}.${key}`;
      return found.replace(/\{(\w+), plural,[^}]*\{[^}]*\}[^}]*\{([^}]*)\}\}/g, (_, n: string, other: string) => other.replace("#", String(values?.[n] ?? "")))
        .replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? ""));
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const buttons = (text: string) => Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.includes(text));
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(React.createElement(VocabularyBuilder, { groupId: "g-1", onSuccess: vi.fn() })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function pasteAndParse(text: string) {
  act(() => buttons("Smart")[0].click());
  typeInto(document.querySelector("textarea")!, text);
  await act(async () => { buttons("Read the text")[0].click(); });
}

describe("VocabularyBuilder import and duplicates", () => {
  it("previews server-parsed words, skips duplicates on apply and blocks nothing valid", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ words: [
      { english: "apple", uzbek: "olma" }, { english: "Apple", uzbek: "OLMA" }, { english: "self-confidence", uzbek: "o‘ziga ishonch" },
    ], count: 3 });
    await pasteAndParse("apple - olma");
    expect(api.post).toHaveBeenCalledWith("/v1/vocabulary/sets/parse-text", { rawText: "apple - olma" });
    expect(document.body.textContent).toContain("(Duplicate)");
    const apply = Array.from(document.querySelectorAll("button")).find((b) => /\b2\b/.test(b.textContent ?? "") && !b.disabled)!;
    act(() => apply.click());
    expect(document.querySelector('[role="status"]')?.textContent).toMatch(/^1 duplicate.*skipped/);
    expect(document.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("shows a server rejection instead of fabricating a local preview", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError("FORBIDDEN", "Not allowed", 403));
    await pasteAndParse("apple - olma");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Not allowed");
    expect(document.body.textContent).not.toContain("olma ");
  });

  it("imports a CSV file through the server parser as tab-separated lines", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ words: [{ english: "well-known", uzbek: "mashhur" }], count: 1 });
    act(() => buttons("Smart")[0].click());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['english,uzbek\n"well-known",mashhur\n'], "list.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(api.post).toHaveBeenCalledWith("/v1/vocabulary/sets/parse-text", { rawText: "well-known\tmashhur" });
  });

  it("refuses xlsx files with guidance rather than a silent failure", async () => {
    act(() => buttons("Smart")[0].click());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "list.xlsx")] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Save the sheet as CSV");
    expect(api.post).not.toHaveBeenCalled();
  });
});
