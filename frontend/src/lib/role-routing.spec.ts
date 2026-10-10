import { describe, expect, it } from "vitest";
import { homePathForRole } from "./role-routing";
import { isActive, mobileNavForRole, navForRole } from "./nav";
import type { Role } from "./types";

const roles: Role[] = ["super_admin", "admin", "teacher", "student", "parent"];

describe("role home navigation", () => {
  it.each(roles)("keeps %s desktop/mobile features reachable", (role) => {
    const home = role === "super_admin" ? "/super-admin" : "/dashboard";
    expect(homePathForRole(role)).toBe(home);
    const desktop = navForRole(role);
    const mobile = mobileNavForRole(role);
    expect(desktop.find((item) => item.key === "dashboard")?.href).toBe(home);
    expect(mobile[0].href).toBe(home);
    expect(mobile).toHaveLength(role === "parent" || role === "student" ? 2 : 4);
    expect(desktop.every((item) => item.roles.includes(role))).toBe(true);
    expect(desktop.filter((item) => item.key === "dashboard")).toHaveLength(1);
  });

  it("keeps all super-admin sections and exact dashboard selection", () => {
    expect(navForRole("super_admin").map((item) => item.href)).toEqual([
      "/super-admin", "/attendance", "/payments", "/students", "/groups", "/staff",
      "/mock", "/exam-builder", "/videos", "/articles", "/gallery", "/notifications", "/settings", "/audit",
    ]);
    expect(isActive("/super-admin", "/super-admin")).toBe(true);
    expect(isActive("/super-admin/other", "/super-admin")).toBe(false);
    expect(isActive("/dashboard", "/super-admin")).toBe(false);
  });
});
