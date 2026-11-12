"use client";

import * as React from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, resolveStoredTheme } from "@/lib/theme-init";

interface UseThemeProps {
  themes: string[];
  forcedTheme?: string | undefined;
  setTheme: (theme: string | ((prev: string) => string)) => void;
  theme?: string | undefined;
  resolvedTheme?: string | undefined;
  systemTheme?: "dark" | "light" | undefined;
}

const ThemeContext = React.createContext<UseThemeProps | undefined>(undefined);

export function useTheme(): UseThemeProps {
  const ctx = React.useContext(ThemeContext);
  if (ctx) return ctx;
  return {
    themes: ["light", "dark"],
    setTheme: () => {},
    theme: DEFAULT_THEME,
    resolvedTheme: DEFAULT_THEME,
    systemTheme: undefined,
    forcedTheme: undefined,
  };
}

interface ThemeProviderProps extends React.PropsWithChildren {
  forcedTheme?: string | undefined;
  defaultTheme?: string | undefined;
  enableSystem?: boolean | undefined;
  attribute?: unknown;
  storageKey?: string | undefined;
  themes?: string[] | undefined;
  disableTransitionOnChange?: boolean | undefined;
  enableColorScheme?: boolean | undefined;
  value?: unknown;
  nonce?: string;
}

export function ThemeProvider({
  children,
  storageKey = THEME_STORAGE_KEY,
  defaultTheme = DEFAULT_THEME,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<string>(defaultTheme);
  // The <head> script (lib/theme-init.ts) already applied the stored theme before paint. Do not touch
  // <html> until the stored value has been read, otherwise a dark user would flash to light on hydration.
  const [resolved, setResolved] = React.useState(false);

  React.useEffect(() => {
    try {
      setThemeState(resolveStoredTheme(localStorage.getItem(storageKey)));
    } catch {}
    setResolved(true);
  }, [storageKey]);

  React.useEffect(() => {
    if (!resolved) return;
    const el = document.documentElement;
    const next = theme === "dark" ? "dark" : "light";
    el.classList.toggle("dark", next === "dark");
    el.style.colorScheme = next;
    el.setAttribute("data-theme", next);
  }, [theme, resolved]);

  const setTheme = React.useCallback(
    (next: string | ((prev: string) => string)) => {
      setThemeState((prev) => {
        const val = typeof next === "function" ? next(prev) : next;
        try {
          localStorage.setItem(storageKey, val);
        } catch {}
        return val;
      });
    },
    [storageKey],
  );

  const providerValue = React.useMemo<UseThemeProps>(
    () => ({
      theme,
      setTheme,
      forcedTheme: undefined,
      resolvedTheme: theme,
      systemTheme: undefined,
      themes: ["light", "dark"],
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={providerValue}>{children}</ThemeContext.Provider>;
}
