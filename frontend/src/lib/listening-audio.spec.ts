import { describe, expect, it } from "vitest";
import {
  canSubmitVerification,
  draftNotice,
  fmtDuration,
  fmtSize,
  precheckAudioFile,
  rangeLabel,
  statusVariant,
  summarize,
  verifiable,
} from "./listening-audio";

const part = (status: "MISSING" | "UPLOADED" | "VERIFIED", numbers = [1, 2, 3], hasAudio = status !== "MISSING") => ({
  status,
  hasAudio,
  questionNumbers: numbers,
  questionRange: numbers.length ? ([numbers[0], numbers[numbers.length - 1]] as [number, number]) : null,
});

describe("listening audio gate helpers", () => {
  it("maps each status to a distinct tone", () => {
    expect(statusVariant("MISSING")).toBe("danger");
    expect(statusVariant("UPLOADED")).toBe("warning");
    expect(statusVariant("VERIFIED")).toBe("success");
  });

  it("summarises the four parts", () => {
    expect(summarize([part("MISSING"), part("UPLOADED"), part("VERIFIED"), part("MISSING")])).toEqual({ missing: 2, uploaded: 1, verified: 1, total: 4 });
  });

  it("labels the question range", () => {
    expect(rangeLabel(part("UPLOADED", [11, 12, 20]))).toBe("11–20");
    expect(rangeLabel(part("MISSING", []))).toBeNull();
  });

  it("accepts only MP3/M4A of a sensible size before upload", () => {
    expect(precheckAudioFile({ name: "Part1.MP3", size: 5_000_000 })).toBeNull();
    expect(precheckAudioFile({ name: "part2.m4a", size: 5_000_000 })).toBeNull();
    expect(precheckAudioFile({ name: "part.wav", size: 5_000_000 })).toMatch(/MP3 or M4A/);
    expect(precheckAudioFile({ name: "part.mp3.exe", size: 5_000_000 })).toMatch(/MP3 or M4A/);
    expect(precheckAudioFile({ name: "a.mp3", size: 100 })).toMatch(/too small/);
    expect(precheckAudioFile({ name: "a.mp3", size: 300 * 1024 * 1024 })).toMatch(/larger/);
  });

  it("lets only administrators verify an unverified part that has audio", () => {
    expect(verifiable(part("UPLOADED"), "admin")).toBe(true);
    expect(verifiable(part("UPLOADED"), "super_admin")).toBe(true);
    expect(verifiable(part("UPLOADED"), "teacher")).toBe(false);
    expect(verifiable(part("UPLOADED"), undefined)).toBe(false);
    expect(verifiable(part("MISSING"), "admin")).toBe(false);
    expect(verifiable(part("VERIFIED"), "admin")).toBe(false);
  });

  it("requires every question ticked and a full listen before submitting verification", () => {
    const p = part("UPLOADED", [1, 2, 3]);
    expect(canSubmitVerification(p, [1, 2, 3], true)).toBe(true);
    expect(canSubmitVerification(p, [1, 2], true)).toBe(false);
    expect(canSubmitVerification(p, [1, 2, 3], false)).toBe(false);
    expect(canSubmitVerification(p, [1, 2, 3, 4], true)).toBe(false);
    expect(canSubmitVerification(part("UPLOADED", []), [], true)).toBe(false);
  });

  it("formats durations and sizes", () => {
    expect(fmtDuration(452)).toBe("7:32");
    expect(fmtDuration(null)).toBe("—");
    expect(fmtSize(512 * 1024)).toBe("512 KB");
    expect(fmtSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("shows the draft notice only while the exam is blocked and unpublished", () => {
    expect(draftNotice({ published: false, blockers: ["x"] })).toMatch(/DRAFT/);
    expect(draftNotice({ published: false, blockers: [] })).toBeNull();
    expect(draftNotice({ published: true, blockers: ["x"] })).toBeNull();
  });
});
