// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXAM_SETTINGS, examSettingsClasses, loadExamSettings, saveExamSettings, timerAlert, timerTone } from "./exam-settings";

describe("exam settings", () => {
  beforeEach(() => localStorage.clear());
  it("defaults, saves and ignores invalid stored values", () => {
    expect(loadExamSettings()).toEqual(DEFAULT_EXAM_SETTINGS);
    saveExamSettings({ ...DEFAULT_EXAM_SETTINGS, textSize: "xlarge", colours: "yellow_on_black", volume: 0.4 });
    expect(loadExamSettings()).toEqual({ ...DEFAULT_EXAM_SETTINGS, textSize: "xlarge", colours: "yellow_on_black", volume: 0.4 });
    // Settings saved by 5.0 (three fields) keep working and gain the new defaults.
    localStorage.setItem("bw_exam_settings", JSON.stringify({ textSize: "large", colours: "standard", volume: 1 }));
    expect(loadExamSettings()).toEqual({ ...DEFAULT_EXAM_SETTINGS, textSize: "large" });
    localStorage.setItem("bw_exam_settings", JSON.stringify({ textSize: "huge", colours: "pink", volume: 7 }));
    expect(loadExamSettings()).toEqual(DEFAULT_EXAM_SETTINGS);
    localStorage.setItem("bw_exam_settings", JSON.stringify({ theme: "neon", lineSpacing: "huge", reduceMotion: "yes" }));
    expect(loadExamSettings()).toEqual(DEFAULT_EXAM_SETTINGS);
  });
  it("maps comfort settings to exam-area classes", () => {
    expect(examSettingsClasses(DEFAULT_EXAM_SETTINGS)).toEqual(["exam-theme-standard"]);
    expect(examSettingsClasses({ ...DEFAULT_EXAM_SETTINGS, lineSpacing: "relaxed", reduceMotion: true, strongFocus: true }))
      .toEqual(["exam-theme-standard", "exam-line-relaxed", "exam-reduce-motion", "exam-strong-focus"]);
  });
});

describe("time warnings", () => {
  const min = 60_000;
  it("shows a notice for ten seconds after 5:00 and after 1:00, only where the section warns", () => {
    expect(timerAlert(10 * min, true)).toBe("none");
    expect(timerAlert(5 * min + 1000, true)).toBe("none");
    expect(timerAlert(5 * min, true)).toBe("five");
    expect(timerAlert(5 * min - 9_000, true)).toBe("five");
    expect(timerAlert(5 * min - 10_000, true)).toBe("none");
    expect(timerAlert(min, true)).toBe("one");
    expect(timerAlert(min - 10_000, true)).toBe("none");
    expect(timerAlert(5 * min, false)).toBe("none");
  });
  it("turns to the warning colour under 5 minutes and danger in the last minute", () => {
    expect(timerTone(5 * min + 1000)).toBe("normal");
    expect(timerTone(5 * min)).toBe("warning");
    expect(timerTone(61_000)).toBe("warning");
    expect(timerTone(60_000)).toBe("danger");
    expect(timerTone(0)).toBe("danger");
  });
});
