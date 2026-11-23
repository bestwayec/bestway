import type { ExamLifecycle } from "@/lib/types";

/** The lifecycle the server reports; older responses without it fall back to isPublished. */
export function lifecycleOf(exam: { lifecycle?: ExamLifecycle | null; isPublished: boolean }): ExamLifecycle {
  return exam.lifecycle ?? (exam.isPublished ? "published" : "draft");
}

export type LifecycleTab = "all" | "drafts" | "validated" | "published" | "archived";

/** "All" hides archived exams (they have their own tab); "Drafts" includes validated drafts. */
export function inLifecycleTab(state: ExamLifecycle, tab: LifecycleTab): boolean {
  if (tab === "all") return state !== "archived";
  if (tab === "drafts") return state === "draft" || state === "validated";
  return state === tab;
}

export const LIFECYCLE_BADGE: Record<ExamLifecycle, { variant: "warning" | "info" | "success" | "neutral"; key: string; fallback: string }> = {
  draft: { variant: "warning", key: "draft", fallback: "Draft" },
  validated: { variant: "info", key: "lifecycleValidated", fallback: "Validated" },
  published: { variant: "success", key: "published", fallback: "Published" },
  archived: { variant: "neutral", key: "lifecycleArchived", fallback: "Archived" },
};

/** Which lifecycle actions make sense now (the server enforces every rule again). */
export function lifecycleActions(state: ExamLifecycle) {
  return {
    canValidate: state === "draft" || state === "validated",
    canArchive: state !== "archived",
    canRestore: state === "archived",
    canTogglePublish: state !== "archived",
    canEditContent: state === "draft" || state === "validated",
  };
}
