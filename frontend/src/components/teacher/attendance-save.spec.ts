import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ put: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...original, api: { put: calls.put, post: calls.post } };
});

import { ApiError } from "@/lib/api-client";
import { saveAttendance } from "./attendance-save";

const input = { groupId: "g", date: "2026-11-06", records: [{ studentId: "s", state: "present" as const }] };

describe("attendance save retry", () => {
  beforeEach(() => { calls.put.mockReset(); calls.post.mockReset(); });

  it("uses a single PUT when it succeeds", async () => {
    calls.put.mockResolvedValue({ updated: 1 });
    await saveAttendance(input);
    expect(calls.put).toHaveBeenCalledOnce();
    expect(calls.post).not.toHaveBeenCalled();
  });

  it.each([405, 501])("falls back only for unsupported method HTTP %s", async (status) => {
    calls.put.mockRejectedValue(new ApiError("METHOD", "unsupported", status));
    calls.post.mockResolvedValue({ updated: 1 });
    await saveAttendance(input);
    expect(calls.post).toHaveBeenCalledWith("/attendance/bulk", input);
  });

  it.each([new Error("network disconnected"), new ApiError("SERVER", "failed", 500),
           new ApiError("FORBIDDEN", "denied", 403)])("does not duplicate uncertain or forbidden saves", async (error) => {
    calls.put.mockRejectedValue(error);
    await expect(saveAttendance(input)).rejects.toBe(error);
    expect(calls.post).not.toHaveBeenCalled();
  });

  it("propagates a failed fallback", async () => {
    calls.put.mockRejectedValue(new ApiError("METHOD", "unsupported", 405));
    const error = new Error("offline");
    calls.post.mockRejectedValue(error);
    await expect(saveAttendance(input)).rejects.toBe(error);
  });
});
