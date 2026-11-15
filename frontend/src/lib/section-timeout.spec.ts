import { describe, expect, it } from "vitest";
import { nextSectionOnTimeout } from "./section-timeout";

const ielts = ["listening", "reading", "writing", "speaking"];
describe("section timeout", () => {
  it("moves a full test to the next section instead of handing in the whole exam", () => {
    expect(nextSectionOnTimeout(true, "listening", ielts)).toBe(true);
    expect(nextSectionOnTimeout(true, "writing", ielts)).toBe(true);
  });
  it("hands in at the last section, in speaking and in single-section attempts", () => {
    expect(nextSectionOnTimeout(true, "writing", ["listening", "reading", "writing"])).toBe(false);
    expect(nextSectionOnTimeout(true, "speaking", ielts)).toBe(false);
    expect(nextSectionOnTimeout(false, "reading", ielts)).toBe(false);
    expect(nextSectionOnTimeout(true, null, ielts)).toBe(false);
  });
});
