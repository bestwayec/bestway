import { describe, expect, it } from "vitest";
import { applyClientIp, forwardedForHeaders, trustedClientIp } from "./client-ip";

describe("client IP forwarding", () => {
  it("trusts only a valid CF-Connecting-IP", () => {
    expect(trustedClientIp(new Headers({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(trustedClientIp(new Headers({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(trustedClientIp(new Headers({ "cf-connecting-ip": "not-an-ip" }))).toBeNull();
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "198.51.100.1" }))).toBeNull();
  });

  it("replaces client-supplied forwarding headers with exactly one trusted hop", () => {
    const target = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-real-ip": "1.2.3.4", forwarded: "for=1.2.3.4" });
    applyClientIp(target, new Headers({ "cf-connecting-ip": "203.0.113.7" }));
    expect(target.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(target.get("x-real-ip")).toBeNull();
    expect(target.get("forwarded")).toBeNull();
  });

  it("drops spoofed headers and adds nothing when no trusted address exists (local dev)", () => {
    const target = new Headers({ "x-forwarded-for": "1.2.3.4" });
    applyClientIp(target, new Headers());
    expect(target.has("x-forwarded-for")).toBe(false);
    expect(forwardedForHeaders(new Headers())).toEqual({});
  });
});
