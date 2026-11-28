// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const en = (await import("../../../messages/en.json")).default as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), en);
  return { useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    const found = lookup(`${ns}.${key}`);
    return typeof found === "string" ? found.replace(/\{(\w+)\}/g, (_, n: string) => String(values?.[n] ?? "")) : key;
  } };
});
const apiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({ api: { get: (...args: unknown[]) => apiGet(...args) }, ApiError: class extends Error {} }));

import { summarizeNetwork, browserSupport } from "@/lib/device-check";
import { saveLabelKey, useCalmSaveState } from "./mock-runner";
import { DeviceCheck } from "./device-check";
import { ExamReadinessDialog } from "./exam-readiness-dialog";

let host: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  apiGet.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("readiness helpers", () => {
  it("summarises several health requests instead of trusting one", () => {
    expect(summarizeNetwork([100, 300, 200])).toEqual({ replied: 3, medianMs: 200 });
    expect(summarizeNetwork([100, null, 300])).toEqual({ replied: 2, medianMs: 200 });
    expect(summarizeNetwork([null, null]).replied).toBe(0);
  });
  it("reports recording support only when Speaking needs it", () => {
    expect("recording" in browserSupport(false)).toBe(false);
    expect("recording" in browserSupport(true)).toBe(true);
    expect(browserSupport(false).storage).toBe(true);
  });
});

describe("save status", () => {
  it("labels offline edits by where they are kept, and the hand-in states", () => {
    expect(saveLabelKey("offline", false)).toBe("saveOfflineKept");
    expect(saveLabelKey("offline", true)).toBe("saveOffline");
    expect(saveLabelKey("submitting", false)).toBe("saveSubmitting");
    expect(saveLabelKey("locked", false)).toBe("saveLocked");
    expect(saveLabelKey("saved", false)).toBe("saveSaved");
  });

  it("does not flash 'saving' for quick saves but shows other states at once", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    function Probe({ state }: { state: Parameters<typeof useCalmSaveState>[0] }) {
      const shown = useCalmSaveState(state);
      seen.push(shown);
      return null;
    }
    await act(async () => root.render(React.createElement(Probe, { state: "queued" })));
    await act(async () => root.render(React.createElement(Probe, { state: "saving" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => root.render(React.createElement(Probe, { state: "saved" })));
    expect(seen).not.toContain("saving");
    expect(seen.at(-1)).toBe("saved");
    await act(async () => root.render(React.createElement(Probe, { state: "retrying" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(seen.at(-1)).toBe("retrying");
  });
});

describe("DeviceCheck readiness rows", () => {
  it("marks required checks, warns on an unstable connection and confirms the sign-in", async () => {
    let call = 0;
    apiGet.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve({});
      call += 1;
      return call === 2 ? Promise.reject(new Error("drop")) : Promise.resolve({ status: "ok" });
    });
    Object.assign(window, { AudioContext: undefined });
    await act(async () => root.render(React.createElement(DeviceCheck, { needsMicrophone: false, checkSession: true })));
    await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Check my device"))!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(apiGet).toHaveBeenCalledWith("/auth/me");
    expect(text()).toContain("replied to 2 of 3 requests");
    expect(text()).toContain("You are signed in.");
    expect(text()).toContain("Required");
    expect(text()).toContain("Recommended");
    expect(text()).toContain("cannot guarantee");
  });
});

describe("ExamReadinessDialog", () => {
  it("shows the assignment window and blocks Start when the assignment has closed", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/student/assignments/")
      ? Promise.reject(Object.assign(new Error("closed"), { code: "ASSIGNMENT_EXPIRED" }))
      : Promise.resolve({}));
    const onStart = vi.fn();
    await act(async () => root.render(React.createElement(ExamReadinessDialog, {
      open: true, onOpenChange: () => undefined, title: "Mock 1", examType: "ielts", skills: ["listening", "reading"],
      questionCount: 80, durationMinutes: 100, assignmentId: "as1", onStart,
    })));
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("This assignment has closed.");
    const start = document.querySelector<HTMLButtonElement>("[data-testid=readiness-start]")!;
    expect(start.disabled).toBe(true);
    expect(text()).toContain("Listening recordings play by the exam schedule");
    expect(text()).not.toContain("Speaking answers are recorded");
  });

  it("shows the fixed closing time from the server and starts only on Start", async () => {
    apiGet.mockImplementation((path: string) => path.startsWith("/student/assignments/")
      ? Promise.resolve({ id: "e1", type: "ielts", timingPolicy: "fixed_close", deadline: "2026-11-28T10:00:00Z", opensAt: null })
      : Promise.resolve({}));
    const onStart = vi.fn();
    await act(async () => root.render(React.createElement(ExamReadinessDialog, {
      open: true, onOpenChange: () => undefined, title: "Mock 1", examType: "ielts", skills: ["speaking"],
      assignmentId: "as1", onStart,
    })));
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain("Fixed closing time");
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-testid=readiness-start]")!.click(); });
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
