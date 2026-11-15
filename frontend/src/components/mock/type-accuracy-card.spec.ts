import { describe, expect, it } from "vitest";
import { familyRows } from "./type-accuracy-card";

const point = (attemptId: string, correct: number, total: number) => ({ attemptId, finishedAt: null, correct, total });

describe("familyRows", () => {
  it("merges the completion types into one family, keeps the per-attempt trend and puts the weakest first", () => {
    const rows = familyRows([
      { type: "note_completion", correct: 3, total: 4, accuracy: 75, history: [point("a1", 1, 2), point("a2", 2, 2)] },
      { type: "sentence_completion", correct: 1, total: 4, accuracy: 25, history: [point("a1", 0, 2), point("a2", 1, 2)] },
      { type: "true_false_notgiven", correct: 1, total: 5, accuracy: 20, history: [point("a2", 1, 5)] },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["true_false_notgiven", "completion"]);
    expect(rows[1]).toMatchObject({ correct: 4, total: 8, accuracy: 50, trend: [25, 75] });
    expect(rows[0].trend).toEqual([20]);
  });
  it("reports no accuracy when nothing was asked", () => {
    expect(familyRows([{ type: "matching", correct: 0, total: 0, accuracy: null, history: [] }])[0].accuracy).toBeNull();
  });
});
