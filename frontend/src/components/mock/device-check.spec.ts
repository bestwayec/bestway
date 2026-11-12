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
vi.mock("@/lib/api-client", () => ({ api: { get: (...args: unknown[]) => apiGet(...args) } }));
const requestStream = vi.fn();
vi.mock("@/lib/microphone", async (orig) => ({ ...(await orig<typeof import("@/lib/microphone")>()), assertMicrophoneAvailable: () => undefined, requestMicrophoneStream: () => requestStream() }));

import { DeviceCheck } from "./device-check";

class FakeAudioContext {
  static level = 128;
  destination = {};
  createOscillator() { return { frequency: { value: 0 }, connect: (n: unknown) => n, start() {}, stop() {} }; }
  createGain() { return { gain: { value: 0 }, connect: (n: unknown) => n }; }
  createAnalyser() { return { fftSize: 0, getByteTimeDomainData: (b: Uint8Array) => b.fill(FakeAudioContext.level) }; }
  createMediaStreamSource() { return { connect: () => undefined }; }
  close() { return Promise.resolve(); }
}

let host: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const click = (label: string) => act(async () => {
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!.click();
});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
  Object.assign(window, { AudioContext: FakeAudioContext, isSecureContext: true });
  Object.assign(globalThis, { MediaRecorder: class {} });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn() }, configurable: true });
  apiGet.mockReset().mockResolvedValue({ status: "ok" });
  requestStream.mockReset().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function runChecks() {
  await click("Check my device");
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
}

describe("DeviceCheck", () => {
  it("shows nothing measured until the student runs it", async () => {
    await act(async () => root.render(React.createElement(DeviceCheck, { needsMicrophone: true })));
    expect(text()).toContain("Check my device");
    expect(text()).not.toContain("Connected");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("reports the measured connection and the student's own sound answer", async () => {
    await act(async () => root.render(React.createElement(DeviceCheck, { needsMicrophone: false })));
    await runChecks();
    expect(apiGet).toHaveBeenCalledWith("/health");
    expect(text()).toMatch(/Connected · server replied in \d+ ms/);
    expect(text()).toContain("Did you hear it?");
    expect(text()).not.toContain("Microphone");
    await click("Yes, I heard it");
    expect(text()).toContain("You confirmed you heard the test tone.");
  });

  it("says when the server does not reply", async () => {
    apiGet.mockRejectedValue(new Error("down"));
    await act(async () => root.render(React.createElement(DeviceCheck, { needsMicrophone: false })));
    await runChecks();
    expect(text()).toContain("The server did not reply.");
  });

  it("tells silence from a voice on the microphone", async () => {
    await act(async () => root.render(React.createElement(DeviceCheck, { needsMicrophone: true })));
    await runChecks();
    FakeAudioContext.level = 128;
    await click("Test the microphone");
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(text()).toContain("heard almost nothing");
    FakeAudioContext.level = 200;
    await click("Test again");
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(text()).toContain("Your voice was picked up.");
  });
});
