import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEME_INIT_SCRIPT, resolveStoredTheme } from "./theme-init";

function runScript(stored: string | null, initialDark = false) {
  const classes = new Set<string>(initialDark ? ["dark"] : []);
  const attrs: Record<string, string> = {};
  const el = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    style: { colorScheme: "" },
    setAttribute: (k: string, v: string) => (attrs[k] = v),
  };
  const localStorage = { getItem: () => stored };
  new Function("document", "localStorage", THEME_INIT_SCRIPT)({ documentElement: el }, localStorage);
  return { dark: classes.has("dark"), scheme: el.style.colorScheme, attr: attrs["data-theme"] };
}

describe("theme bootstrap", () => {
  it("defaults to light", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(resolveStoredTheme(null)).toBe("light");
    expect(resolveStoredTheme("system")).toBe("light");
    expect(runScript(null)).toEqual({ dark: false, scheme: "light", attr: "light" });
  });

  it("applies a remembered dark choice before paint", () => {
    expect(resolveStoredTheme("dark")).toBe("dark");
    expect(runScript("dark")).toEqual({ dark: true, scheme: "dark", attr: "dark" });
  });

  it("removes a stale dark class for light users", () => {
    expect(runScript("light", true)).toEqual({ dark: false, scheme: "light", attr: "light" });
  });

  it("never throws when storage is blocked", () => {
    expect(() => new Function("document", "localStorage", THEME_INIT_SCRIPT)({ documentElement: {} }, { getItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
