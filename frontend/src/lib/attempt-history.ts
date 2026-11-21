import type { MockAttemptSummary, PageMeta } from "@/lib/types";

/** One history page as the API returns it (`data` plus the pagination `meta`). */
export interface AttemptPage {
  data: MockAttemptSummary[];
  meta?: PageMeta;
}

export interface AttemptHistory {
  items: MockAttemptSummary[];
  /** Server-reported number of the student's attempts that match the filter. */
  total: number;
  /** False when the bounded walk stopped before the end: the history shown is only the newest part. */
  complete: boolean;
}

/** Attempts per request (the API maximum) and the most pages one history load follows (1 000 attempts). */
export const HISTORY_PAGE_SIZE = 100;
export const HISTORY_MAX_PAGES = 10;

/**
 * Reads the student's authorised attempt history page by page through the API cursor.
 * Bounded: never more than HISTORY_MAX_PAGES requests. Duplicates (should the server ever repeat one) are dropped by id.
 */
export async function loadAttemptHistory(
  fetchPage: (cursor?: string) => Promise<AttemptPage>,
  maxPages: number = HISTORY_MAX_PAGES,
): Promise<AttemptHistory> {
  const seen = new Set<string>();
  const items: MockAttemptSummary[] = [];
  let cursor: string | undefined;
  let total = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const { data, meta } = await fetchPage(cursor);
    for (const attempt of data) {
      if (!seen.has(attempt.id)) {
        seen.add(attempt.id);
        items.push(attempt);
      }
    }
    total = meta?.total ?? items.length;
    if (meta?.hasMore === undefined) return { items, total, complete: items.length >= total }; // older server: no cursor, first page only
    if (!meta.hasMore || !meta.nextCursor) return { items, total, complete: !meta.hasMore };
    cursor = meta.nextCursor;
  }
  return { items, total, complete: false };
}
