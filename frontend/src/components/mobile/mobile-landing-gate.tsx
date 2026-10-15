"use client";

import * as React from "react";
import { useIsMobileApp } from "@/lib/platform";
import { MobileWelcomeScreen } from "./mobile-welcome-screen";

export function MobileLandingGate({
  locale,
  isAuthenticated,
  children,
}: {
  locale: string;
  isAuthenticated: boolean;
  children: React.ReactNode;
}) {
  const isMobileApp = useIsMobileApp();

  React.useEffect(() => {
    if (isMobileApp && isAuthenticated) {
      window.location.assign(`/${locale}/dashboard`);
    }
  }, [isMobileApp, isAuthenticated, locale]);

  if (isMobileApp) {
    if (isAuthenticated) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-[#0B0F17] text-fg">
          <div className="flex flex-col items-center gap-3">
            <div className="size-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="text-xs font-medium text-fg-muted">Boshqaruv paneliga o&apos;tilmoqda...</p>
          </div>
        </div>
      );
    }
    return <MobileWelcomeScreen locale={locale} />;
  }

  return <>{children}</>;
}
