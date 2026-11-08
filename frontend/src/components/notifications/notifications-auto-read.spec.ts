// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationItem } from "@/lib/types";

const { useNotifications, markAll } = vi.hoisted(() => ({ useNotifications: vi.fn(), markAll: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ relativeTime: () => "just now" }),
}));
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications,
  useMarkAllRead: () => ({ mutate: markAll, isPending: false }),
  useMarkRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: null }) }));
vi.mock("@/components/notifications/broadcast-dialog", () => ({ BroadcastDialog: () => null }));

import { NotificationsView } from "./notifications-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, read: boolean): NotificationItem => ({ id, type: "points", text: `n-${id}`, date: "2026-11-01T08:00:00.000Z", read });

let host: HTMLDivElement | null = null;
afterEach(() => { host?.remove(); host = null; markAll.mockReset(); });

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(React.createElement(NotificationsView)));
  return root;
}

describe("NotificationsView marks notifications read when opened (O4)", () => {
  it("calls read-all exactly once when unread notifications are shown", () => {
    useNotifications.mockReturnValue({ data: [row("a", false), row("b", true)], isLoading: false, isError: false, refetch: vi.fn() });
    const root = mount();
    act(() => root.render(React.createElement(NotificationsView)));
    expect(markAll).toHaveBeenCalledTimes(1);
    // After the server confirms, the row stays highlighted for this visit.
    useNotifications.mockReturnValue({ data: [row("a", true), row("b", true)], isLoading: false, isError: false, refetch: vi.fn() });
    act(() => root.render(React.createElement(NotificationsView)));
    expect(markAll).toHaveBeenCalledTimes(1);
    expect(host!.querySelectorAll(".bg-brand.rounded-full").length).toBe(1);
    act(() => root.unmount());
  });

  it("does not call read-all when everything is already read or still loading", () => {
    useNotifications.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const root = mount();
    useNotifications.mockReturnValue({ data: [row("a", true)], isLoading: false, isError: false, refetch: vi.fn() });
    act(() => root.render(React.createElement(NotificationsView)));
    expect(markAll).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
