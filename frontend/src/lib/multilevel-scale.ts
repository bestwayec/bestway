/**
 * Multilevel 0–75 overall-score → CEFR scale used by the platform.
 *
 * Mirrors `multilevel_level()` in backend-django/apps/core/mock_scoring.py and
 * `MULTILEVEL_SCALE_BANDS` in prediction_service.py, which decide the level the
 * server stores on results. Every screen must show these same ranges, so the
 * numbers next to a level can never contradict the level itself.
 *
 * NOTE: confirming these cut-offs against the current official UZBMB regulation
 * is an open product decision; change them here and in the backend together.
 */
export const MULTILEVEL_SCALE_VERSION = "UZBMB_MULTILEVEL_EN_2026_V2";

export const MULTILEVEL_CEFR_BANDS = [
  { level: "A2", label: "A2 / Below B1", min: 0, max: 33 },
  { level: "B1", label: "B1", min: 34, max: 45 },
  { level: "B2", label: "B2", min: 46, max: 59 },
  { level: "C1", label: "C1", min: 60, max: 75 },
] as const;

export function multilevelBandFor(level?: string | null) {
  const norm = (level ?? "").toUpperCase();
  return (
    MULTILEVEL_CEFR_BANDS.find((band) => band.level !== "A2" && norm.includes(band.level)) ??
    MULTILEVEL_CEFR_BANDS[0]
  );
}

export function multilevelLevelFromScore(score: number): (typeof MULTILEVEL_CEFR_BANDS)[number]["level"] {
  const clamped = Math.max(0, Math.min(75, score));
  return [...MULTILEVEL_CEFR_BANDS].reverse().find((band) => clamped >= band.min)!.level;
}
