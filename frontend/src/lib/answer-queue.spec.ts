// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadQueue, persistEdit, removeEdit } from "./answer-queue";

const entry = (response: string, editedAt: number, writer = "page-1") => ({ response, editedAt, writer, baseRevision: null });

describe("answer journal", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the latest edit and scopes it to the attempt", () => {
    persistEdit("a1", "q1", entry("first", 100));
    persistEdit("a1", "q1", entry("second", 200));
    persistEdit("a1", "q2", entry("other", 150));
    expect(loadQueue("a1")).toEqual({ q1: entry("second", 200), q2: entry("other", 150) });
    expect(loadQueue("a2")).toEqual({});
  });

  it("keeps a later edit when a response acknowledges the previous version", () => {
    const sent = entry("sent", 100);
    persistEdit("a1", "q1", sent);
    const latest = entry("newer", 101);
    persistEdit("a1", "q1", latest);
    removeEdit("a1", "q1", sent);
    expect(loadQueue("a1").q1).toEqual(latest);
  });

  it("keeps each writer's edit when the other tab saves or clears its own entry", () => {
    const first = entry("first writer", 100);
    const second = entry("second writer", 200, "page-2");
    persistEdit("a1", "q1", first);
    persistEdit("a1", "q1", second);
    expect(loadQueue("a1").q1).toEqual(second);
    removeEdit("a1", "q1", second);
    expect(loadQueue("a1").q1).toEqual(first);
  });

  it("recovers legacy edits and ignores malformed entries independently", () => {
    localStorage.setItem("bw_answer_queue_a1", JSON.stringify({
      q1: { response: 5, editedAt: "invalid" }, q2: { response: "old queue", editedAt: 1 },
    }));
    persistEdit("a1", "q3", entry("journal", 2));
    const queue = loadQueue("a1");
    expect(queue.q1).toBeUndefined();
    expect(queue.q2.response).toBe("old queue");
    expect(queue.q3.response).toBe("journal");
    removeEdit("a1", "q2", queue.q2);
    expect(loadQueue("a1").q2).toBeUndefined();
    localStorage.setItem("bw_answer_queue_a1", "{not json");
    expect(loadQueue("a1").q3.response).toBe("journal");
  });
});
