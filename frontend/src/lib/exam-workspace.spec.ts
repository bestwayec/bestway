// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fromDocument, readLocal, resolveOnOpen, toDocument, touchLocal, writeLocal, type Workspace } from "./exam-workspace";

const marks = (highlights: string[], notes: Workspace["marks"][string]["notes"] = []) => ({ highlights, greenHighlights: [], pinkHighlights: [], underlines: [], notes });
const note = { id: "n1", quote: "blue sky", text: "check paragraph B", createdAt: "2026-11-13T10:00:00Z" };

describe("exam workspace", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips flags, highlights and notes through the server document", () => {
    const ws: Workspace = { flags: ["q3", "q7"], marks: { "a1.g1.passage": marks(["blue sky"], [note]) }, savedAt: 1000 };
    const doc = toDocument(ws);
    expect(doc[0]).toEqual({ kind: "meta", version: 1, savedAt: 1000 });
    expect(fromDocument(JSON.parse(JSON.stringify(doc)))).toEqual(ws);
  });

  it("ignores documents and items of other shapes (older clients)", () => {
    expect(fromDocument(["note", { note: "Original note" }])).toBeNull();
    expect(fromDocument(null)).toBeNull();
    const parsed = fromDocument([{ kind: "meta", savedAt: 5 }, "junk", { kind: "flag" }, { kind: "flag", questionId: "q1" }, { kind: "marks", key: "a1.g.passage", highlights: ["x", 3] }]);
    expect(parsed).toEqual({ flags: ["q1"], marks: { "a1.g.passage": marks(["x"]) }, savedAt: 5 });
  });

  it("the device cache keeps the component's storage keys and only this attempt's keys are replaced", () => {
    localStorage.setItem("bestway.cbt_annotations.other.g.passage", JSON.stringify(marks(["keep"])));
    localStorage.setItem("bestway.cbt_annotations.a1.old.passage", JSON.stringify(marks(["drop"])));
    writeLocal("a1", { flags: ["q1"], marks: { "a1.g1.passage": marks(["new"]) }, savedAt: 9 });
    expect(JSON.parse(localStorage.getItem("bestway.cbt_annotations.a1.g1.passage")!).highlights).toEqual(["new"]);
    expect(localStorage.getItem("bestway.cbt_annotations.a1.old.passage")).toBeNull();
    expect(localStorage.getItem("bestway.cbt_annotations.other.g.passage")).not.toBeNull();
    expect(readLocal("a1")).toEqual({ flags: ["q1"], marks: { "a1.g1.passage": marks(["new"]) }, savedAt: 9 });
  });

  it("on opening, a newer server copy replaces the device cache", () => {
    writeLocal("a1", { flags: ["old"], marks: {}, savedAt: 10 });
    const server = toDocument({ flags: ["q2"], marks: { "a1.g.passage": marks(["from server"]) }, savedAt: 20 });
    const { workspace, push } = resolveOnOpen("a1", server);
    expect(push).toBe(false);
    expect(workspace.flags).toEqual(["q2"]);
    expect(readLocal("a1").marks["a1.g.passage"].highlights).toEqual(["from server"]);
  });

  it("on opening, newer unsent edits on this device are kept and pushed", () => {
    writeLocal("a1", { flags: [], marks: { "a1.g.passage": marks(["offline mark"]) }, savedAt: 10 });
    touchLocal("a1", ["q9"], 30);
    const { workspace, push } = resolveOnOpen("a1", toDocument({ flags: [], marks: {}, savedAt: 20 }));
    expect(push).toBe(true);
    expect(workspace.flags).toEqual(["q9"]);
    expect(workspace.marks["a1.g.passage"].highlights).toEqual(["offline mark"]);
  });

  it("an empty server and an empty device give an empty workspace with nothing to send", () => {
    expect(resolveOnOpen("a1", [])).toEqual({ workspace: { flags: [], marks: {}, savedAt: 0 }, push: false });
  });
});
