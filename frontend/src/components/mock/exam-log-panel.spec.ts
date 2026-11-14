// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const en = (await import("../../../messages/en.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), en);
  return {
    useLocale: () => "en",
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = lookup(`${ns}.${key}`);
      return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
    },
  };
});
import { ExamLogPanel } from "./exam-log-panel";

describe("ExamLogPanel", () => {
  it("lists what was recorded, in plain words, with the time", () => {
    const html = renderToStaticMarkup(React.createElement(ExamLogPanel, { events: [
      { event: "exit_fullscreen", date: "2026-11-13T10:05:07Z" },
      { event: "paste_blocked", date: "2026-11-13T10:06:00Z" },
      { event: "something_new", date: "2026-11-13T10:07:00Z" },
    ] }));
    expect(html).toContain("Exam log (3)");
    expect(html).toContain("Left full screen");
    expect(html).toContain("Tried to paste text from outside (refused)");
    expect(html).toContain("Other event: something_new");
    expect(html).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
  it("says so when nothing was recorded", () => {
    expect(renderToStaticMarkup(React.createElement(ExamLogPanel, { events: [] }))).toContain("Nothing was recorded");
  });
});
