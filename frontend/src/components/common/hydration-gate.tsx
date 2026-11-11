"use client";

import * as React from "react";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Renders `fallback` on the server and for the first client render, then the
 * children. For views built only from client-side data (React Query cache):
 * the server cannot know that data, so rendering it during hydration would
 * produce a mismatch whenever the cache is already warm.
 */
export function HydrationGate({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return useHydrated() ? <>{children}</> : <>{fallback}</>;
}
