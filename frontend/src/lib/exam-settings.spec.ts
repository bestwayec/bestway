// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXAM_SETTINGS, loadExamSettings, saveExamSettings, timerAlert, timerTone } from "./exam-settings";

describe("exam settings", () => {
  beforeEach(() => localStorage.clear());
  it("defaults, saves and ignores invalid stored values", () => {
    expect(loadExamSettings()).toEqual(DEFAULT_EXAM_SETTINGS);
    saveExamSettings({ textSize: "xlarge", colours: "yellow_on_black", volume: 0.4 });
    expect(loadExamSettings()).toEqual({ textSize: "xlarge", colours: "yellow_on_black", volume: 0.4 });
    localStorage.setItem("bw_exam_settings", JSON.stringify({ textSize: "huge", colours: "pink", volume: 7 }));
    expect(loadExamSettings()).toEqual(DEFAULT_EXAM_SETTINGS);
  });
});

describe("time warnings", () => {
  const min = 60_000;
  it("flashes for ten seconds after 10:00 and after 5:00, only where the section warns", () => {
    expect(timerAlert(10 * min + 1000, true)).toBe("none");
    expect(timerAlert(10 * min, true)).toBe("ten");
    expect(timerAlert(10 * min - 9_000, true)).toBe("ten");
    expect(timerAlert(10 * min - 10_000, true)).toBe("none");
    expect(timerAlert(5 * min, true)).toBe("five");
    expect(timerAlert(5 * min - 10_000, true)).toBe("none");
    expect(timerAlert(10 * min, false)).toBe("none");
  });
  it("uses the danger colour only in the last minute", () => {
    expect(timerTone(61_000)).toBe("normal");
    expect(timerTone(60_000)).toBe("danger");
    expect(timerTone(0)).toBe("danger");
  });
});
