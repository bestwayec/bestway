// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }));
import { clampSplit, ReadingSplitDivider, useReadingSplit } from "./reading-split-divider";

let host: HTMLDivElement;
let root: Root;
function Harness() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [split, setSplit] = useReadingSplit();
  return React.createElement("div", { ref, "data-split": split }, React.createElement(ReadingSplitDivider, { value: split, onChange: setSplit, containerRef: ref }));
}
const divider = () => host.querySelector<HTMLElement>('[role="separator"]')!;
const split = () => Number(host.querySelector("[data-split]")!.getAttribute("data-split"));
// jsdom has no PointerEvent: React reads clientX and pointerId from a MouseEvent with that type.
const pointer = (type: string, clientX: number) => { const e = new MouseEvent(type, { bubbles: true, clientX }); Object.defineProperty(e, "pointerId", { value: 1 }); return e; };
const key = (k: string) => act(async () => { divider().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Reading split divider", () => {
  it("is a focusable vertical separator with its value", () => {
    expect(divider().tabIndex).toBe(0);
    expect(divider().getAttribute("aria-orientation")).toBe("vertical");
    expect(divider().getAttribute("aria-valuenow")).toBe("50");
    expect(divider().getAttribute("aria-valuetext")).toBe('splitValue:{"passage":50,"questions":50}');
  });

  it("moves with the keyboard within 25-75 % and Enter puts it back", async () => {
    await key("ArrowRight");
    expect(split()).toBe(55);
    await key("End");
    expect(split()).toBe(75);
    await key("ArrowRight");
    expect(split()).toBe(75);
    await key("Home");
    expect(split()).toBe(25);
    await key("Enter");
    expect(split()).toBe(50);
  });

  it("follows the pointer and is remembered on this device", async () => {
    const box = host.querySelector<HTMLElement>("[data-split]")!;
    box.getBoundingClientRect = () => ({ left: 100, width: 1000, top: 0, height: 600, right: 1100, bottom: 600, x: 100, y: 0, toJSON: () => ({}) });
    await act(async () => { divider().dispatchEvent(pointer("pointerdown", 600)); });
    await act(async () => { window.dispatchEvent(pointer("pointermove", 400)); });
    await act(async () => { window.dispatchEvent(pointer("pointerup", 400)); });
    await act(async () => { window.dispatchEvent(pointer("pointermove", 900)); });   // released: no change
    expect(split()).toBe(30);
    expect(localStorage.getItem("bw_reading_split")).toBe("30");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(React.createElement(Harness)));
    expect(split()).toBe(30);
  });

  it.each([[10, 25], [90, 75], [Number.NaN, 50], [62.4, 62]])("clamps %s to %s", (input, output) => {
    expect(clampSplit(input)).toBe(output);
  });
});
