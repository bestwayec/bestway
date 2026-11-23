import { describe, expect, it } from "vitest";
import { createHistory, historyReducer, shortcutFor, type History, type HistoryAction } from "./undo-history";

type Part = { prompt: string; options: string[] };
const set = (value: Part | ((p: Part) => Part), at: number): HistoryAction<Part> => ({ type: "set", value, at, coalesceMs: 600, limit: 3 });
const run = (state: History<Part>, ...actions: HistoryAction<Part>[]) => actions.reduce(historyReducer<Part>, state);

describe("editor undo history", () => {
  const start = createHistory<Part>({ prompt: "", options: ["A", "B"] });

  it("undoes and redoes text, option and reorder changes in order", () => {
    let s = run(start, set((p) => ({ ...p, prompt: "Q1" }), 1000));
    s = run(s, set((p) => ({ ...p, options: [...p.options, "C"] }), 3000));
    s = run(s, set((p) => ({ ...p, options: [...p.options].reverse() }), 5000));
    expect(s.present.options).toEqual(["C", "B", "A"]);
    s = run(s, { type: "undo" });
    expect(s.present.options).toEqual(["A", "B", "C"]);
    s = run(s, { type: "undo" }, { type: "undo" });
    expect(s.present).toEqual(start.present);
    s = run(s, { type: "redo" }, { type: "redo" }, { type: "redo" });
    expect(s.present.options).toEqual(["C", "B", "A"]);
  });

  it("merges a typing burst into one step", () => {
    let s = start;
    "Hello".split("").forEach((_, i) => { s = run(s, set((p) => ({ ...p, prompt: "Hello".slice(0, i + 1) }), 1000 + i * 100)); });
    expect(s.past).toHaveLength(1);
    expect(run(s, { type: "undo" }).present.prompt).toBe("");
  });

  it("a new change after undo drops the redo branch", () => {
    let s = run(start, set((p) => ({ ...p, prompt: "one" }), 1000), set((p) => ({ ...p, prompt: "two" }), 3000), { type: "undo" });
    expect(s.future).toHaveLength(1);
    s = run(s, set((p) => ({ ...p, prompt: "other" }), 5000));
    expect(s.future).toHaveLength(0);
  });

  it("reset (save / server reload) clears history", () => {
    const s = run(start, set((p) => ({ ...p, prompt: "x" }), 1000), { type: "reset", value: { prompt: "saved", options: [] } });
    expect(s).toEqual(createHistory({ prompt: "saved", options: [] }));
    expect(run(s, { type: "undo" }).present.prompt).toBe("saved");
  });

  it("keeps a bounded number of steps and ignores no-op sets", () => {
    let s = start;
    for (let i = 0; i < 6; i++) s = run(s, set((p) => ({ ...p, prompt: String(i) }), 1000 * (i + 1)));
    expect(s.past).toHaveLength(3);
    expect(run(s, set((p) => p, 99999))).toBe(s);
  });
});

describe("undo shortcuts", () => {
  const target = (tagName: string, type = "") => ({ tagName, type, isContentEditable: false }) as unknown as EventTarget;
  const key = (k: string, mods: Partial<KeyboardEvent> = {}, t = target("DIV")) =>
    shortcutFor({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: t, ...mods });

  it("maps Ctrl/⌘+Z and Ctrl/⌘+Shift+Z and Ctrl+Y", () => {
    expect(key("z", { ctrlKey: true })).toBe("undo");
    expect(key("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(key("y", { ctrlKey: true })).toBe("redo");
    expect(key("z")).toBeNull();
  });

  it("leaves native undo alone inside text fields", () => {
    expect(key("z", { ctrlKey: true }, target("TEXTAREA"))).toBeNull();
    expect(key("z", { ctrlKey: true }, target("INPUT", "text"))).toBeNull();
    expect(key("z", { ctrlKey: true }, target("INPUT", "checkbox"))).toBe("undo");
  });
});
