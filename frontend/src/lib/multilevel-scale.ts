/**
 * Multilevel 0–75 score → CEFR level, from the mean of the four sections.
 *
 * Mirror of `MULTILEVEL_LEVELS` in backend-django/apps/core/exam_blueprint.py (the one
 * table; agency criteria: below 38 no level, B1 38–50, B2 51–64, C1 65–75). The server
 * stores the level on results; this copy is only for drawing the scale. A parity test
 * reads the backend table, so the two cannot drift apart.
 */
export const MULTILEVEL_SCALE_VERSION = "UZBMB_MULTILEVEL_2023_CRITERIA";

export const MULTILEVEL_CEFR_BANDS = [
  { level: "BELOW_B1", label: "Below B1", min: 0, max: 37 },
  { level: "B1", label: "B1", min: 38, max: 50 },
  { level: "B2", label: "B2", min: 51, max: 64 },
  { level: "C1", label: "C1", min: 65, max: 75 },
] as const;

export function multilevelBandFor(level?: string | null) {
  const norm = (level ?? "").toUpperCase();
  return (
    MULTILEVEL_CEFR_BANDS.find((band) => band.level !== "BELOW_B1" && norm.includes(band.level)) ??
    MULTILEVEL_CEFR_BANDS[0]
  );
}

export function multilevelLevelFromScore(score: number): (typeof MULTILEVEL_CEFR_BANDS)[number]["level"] {
  const clamped = Math.max(0, Math.min(75, score));
  return [...MULTILEVEL_CEFR_BANDS].reverse().find((band) => clamped >= band.min)!.level;
}

/** Text for a stored level code: "BELOW_B1" is not a level, so show the translated phrase. */
export function multilevelLevelText(level: string | null | undefined, belowB1: string): string {
  if (!level) return "";
  return level.toUpperCase() === "BELOW_B1" ? belowB1 : level;
}
