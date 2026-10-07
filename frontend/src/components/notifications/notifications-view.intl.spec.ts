import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_ZONE } from "@/i18n/intl-defaults";
import type { NotificationItem } from "@/lib/types";

const { useNotifications } = vi.hoisted(() => ({ useNotifications: vi.fn() }));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications,
  useMarkAllRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkRead: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: null }) }));
vi.mock("@/components/notifications/broadcast-dialog", () => ({ BroadcastDialog: () => null }));
// `next-intl/server` can't load outside a React Server Component, so hand the request config
// factory straight back and call the real `i18n/request.ts` ourselves below.
vi.mock("next-intl/server", () => ({ getRequestConfig: (create: unknown) => create }));

import getRequestConfig from "@/i18n/request";
import { NotificationsView } from "./notifications-view";

const item: NotificationItem = {
  id: "n1",
  type: "announcement",
  text: "Center closed tomorrow",
  date: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  read: false,
};

const h = React.createElement;
const requestConfig = () => getRequestConfig({ requestLocale: Promise.resolve("en") });
const spies = () => [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];

afterEach(() => vi.restoreAllMocks());

describe("NotificationsView with the real next-intl formatter", () => {
  it("pins one time zone for every component", async () => {
    const config = await requestConfig();

    expect(config.timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it("renders relative timestamps without the ENVIRONMENT_FALLBACK console error", async () => {
    useNotifications.mockReturnValue({ data: [item], isLoading: false, isError: false, refetch: vi.fn() });
    const [error, warn] = spies();

    // The shipped request config and the real formatter, deliberately without a global `now`:
    // the call site is the only thing that can supply the reference point.
    const config = await requestConfig();
    const html = renderToStaticMarkup(
      h(NextIntlClientProvider, { ...config, children: h(NotificationsView) }),
    );

    const logged = [...error.mock.calls, ...warn.mock.calls].map((args) => String(args[0]));
    expect(logged.filter((line) => line.includes("ENVIRONMENT_FALLBACK"))).toEqual([]);
    expect(logged.filter((line) => line.includes("relativeTime"))).toEqual([]);
    expect(html).toContain("Center closed tomorrow");
    expect(html).toContain("minutes ago");
  });
});
