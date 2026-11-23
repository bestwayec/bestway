import { describe, expect, it } from "vitest";
import { inLifecycleTab, lifecycleActions, lifecycleOf } from "./lifecycle";

describe("exam lifecycle helpers", () => {
  it("falls back to isPublished for responses without lifecycle", () => {
    expect(lifecycleOf({ isPublished: true })).toBe("published");
    expect(lifecycleOf({ isPublished: false })).toBe("draft");
    expect(lifecycleOf({ isPublished: false, lifecycle: "archived" })).toBe("archived");
  });

  it("keeps archived exams out of All and validated drafts in Drafts", () => {
    expect(inLifecycleTab("archived", "all")).toBe(false);
    expect(inLifecycleTab("archived", "archived")).toBe(true);
    expect(inLifecycleTab("validated", "drafts")).toBe(true);
    expect(inLifecycleTab("validated", "validated")).toBe(true);
    expect(inLifecycleTab("published", "drafts")).toBe(false);
  });

  it("offers only actions valid for the state", () => {
    expect(lifecycleActions("archived")).toMatchObject({ canRestore: true, canArchive: false, canTogglePublish: false, canEditContent: false });
    expect(lifecycleActions("published")).toMatchObject({ canValidate: false, canArchive: true, canEditContent: false });
    expect(lifecycleActions("draft")).toMatchObject({ canValidate: true, canRestore: false, canEditContent: true });
  });
});
