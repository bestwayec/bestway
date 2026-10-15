"use client";

import * as React from "react";

/**
 * Checks whether the current runtime is inside the dedicated BestWay mobile application
 * (Android APK / Tauri / Capacitor / WebView) or explicitly requested mobile app mode.
 */
export function checkIsMobileApp(): boolean {
  if (typeof window === "undefined") return false;

  try {
    // 1. Explicit search param override
    const search = window.location.search;
    if (search.includes("platform=mobile_app") || search.includes("mobile_app=true")) {
      try {
        localStorage.setItem("bw_is_mobile_app", "true");
        document.cookie = "bw_mobile_app=1; path=/; max-age=31536000; SameSite=Lax";
      } catch {}
      return true;
    }

    // 2. LocalStorage persistence
    if (localStorage.getItem("bw_is_mobile_app") === "true") {
      return true;
    }

    // 3. User-Agent detection (Android APK appends "BestWay-Android/0.5.4 MobileApp")
    const ua = navigator.userAgent || "";
    if (/BestWay-Android|BestWayApp|MobileApp|Tauri/i.test(ua)) {
      try {
        localStorage.setItem("bw_is_mobile_app", "true");
        document.cookie = "bw_mobile_app=1; path=/; max-age=31536000; SameSite=Lax";
      } catch {}
      return true;
    }

    // 4. Injected AndroidBridge or Tauri mobile internals
    if (
      (window as unknown as { AndroidBridge?: { isMobileApp?: () => boolean } }).AndroidBridge ||
      (window as unknown as { __BESTWAY_MOBILE_APP__?: boolean }).__BESTWAY_MOBILE_APP__
    ) {
      try {
        localStorage.setItem("bw_is_mobile_app", "true");
        document.cookie = "bw_mobile_app=1; path=/; max-age=31536000; SameSite=Lax";
      } catch {}
      return true;
    }
  } catch {}

  return false;
}

/**
 * React hook to reactively track mobile app mode and apply HTML root class.
 */
export function useIsMobileApp(): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return checkIsMobileApp();
  });

  React.useEffect(() => {
    const active = checkIsMobileApp();
    setIsMobile(active);
    if (active) {
      document.documentElement.classList.add("is-mobile-app");
    } else {
      document.documentElement.classList.remove("is-mobile-app");
    }
  }, []);

  return isMobile;
}
