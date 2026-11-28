// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canReuseMicReady, forgetMicReady, MIC_READY_TTL_MS, micReadyDecision, rememberMicReady, storedMicReady } from "./mic-readiness";

function permission(state: string | null) {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: state === null ? undefined : { query: vi.fn().mockResolvedValue({ state }) },
  });
}

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("mic readiness reuse", () => {
  it("reuses a passed check only while the browser still grants the microphone", async () => {
    rememberMicReady("a1");
    permission("granted");
    expect(await canReuseMicReady("a1")).toBe(true);
    permission("prompt");
    expect(await canReuseMicReady("a1")).toBe(false);
    permission(null);
    expect(await canReuseMicReady("a1")).toBe(false);
  });

  it("forgets the record when the permission was revoked", async () => {
    rememberMicReady("a2");
    permission("denied");
    expect(await canReuseMicReady("a2")).toBe(false);
    expect(storedMicReady("a2")).toBeNull();
  });

  it("expires, is per attempt and per browser", () => {
    const now = Date.now();
    rememberMicReady("a3", now);
    expect(storedMicReady("a3", now + MIC_READY_TTL_MS - 1)).not.toBeNull();
    expect(storedMicReady("a3", now + MIC_READY_TTL_MS + 1)).toBeNull();
    expect(storedMicReady("other", now)).toBeNull();
    localStorage.setItem("bw_mic_ready_a4", JSON.stringify({ at: now, ua: "another browser" }));
    expect(storedMicReady("a4", now)).toBeNull();
    forgetMicReady("a3");
    expect(storedMicReady("a3", now)).toBeNull();
  });

  it("decides", () => {
    expect(micReadyDecision(true, "granted")).toBe("reuse");
    expect(micReadyDecision(false, "granted")).toBe("check");
    expect(micReadyDecision(true, "unknown")).toBe("check");
  });
});
