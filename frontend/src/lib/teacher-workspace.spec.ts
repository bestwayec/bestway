import { describe, expect, it } from "vitest";
import { attendanceSummary, changedRecords, defaultDeadline, formatDuration, localInputToIso, toLocalInput } from "./teacher-workspace";

const saved = [
  { studentId: "a", name: "A", active: true, state: "present" as const },
  { studentId: "b", name: "B", active: true, state: null },
  { studentId: "c", name: "C", active: true, state: null },
];

describe("attendance helpers", () => {
  it("never treats an unmarked student as present", () => {
    expect(attendanceSummary({ a: "present", b: null, c: undefined })).toEqual({ present: 1, absent: 0, late: 0 });
  });

  it("saves only students whose mark changed — unmarked students stay unmarked", () => {
    expect(changedRecords(saved, { a: "present", b: "absent", c: null })).toEqual([{ studentId: "b", state: "absent" }]);
    expect(changedRecords(saved, { a: "late", b: null, c: null })).toEqual([{ studentId: "a", state: "late" }]);
    expect(changedRecords(saved, { a: "present" })).toEqual([]);
  });
});

describe("deadline helpers", () => {
  it("sends an offset-aware ISO timestamp (the server rejects naive times)", () => {
    const iso = localInputToIso("2026-12-01T20:00");
    expect(iso).toMatch(/^2026-12-01T20:00:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(new Date("2026-12-01T20:00").getTime());
    expect(localInputToIso("not a date")).toBe("");
  });

  it("defaults to the day after tomorrow at 20:00 local time", () => {
    const now = new Date(2026, 10, 22, 9, 30);
    expect(defaultDeadline(now)).toBe(toLocalInput(new Date(2026, 10, 24, 20, 0)));
  });

  it("formats the server countdown as mm:ss and never goes negative", () => {
    expect(formatDuration(125)).toBe("02:05");
    expect(formatDuration(-3)).toBe("00:00");
  });
});

describe("formatDateTime", () => {
  it("is numeric and readable in every locale", async () => {
    const { formatDateTime } = await import("./teacher-workspace");
    expect(formatDateTime(new Date(2026, 10, 23, 20, 5))).toBe("23.11.2026 20:05");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("nonsense")).toBe("—");
  });
});
