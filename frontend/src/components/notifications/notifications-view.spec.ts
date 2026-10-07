import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@/lib/types";

const { relativeTime, useNotifications } = vi.hoisted(() => ({
  // Records the arguments so the test can prove an explicit reference point is supplied:
  // without it next-intl silently falls back to `Date.now()` and warns (ENVIRONMENT_FALLBACK).
  relativeTime: vi.fn((date: Date, now?: Date) => `relative:${date.toISOString()}:${now instanceof Date ? "with-now" : "no-now"}`),
  useNotifications: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ relativeTime }),
}));
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications,
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: null }) }));
vi.mock("@/components/notifications/broadcast-dialog", () => ({ BroadcastDialog: () => null }));

import { NotificationsView } from "./notifications-view";

const h = React.createElement;

const item: NotificationItem = {
  id: "n1",
  type: "announcement",
  text: "Center closed tomorrow",
  date: "2026-10-07T08:00:00.000Z",
  read: false,
};

describe("NotificationsView relative timestamps", () => {
  it("passes an explicit reference time to format.relativeTime for every row", () => {
    relativeTime.mockClear();
    useNotifications.mockReturnValue({ data: [item], isLoading: false, isError: false, refetch: vi.fn() });

    const html = renderToStaticMarkup(h(NotificationsView));

    expect(relativeTime).toHaveBeenCalledTimes(1);
    const [date, now] = relativeTime.mock.calls[0];
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe(item.date);
    expect(now).toBeInstanceOf(Date);
    expect(html).toContain("relative:2026-10-07T08:00:00.000Z:with-now");
    expect(html).not.toContain("no-now");
  });

  it("does not call format.relativeTime while the list is loading", () => {
    relativeTime.mockClear();
    useNotifications.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });

    renderToStaticMarkup(h(NotificationsView));

    expect(relativeTime).not.toHaveBeenCalled();
  });
});
