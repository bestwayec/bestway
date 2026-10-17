import { describe, expect, it } from "vitest";

function getMultilevelCefr(score: number): "A2" | "B1" | "B2" | "C1" {
  const clamped = Math.max(0, Math.min(75, score));
  if (clamped < 34) return "A2";
  if (clamped < 46) return "B1";
  if (clamped < 60) return "B2";
  return "C1";
}

function getDtmQuestionStatusClass(opts: {
  isAnswered: boolean;
  isFlagged: boolean;
}): "green" | "yellow" | "grey" {
  if (opts.isFlagged) return "yellow";
  if (opts.isAnswered) return "green";
  return "grey";
}

function parseTimestampInput(raw: string | number): number {
  if (typeof raw === "number") return Math.max(0, raw);
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").map((part) => Number(part.trim()));
    if (parts.some((n) => Number.isNaN(n))) return 0;
    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
    if (parts.length === 3) {
      return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

describe("BestWay v0.8.0 Frontend Simulator & Prediction Logic", () => {
  it("maps Multi-Level 0-75 score to CEFR levels (A2: 0-33, B1: 34-45, B2: 46-59, C1: 60-75)", () => {
    expect(getMultilevelCefr(0)).toBe("A2");
    expect(getMultilevelCefr(33)).toBe("A2");
    expect(getMultilevelCefr(34)).toBe("B1");
    expect(getMultilevelCefr(45)).toBe("B1");
    expect(getMultilevelCefr(46)).toBe("B2");
    expect(getMultilevelCefr(59)).toBe("B2");
    expect(getMultilevelCefr(60)).toBe("C1");
    expect(getMultilevelCefr(75)).toBe("C1");
  });

  it("assigns DTM bottom question palette colors (answered -> green, unseen -> grey, flagged -> yellow)", () => {
    expect(getDtmQuestionStatusClass({ isAnswered: false, isFlagged: false })).toBe("grey");
    expect(getDtmQuestionStatusClass({ isAnswered: true, isFlagged: false })).toBe("green");
    expect(getDtmQuestionStatusClass({ isAnswered: false, isFlagged: true })).toBe("yellow");
    expect(getDtmQuestionStatusClass({ isAnswered: true, isFlagged: true })).toBe("yellow");
  });

  it("parses Listening part timestamps in MM:SS, HH:MM:SS, and seconds", () => {
    expect(parseTimestampInput("00:00")).toBe(0);
    expect(parseTimestampInput("07:30")).toBe(450);
    expect(parseTimestampInput("15:05")).toBe(905);
    expect(parseTimestampInput("01:02:03")).toBe(3723);
    expect(parseTimestampInput(1350)).toBe(1350);
  });
});
