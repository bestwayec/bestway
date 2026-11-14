// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const en = (await import("../../../messages/en.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), en);
  return {
    useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
      const found = lookup(`${ns}.${key}`);
      return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
    },
  };
});

import { api, EXAM_SESSION_ELSEWHERE_EVENT } from "@/lib/api-client";
import { EXAM_SESSION_HEARTBEAT_MS, ExamSessionGate, useExamSession } from "./exam-session-gate";

type Fetch = ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;
let fetchMock: Fetch;
let holder = "";          // the session the fake server says holds the attempt
const onRegained = vi.fn();

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function serverFetch(url: string, init?: RequestInit) {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.endsWith("/session")) {
    if (!holder || body.takeover || holder === body.sessionId) { holder = body.sessionId; return respond(200, { success: true, data: { active: true } }); }
    return respond(409, { success: false, error: { code: "EXAM_SESSION_ELSEWHERE", message: "elsewhere", details: { claimedAt: Date.parse("2026-11-13T09:30:00Z") } } });
  }
  if (url.endsWith("/session/release")) return respond(200, { success: true, data: { released: true } });
  const session = (init?.headers as Record<string, string> | undefined)?.["x-exam-session"];
  if (session && session !== holder) return respond(409, { success: false, error: { code: "EXAM_SESSION_ELSEWHERE", message: "elsewhere" } });
  return respond(201, { success: true, data: { saved: 1, session } });
}

function Harness() {
  const session = useExamSession("att-1", true, onRegained);
  return React.createElement(React.Fragment, null,
    React.createElement("span", { "data-testid": "status" }, session.state.status),
    session.state.status === "elsewhere" ? React.createElement(ExamSessionGate, { claimedAt: session.state.claimedAt, onTakeOver: session.takeOver }) : null);
}

const status = () => host.querySelector('[data-testid="status"]')?.textContent;
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  holder = "";
  onRegained.mockReset();
  window.sessionStorage.clear();
  fetchMock = vi.fn(serverFetch);
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("one active exam session per attempt", () => {
  it("claims the attempt and sends its session id with every change, keeping it across a reload", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    await settle();
    expect(status()).toBe("active");
    const saved = await api.post<{ session: string }>("/mock/attempts/att-1/answers", { answers: [] });
    expect(saved.session).toBe(holder);
    expect(holder).toMatch(/^tab-/);
    expect(window.sessionStorage.getItem("bw_exam_session_att-1")).toBe(holder);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/mock/attempts/att-1/session") && (init as RequestInit).headers && "x-exam-session" in ((init as RequestInit).headers as object))).toBe(false);
  });

  it("shows the gate with the time when another tab holds the attempt, and 'Continue here' takes it over", async () => {
    holder = "tab-other-device";
    await act(async () => root.render(React.createElement(Harness)));
    await settle();
    const gate = document.querySelector('[data-testid="exam-session-elsewhere"]');
    expect(status()).toBe("elsewhere");
    expect(gate?.getAttribute("role")).toBe("alertdialog");
    expect(gate?.textContent).toContain("This exam is open somewhere else");
    expect(gate?.textContent).toContain("kept on this device");
    expect(gate?.textContent).toMatch(/at \d{2}:\d{2}\./);
    expect(document.activeElement?.textContent).toBe("Continue here");
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    await settle();
    expect(status()).toBe("active");
    expect(holder).toBe(window.sessionStorage.getItem("bw_exam_session_att-1"));
    expect(onRegained).toHaveBeenCalledTimes(1);
  });

  it("a refused save from this tab after a takeover elsewhere shows the gate", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    await settle();
    holder = "tab-taken-over";
    await act(async () => { await api.post("/mock/attempts/att-1/answers", { answers: [] }).catch(() => undefined); });
    await settle();
    expect(status()).toBe("elsewhere");
  });

  it("the heartbeat finds the takeover too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => root.render(React.createElement(Harness)));
    await settle();
    holder = "tab-taken-over";
    await act(async () => { vi.advanceTimersByTime(EXAM_SESSION_HEARTBEAT_MS + 10); });
    await settle();
    expect(status()).toBe("elsewhere");
  });

  it("never blocks the student when the server cannot be reached", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    await act(async () => root.render(React.createElement(Harness)));
    await settle();
    expect(status()).toBe("active");
  });

  it("ignores an elsewhere event of another attempt", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    await settle();
    await act(async () => { window.dispatchEvent(new CustomEvent(EXAM_SESSION_ELSEWHERE_EVENT, { detail: { attemptId: "att-2" } })); });
    expect(status()).toBe("active");
  });
});
