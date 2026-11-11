import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "./routing";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(full, value);
    else for (const [k, v] of leaves(value, full)) out.set(k, v);
  }
  return out;
}

const load = (locale: string) =>
  leaves(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../messages", `${locale}.json`), "utf8")) as Tree);

describe("i18n messages", () => {
  const byLocale = Object.fromEntries(locales.map((l) => [l, load(l)]));

  it("every locale has exactly the same keys", () => {
    const [first, ...rest] = locales;
    for (const other of rest) {
      const a = [...byLocale[first].keys()].filter((k) => !byLocale[other].has(k));
      const b = [...byLocale[other].keys()].filter((k) => !byLocale[first].has(k));
      expect({ [`missing in ${other}`]: a, [`missing in ${first}`]: b }).toEqual({ [`missing in ${other}`]: [], [`missing in ${first}`]: [] });
    }
  });

  it("no message is empty", () => {
    for (const locale of locales) {
      const empty = [...byLocale[locale].entries()].filter(([, v]) => v.trim() === "").map(([k]) => k);
      expect({ locale, empty }).toEqual({ locale, empty: [] });
    }
  });

  it("placeholders match across locales", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort().join(",");
    const [first, ...rest] = locales;
    const mismatched: string[] = [];
    for (const [key, value] of byLocale[first]) {
      for (const other of rest) {
        const v = byLocale[other].get(key);
        if (v !== undefined && vars(v) !== vars(value)) mismatched.push(`${other}:${key}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});
