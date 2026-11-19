export const AUTH_CONTEXT_STORAGE = "bestway.auth.context";

export function publishAuthContextChange() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_CONTEXT_STORAGE, window.crypto.randomUUID());
  } catch {
    // Same-tab auth still uses full navigation when local storage is unavailable.
  }
}
