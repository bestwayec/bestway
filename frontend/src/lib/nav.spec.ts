import { describe, expect, it } from "vitest";
import { NAV_SECTION_ORDER, groupedNavForRole, isActive, navForRole } from "./nav";
import type { Role } from "./types";

const ROLES: Role[] = ["super_admin", "admin", "teacher", "student", "parent"];

describe("groupedNavForRole", () => {
  it.each(ROLES)("%s: every authorised route appears exactly once and nothing extra", (role) => {
    const expected = navForRole(role).filter((i) => i.key !== "notifications").map((i) => i.href).sort();
    const grouped = groupedNavForRole(role);
    const actual = [...grouped.top, ...grouped.sections.flatMap((s) => s.items)].map((i) => i.href).sort();
    expect(actual).toEqual(expected);
  });

  it("keeps the section order and hides empty sections", () => {
    const sections = groupedNavForRole("teacher").sections.map((s) => s.id);
    expect(sections).toEqual(NAV_SECTION_ORDER.filter((id) => sections.includes(id)));
    expect(sections).not.toContain("settings");
  });

  it("super admin sees all five sections with the 14+ office items grouped", () => {
    const grouped = groupedNavForRole("super_admin");
    expect(grouped.sections.map((s) => s.id)).toEqual(["learning", "exams", "users", "reports", "settings"]);
    expect(grouped.sections.find((s) => s.id === "reports")?.items.map((i) => i.key)).toEqual(["attendance", "payments", "audit"]);
    expect(grouped.sections.find((s) => s.id === "settings")?.items.map((i) => i.key)).toEqual(["settings"]);
  });

  it("admin does not get super-admin-only routes", () => {
    const hrefs = groupedNavForRole("admin").sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/audit");
    expect(hrefs).toContain("/exam-builder");
  });

  it("student has no staff routes", () => {
    const hrefs = groupedNavForRole("student").sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/exam-builder");
    expect(hrefs).not.toContain("/students");
  });

  it("active matching is by path prefix", () => {
    expect(isActive("/exam-builder/abc", "/exam-builder")).toBe(true);
    expect(isActive("/dashboard/x", "/dashboard")).toBe(false);
  });
});
