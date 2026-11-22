import { describe, expect, it } from "vitest";
import type { MockAttemptSummary } from "@/lib/types";
import { loadAttemptHistory, type AttemptPage } from "./attempt-history";

const attempt = (id: number) => ({ id: `a${String(id).padStart(3, "0")}` }) as MockAttemptSummary;

/** A fake server holding `count` attempts, newest first, with a cursor equal to the last id of the page. */
function server(count: number, { cursor: supportsCursor = true } = {}) {
  const all = Array.from({ length: count }, (_, i) => attempt(count - i));
  const calls: Array<string | undefined> = [];
  const fetchPage = async (cursor?: string): Promise<AttemptPage> => {
    calls.push(cursor);
    const start = cursor ? all.findIndex((a) => a.id === cursor) + 1 : 0;
    const data = all.slice(start, start + 20);
    const hasMore = start + 20 < all.length;
    if (!supportsCursor) return { data: all.slice(0, 20), meta: { limit: 20, total: count } };
    return { data, meta: { limit: 20, total: count, hasMore, nextCursor: hasMore ? data[data.length - 1].id : null } };
  };
  return { fetchPage, calls };
}

describe("loadAttemptHistory", () => {
  it("returns an empty complete history", async () => {
    const { fetchPage } = server(0);
    expect(await loadAttemptHistory(fetchPage)).toEqual({ items: [], total: 0, complete: true });
  });

  it("returns every attempt of a student with more than 20, once each, newest first", async () => {
    const { fetchPage, calls } = server(57);
    const history = await loadAttemptHistory(fetchPage);
    expect(history.items).toHaveLength(57);
    expect(new Set(history.items.map((a) => a.id)).size).toBe(57);
    expect(history.items[0].id).toBe("a057");
    expect(history.complete).toBe(true);
    expect(history.total).toBe(57);
    expect(calls).toHaveLength(3);
  });

  it("drops a repeated attempt instead of showing it twice", async () => {
    const pages: AttemptPage[] = [
      { data: [attempt(3), attempt(2)], meta: { limit: 2, total: 3, hasMore: true, nextCursor: "c" } },
      { data: [attempt(2), attempt(1)], meta: { limit: 2, total: 3, hasMore: false, nextCursor: null } },
    ];
    let i = 0;
    const history = await loadAttemptHistory(async () => pages[i++]);
    expect(history.items.map((a) => a.id)).toEqual(["a003", "a002", "a001"]);
  });

  it("stops at the page bound and says the history is not complete", async () => {
    const { fetchPage, calls } = server(200);
    const history = await loadAttemptHistory(fetchPage, 3);
    expect(calls).toHaveLength(3);
    expect(history.items).toHaveLength(60);
    expect(history.total).toBe(200);
    expect(history.complete).toBe(false);
  });

  it("does not claim a complete history from an older server that cannot page past its first page", async () => {
    const { fetchPage } = server(57, { cursor: false });
    const history = await loadAttemptHistory(fetchPage);
    expect(history.items).toHaveLength(20);
    expect(history.complete).toBe(false);
  });

  it("treats an older server's short history as complete", async () => {
    const { fetchPage } = server(12, { cursor: false });
    expect((await loadAttemptHistory(fetchPage)).complete).toBe(true);
  });
});
