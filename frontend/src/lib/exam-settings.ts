/**
 * Exam window settings chosen by the student: text size, colour scheme and audio volume.
 * A per-viewer convenience kept in this browser only (never sent to the server).
 */
export type ExamTextSize = "regular" | "large" | "xlarge";
export type ExamColours = "standard" | "yellow_on_black" | "black_on_cream";
export type ExamSettings = { textSize: ExamTextSize; colours: ExamColours; volume: number };

export const DEFAULT_EXAM_SETTINGS: ExamSettings = { textSize: "regular", colours: "standard", volume: 1 };
export const TEXT_ZOOM: Record<ExamTextSize, number> = { regular: 1, large: 1.15, xlarge: 1.3 };
export const COLOUR_CLASS: Record<ExamColours, string> = {
  standard: "",
  yellow_on_black: "exam-theme-yellow-on-black",
  black_on_cream: "exam-theme-black-on-cream",
};
const KEY = "bw_exam_settings";

export function loadExamSettings(): ExamSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || "{}") as Partial<ExamSettings>;
    return {
      textSize: raw.textSize && raw.textSize in TEXT_ZOOM ? raw.textSize : DEFAULT_EXAM_SETTINGS.textSize,
      colours: raw.colours && raw.colours in COLOUR_CLASS ? raw.colours : DEFAULT_EXAM_SETTINGS.colours,
      volume: typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULT_EXAM_SETTINGS.volume,
    };
  } catch {
    return DEFAULT_EXAM_SETTINGS;
  }
}

export function saveExamSettings(settings: ExamSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

/** Volume shared by every audio player of the exam window. */
export const EXAM_VOLUME_EVENT = "bw-exam-volume";
export function broadcastVolume(volume: number) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EXAM_VOLUME_EVENT, { detail: volume }));
}

/**
 * Time warnings. Reading and Writing warn when 10 and 5 minutes are left (the clock
 * flashes in IELTS on computer); every section shows the danger colour in the last minute.
 */
export type TimerAlert = "none" | "ten" | "five";
export const ALERT_SECONDS = 10;
/** The clock flashes for ten seconds after 10:00 and after 5:00 (Reading and Writing only). */
export function timerAlert(ms: number, warnSkill: boolean): TimerAlert {
  if (!warnSkill) return "none";
  const window = ALERT_SECONDS * 1000;
  if (ms <= 10 * 60_000 && ms > 10 * 60_000 - window) return "ten";
  if (ms <= 5 * 60_000 && ms > 5 * 60_000 - window) return "five";
  return "none";
}
export function timerTone(ms: number): "normal" | "danger" {
  return ms <= 60_000 ? "danger" : "normal";
}
