// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const uz = (await import("../../../messages/uz.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), uz);
  return { useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const found = lookup(`${ns}.${key}`);
    return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
  } };
});
vi.mock("@/i18n/navigation", () => ({ Link: (p: { href: string; children: React.ReactNode }) => React.createElement("a", { href: p.href }, p.children) }));

import DemoRunner, { type DemoQuestion } from "./demo-runner";

const QUESTIONS: DemoQuestion[] = [
  { id: "q1", section: "reading", type: "multiple_choice", prompt: "Sky colour?", options: ["green", "blue"], maxScore: 1 },
  { id: "q2", section: "writing", type: "essay", prompt: "Write about your town.", options: null, maxScore: 1 },
];

describe("DemoRunner", () => {
  let host: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();
  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", () => true);
    fetchMock.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(React.createElement(DemoRunner, { testId: "demo-1", title: "Demo", durationMinutes: null, questions: QUESTIONS })));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const submit = async () => {
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Yakunlash") || b.textContent?.includes("Topshirish") || b.querySelector("svg")) as HTMLButtonElement;
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  };

  it("sends the answers to the server and shows only the server's auto-checked score", async () => {
    await act(async () => { (host.querySelector('input[type="radio"]:nth-of-type(1)') as HTMLInputElement | null)?.click(); });
    const blue = [...host.querySelectorAll("label")].find((l) => l.textContent?.includes("blue"))!.querySelector("input") as HTMLInputElement;
    await act(async () => { blue.click(); });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: {
      autoScore: 1, autoMax: 1,
      perQuestion: [{ questionId: "q1", isCorrect: true, isGraded: true }, { questionId: "q2", isCorrect: null, isGraded: false }],
      bySection: [{ section: "reading", score: 1, max: 1 }, { section: "writing", score: 0, max: 1 }],
    } }) });
    await submit();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/tests/demo/demo-1/submit", expect.objectContaining({ method: "POST", body: JSON.stringify({ answers: { q1: "blue" } }) }));
    const text = host.textContent ?? "";
    expect(text).toContain("100%");
    expect(text).not.toMatch(/0\s*\/\s*1/);
    expect(text).toContain("O'qituvchi tekshiradi, avtomatik emas");
  });

  it("shows no score when the server could not check the answers", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await submit();
    expect(host.querySelector('[data-testid="demo-result"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("submits to the server when the time is up", async () => {
    await act(async () => root.unmount());
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { autoScore: 0, autoMax: 1, perQuestion: [], bySection: [] } }) });
    root = createRoot(host);
    await act(async () => root.render(React.createElement(DemoRunner, { testId: "demo-1", title: "Demo", durationMinutes: 1, questions: QUESTIONS })));
    expect(host.textContent).toContain("01:00");
    for (let i = 0; i < 60; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    vi.useRealTimers();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/tests/demo/demo-1/submit");
  });
});
