// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearQueue, confirm, enqueue, inOrder, loadQueue } from "./answer-queue";

describe("answer queue", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the latest edit per question across a reload", () => {
    enqueue("a1", "q1", "first", 100);
    enqueue("a1", "q1", "second", 200);
    enqueue("a1", "q2", "other", 150);
    expect(loadQueue("a1")).toEqual({ q1: { response: "second", editedAt: 200 }, q2: { response: "other", editedAt: 150 } });
    expect(loadQueue("a2")).toEqual({});
  });

  it("never lets an older edit replace a newer one", () => {
    enqueue("a1", "q1", "new", 200);
    enqueue("a1", "q1", "old", 100);
    expect(loadQueue("a1").q1.response).toBe("new");
  });

  it("confirm removes what the server saved but keeps a later edit", () => {
    enqueue("a1", "q1", "sent", 100);
    enqueue("a1", "q2", "sent too", 110);
    enqueue("a1", "q1", "typed while sending", 120);
    confirm("a1", [{ questionId: "q1", editedAt: 100 }, { questionId: "q2", editedAt: 110 }]);
    expect(loadQueue("a1")).toEqual({ q1: { response: "typed while sending", editedAt: 120 } });
  });

  it("sends in the order the edits were made", () => {
    enqueue("a1", "q3", "c", 300);
    enqueue("a1", "q1", "a", 100);
    enqueue("a1", "q2", "b", 200);
    expect(inOrder(loadQueue("a1")).map((e) => e.questionId)).toEqual(["q1", "q2", "q3"]);
  });

  it("ignores damaged storage and clears cleanly", () => {
    localStorage.setItem("bw_answer_queue_a1", "{not json");
    expect(loadQueue("a1")).toEqual({});
    localStorage.setItem("bw_answer_queue_a1", JSON.stringify({ q1: { response: 5, editedAt: "x" }, q2: { response: "ok", editedAt: 1 } }));
    expect(loadQueue("a1")).toEqual({ q2: { response: "ok", editedAt: 1 } });
    clearQueue("a1");
    expect(localStorage.getItem("bw_answer_queue_a1")).toBeNull();
  });
});
