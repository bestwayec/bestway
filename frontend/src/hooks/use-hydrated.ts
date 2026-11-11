"use client";

import * as React from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Use it for text that
 * depends on client-only state (e.g. the cached current user), so the first client
 * render matches the server HTML and React does not throw a hydration error.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(subscribe, () => true, () => false);
}
