/**
 * Global next-intl defaults, shared by `i18n/request.ts` (which feeds every server and client
 * component) and the tests that pin them.
 *
 * The center runs on Tashkent time — the backend pins the same zone for its midnight cron jobs.
 * A `timeZone` has to be configured somewhere: without one next-intl falls back to the runtime's
 * zone, so the server (UTC) and the browser (the visitor's zone) format the same instant
 * differently and next-intl logs `ENVIRONMENT_FALLBACK` for the possible markup mismatch.
 */
export const DEFAULT_TIME_ZONE = "Asia/Tashkent";
