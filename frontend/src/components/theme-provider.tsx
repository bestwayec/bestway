"use client";

import * as React from "react";

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
    themes: ["dark", "light"],
    setTheme: () => {},
    theme: "dark",
    resolvedTheme: "dark",
    systemTheme: "dark",
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
  storageKey = "theme",
  defaultTheme = "dark",
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<string>(defaultTheme);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark") {
        setThemeState(saved);
      }
    } catch {}
  }, [storageKey]);

  React.useEffect(() => {
    const el = document.documentElement;
    if (theme === "light") {
      el.classList.remove("dark");
      el.style.colorScheme = "light";
      el.setAttribute("data-theme", "light");
    } else {
      el.classList.add("dark");
      el.style.colorScheme = "dark";
      el.setAttribute("data-theme", "dark");
    }
  }, [theme]);

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
      systemTheme: "dark",
      themes: ["dark", "light"],
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={providerValue}>{children}</ThemeContext.Provider>;
}
