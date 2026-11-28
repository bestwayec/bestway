/**
 * Exam window settings chosen by the student: text size, colour scheme and audio volume.
 * A per-viewer convenience kept in this browser only (never sent to the server).
 */
export type ExamTextSize = "regular" | "large" | "xlarge";
export type ExamColours = "standard" | "yellow_on_black" | "black_on_cream";
export type ExamLineSpacing = "normal" | "relaxed";
/** "site" follows the site's own light/dark choice. */
export type ExamTheme = "site" | "light" | "dark";
export type ExamSettings = {
  textSize: ExamTextSize;
  colours: ExamColours;
  volume: number;
  lineSpacing: ExamLineSpacing;
  theme: ExamTheme;
  reduceMotion: boolean;
  strongFocus: boolean;
};

export const DEFAULT_EXAM_SETTINGS: ExamSettings = {
  textSize: "regular", colours: "standard", volume: 1, lineSpacing: "normal", theme: "site", reduceMotion: false, strongFocus: false,
};
export const TEXT_ZOOM: Record<ExamTextSize, number> = { regular: 1, large: 1.15, xlarge: 1.3 };
export const COLOUR_CLASS: Record<ExamColours, string> = {
  standard: "exam-theme-standard",
  yellow_on_black: "exam-theme-yellow-on-black",
  black_on_cream: "exam-theme-black-on-cream",
};
const LINE_SPACINGS: ExamLineSpacing[] = ["normal", "relaxed"];
const THEMES: ExamTheme[] = ["site", "light", "dark"];
const KEY = "bw_exam_settings";

/** Classes the exam area takes for the comfort settings (applied in place; nothing remounts). */
export function examSettingsClasses(settings: ExamSettings): string[] {
  return [
    COLOUR_CLASS[settings.colours],
    settings.lineSpacing === "relaxed" ? "exam-line-relaxed" : "",
    settings.reduceMotion ? "exam-reduce-motion" : "",
    settings.strongFocus ? "exam-strong-focus" : "",
  ].filter(Boolean);
}

export function normalizeExamSettings(raw: Partial<ExamSettings> | null | undefined): ExamSettings {
  const value = raw ?? {};
  return {
    textSize: value.textSize && value.textSize in TEXT_ZOOM ? value.textSize : DEFAULT_EXAM_SETTINGS.textSize,
    colours: value.colours && value.colours in COLOUR_CLASS ? value.colours : DEFAULT_EXAM_SETTINGS.colours,
    volume: typeof value.volume === "number" && value.volume >= 0 && value.volume <= 1 ? value.volume : DEFAULT_EXAM_SETTINGS.volume,
    lineSpacing: value.lineSpacing && LINE_SPACINGS.includes(value.lineSpacing) ? value.lineSpacing : DEFAULT_EXAM_SETTINGS.lineSpacing,
    theme: value.theme && THEMES.includes(value.theme) ? value.theme : DEFAULT_EXAM_SETTINGS.theme,
    reduceMotion: typeof value.reduceMotion === "boolean" ? value.reduceMotion : DEFAULT_EXAM_SETTINGS.reduceMotion,
    strongFocus: typeof value.strongFocus === "boolean" ? value.strongFocus : DEFAULT_EXAM_SETTINGS.strongFocus,
  };
}

export function loadExamSettings(): ExamSettings {
  try {
    return normalizeExamSettings(JSON.parse(window.localStorage.getItem(KEY) || "{}") as Partial<ExamSettings>);
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
 * Time warnings (DIRECTION.md, exam window): a calm notice when 5 minutes and 1 minute are left. The
 * clock turns to the warning colour under 5 minutes and the danger colour in the last minute; nothing
 * flashes. The time itself always comes from the server.
 */
export type TimerAlert = "none" | "five" | "one";
export const ALERT_SECONDS = 10;
/** The notice shows for ten seconds after 5:00 and after 1:00, where the section warns. */
export function timerAlert(ms: number, warnSkill: boolean): TimerAlert {
  if (!warnSkill) return "none";
  const window = ALERT_SECONDS * 1000;
  if (ms <= 5 * 60_000 && ms > 5 * 60_000 - window) return "five";
  if (ms <= 60_000 && ms > 60_000 - window) return "one";
  return "none";
}
export function timerTone(ms: number): "normal" | "warning" | "danger" {
  if (ms <= 60_000) return "danger";
  return ms <= 5 * 60_000 ? "warning" : "normal";
}
