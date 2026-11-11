/**
 * Theme bootstrapping (docs/design/DESIGN_SYSTEM.md): light is the default, dark is an opt-in that is
 * remembered in localStorage("theme"). This script runs in <head> before the first paint so a user who
 * chose dark never sees a light flash (and vice versa). Keep it tiny and dependency-free.
 */
export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME = "light" as const;

export function resolveStoredTheme(stored: string | null | undefined): "light" | "dark" {
  return stored === "dark" ? "dark" : DEFAULT_THEME;
}

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark"?"dark":"light";var e=document.documentElement;if(t==="dark"){e.classList.add("dark")}else{e.classList.remove("dark")}e.style.colorScheme=t;e.setAttribute("data-theme",t)}catch(_){}})();`;
