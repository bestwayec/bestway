import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard (5.1 stabilization). Next 16.4.6 builds the proxy (middleware) URL through NextURL, which
 * rewrites a loopback IP host (127.x, ::1) to "localhost", while the router resolves proxy rewrites against the
 * hostname the server was bound to. Bound to 127.0.0.1, next-intl's internal default-locale rewrite
 * (/login -> /uz/login) then has a different origin, is proxied as an external URL and comes back as a 307 to
 * the same address (or a 500 behind an HTTPS proxy). Every unprefixed Uzbek page breaks. Start Next with no
 * hostname, 0.0.0.0 or localhost — never a loopback IP literal.
 */
const repo = join(__dirname, "..", "..", "..");
const LOOPBACK_BIND = /(?:-H|--hostname)[\s=]+["']?(?:127\.\d+\.\d+\.\d+|\[?::1\]?)\b|HOSTNAME\s*[:=]\s*["']?(?:127\.|::1)/;
const STARTUP_FILES = [
  "frontend/package.json",
  "frontend/Dockerfile",
  "docker-compose.yml",
  "docker-compose.prod.yml",
  "scripts/local-start.ps1",
  "scripts/local-common.ps1",
];

describe("Next.js startup hostname", () => {
  it.each(STARTUP_FILES)("%s never binds Next to a loopback IP literal", (file) => {
    const text = readFileSync(join(repo, file), "utf8");
    const offending = text.split("\n").filter((line) => /next|HOSTNAME|NextBin/i.test(line) && LOOPBACK_BIND.test(line));
    expect(offending).toEqual([]);
  });

  it("detects the bindings that break the Uzbek rewrite", () => {
    expect(LOOPBACK_BIND.test("next dev -p 3300 -H 127.0.0.1")).toBe(true);
    expect(LOOPBACK_BIND.test("next start --hostname ::1")).toBe(true);
    expect(LOOPBACK_BIND.test("HOSTNAME: 127.0.0.1")).toBe(true);
    expect(LOOPBACK_BIND.test("next start -H 0.0.0.0")).toBe(false);
    expect(LOOPBACK_BIND.test("next dev -p 3300 -H localhost")).toBe(false);
    expect(LOOPBACK_BIND.test("HOSTNAME: 0.0.0.0")).toBe(false);
  });
});

describe("locale cookie", () => {
  it("is always written for the whole site, so switching from /en/... to Uzbek sticks", async () => {
    const { routing } = await import("./routing");
    expect(routing.localeCookie).toMatchObject({ name: "NEXT_LOCALE", path: "/", sameSite: "lax" });
  });
});

