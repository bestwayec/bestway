import { describe, expect, it } from "vitest";
import { encodeCsv } from "./csv-export";

describe("Excel CSV export", () => {
  it("retains Unicode, literal delimiters, quotes, multiline text, nulls and real zero", () => {
    expect(encodeCsv([["O‘quvchi; ism", 'He said "yes"', "line one\nline two", null, 0]]))
      .toBe('\uFEFF"O‘quvchi; ism";"He said ""yes""";"line one\nline two";"";"0"\r\n');
  });
  it("neutralizes spreadsheet formula prefixes even after whitespace or controls", () => {
    for (const value of ["=HYPERLINK(\"https://example.org\")", "+cmd", "-cmd", "@SUM(1)", "  =1+1", "\t=1", "\rname", "\nname", "\uFEFF=1"]) {
      expect(encodeCsv([[value]])).toContain('"\'');
    }
    expect(encodeCsv([["Komiljon", 35, false]])).toBe('\uFEFF"Komiljon";"35";"false"\r\n');
  });
});
