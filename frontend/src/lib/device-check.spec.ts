import { describe, expect, it } from "vitest";
import { classifyLatency, MIN_VOICE_LEVEL, peakLevel } from "./device-check";

describe("device check helpers", () => {
  it("classifies the measured round trip", () => {
    expect(classifyLatency(120)).toBe("ok");
    expect(classifyLatency(1500)).toBe("ok");
    expect(classifyLatency(2400)).toBe("warn");
    expect(classifyLatency(Number.NaN)).toBe("fail");
  });

  it("silence has no level, a voice does", () => {
    expect(peakLevel(new Uint8Array(256).fill(128))).toBe(0);
    expect(peakLevel(Uint8Array.from([128, 129, 127, 128]))).toBeLessThan(MIN_VOICE_LEVEL);
    expect(peakLevel(Uint8Array.from([128, 180, 70, 128]))).toBeGreaterThan(MIN_VOICE_LEVEL);
  });
});
