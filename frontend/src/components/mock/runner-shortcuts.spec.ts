// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    type Tree = { [key: string]: Tree | string | undefined };
    const node = namespace.split(".").reduce<Tree | undefined>((tree, part) => tree?.[part] as Tree | undefined, en as unknown as Tree);
    return typeof node?.[key] === "string" ? (node[key] as string) : key;
  },
}));
import { isTypingTarget, RUNNER_SHORTCUTS, shortcutFor, ShortcutsDialog, useRunnerShortcuts } from "./runner-shortcuts";

const key = (k: string, target: EventTarget | null = document.body, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, target, ...mods }) as KeyboardEvent;

describe("shortcutFor", () => {
  it("maps single keys, either case", () => {
    expect(shortcutFor(key("n"))).toBe("next");
    expect(shortcutFor(key("P"))).toBe("previous");
    expect(shortcutFor(key("f"))).toBe("flag");
    expect(shortcutFor(key("H"))).toBe("highlight");
    expect(shortcutFor(key("?"))).toBe("help");
    expect(shortcutFor(key("x"))).toBeNull();
  });

  it("never fires with a modifier (browser and exam-lock keys stay theirs)", () => {
    expect(shortcutFor(key("n", document.body, { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("f", document.body, { metaKey: true }))).toBeNull();
    expect(shortcutFor(key("h", document.body, { altKey: true }))).toBeNull();
  });

  it("never fires while the student types", () => {
    const text = document.createElement("input"); text.type = "text";
    const area = document.createElement("textarea");
    const editable = document.createElement("div"); editable.contentEditable = "true";
    const radio = document.createElement("input"); radio.type = "radio";
    for (const target of [text, area]) expect(shortcutFor(key("n", target))).toBeNull();
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(radio)).toBe(false);
    expect(shortcutFor(key("n", radio))).toBe("next");
    document.body.appendChild(editable);
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    editable.remove();
  });
});

describe("useRunnerShortcuts and the help dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

  it("calls the handler for a key and ignores keys pressed in an answer box", async () => {
    const next = vi.fn();
    const help = vi.fn();
    function Probe() { useRunnerShortcuts({ next, help }); return React.createElement("textarea", { "data-testid": "answer" }); }
    await act(async () => root.render(React.createElement(Probe)));
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" })); });
    expect(next).toHaveBeenCalledTimes(1);
    const area = host.querySelector("textarea")!;
    await act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })); });
    expect(next).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })); });
    expect(help).toHaveBeenCalledTimes(1);
  });

  it("the dialog lists every shortcut with its key", async () => {
    await act(async () => root.render(React.createElement(ShortcutsDialog, { open: true, onOpenChange: () => {} })));
    const list = document.body.querySelector('[data-testid="shortcuts-list"]')!;
    expect(list.querySelectorAll("dt")).toHaveLength(RUNNER_SHORTCUTS.length);
    expect(list.textContent).toContain("Next question");
    expect([...list.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["N", "P", "F", "O", "H", "?", "Esc"]);
    expect(document.body.textContent).toContain("Keyboard shortcuts");
  });
});
