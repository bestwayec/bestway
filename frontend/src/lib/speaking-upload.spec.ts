import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { UPLOAD_RETRY_DELAYS_MS, uploadFailurePlan } from "./speaking-upload";

describe("speaking upload failures", () => {
  it("retries a lost connection, a server error and a window still open on the server clock", () => {
    expect(uploadFailurePlan(new TypeError("Failed to fetch"), 0)).toEqual({ kind: "transient", delayMs: 2000 });
    expect(uploadFailurePlan(new ApiError("INTERNAL", "x", 502), 1)).toEqual({ kind: "transient", delayMs: 4000 });
    expect(uploadFailurePlan(new ApiError("SPEAKING_RESPONSE_ACTIVE", "x", 400), 2).kind).toBe("transient");
    expect(uploadFailurePlan(new ApiError("RATE_LIMITED", "x", 429), 0).kind).toBe("transient");
  });
  it("stops retrying by itself after the last delay (the take is still kept)", () => {
    expect(uploadFailurePlan(new TypeError("offline"), UPLOAD_RETRY_DELAYS_MS.length)).toEqual({ kind: "final", code: null });
  });
  it("does not loop on answers the server will repeat", () => {
    expect(uploadFailurePlan(new ApiError("SPEAKING_AUDIO_DURATION_INVALID", "x", 400), 0)).toEqual({ kind: "final", code: "SPEAKING_AUDIO_DURATION_INVALID" });
    expect(uploadFailurePlan(new ApiError("UPLOAD_WINDOW_EXPIRED", "x", 400), 0)).toEqual({ kind: "final", code: "UPLOAD_WINDOW_EXPIRED" });
  });
});
