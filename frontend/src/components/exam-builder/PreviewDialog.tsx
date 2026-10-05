"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { useMockPreview } from "@/hooks/use-mock";
import type { MockSkill } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StudentPreview } from "./StudentPreview";
import { ReadingPreviewShell } from "./reading-preview-shell";
import { toPreviewGroup, type PreviewGroupSource } from "./preview-group";
import { tx } from "./types";

interface PreviewSection {
  id: string;
  skill: MockSkill;
  title?: string | null;
  instructions?: string | null;
  groups?: PreviewGroupSource[];
}

/** Whole-exam student preview (sanitized, no keys) — no publish needed to look.
 *  Closing returns to the exact builder location (selection state is untouched).
 *  Reading sections render as a full-screen exam workspace; other skills keep
 *  the stacked inline student view. Answers stay local and are never saved. */
export function PreviewDialog({ examId, onClose }: { examId: string; onClose: () => void }) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const q = useMockPreview(examId, true);
  const data = q.data as unknown as { title?: string; sections?: PreviewSection[] } | undefined;
  const sections = data?.sections ?? [];
  const [activeSection, setActiveSection] = React.useState(0);
  const clampedSection = Math.min(activeSection, Math.max(0, sections.length - 1));
  const section = sections[clampedSection];
  const sectionGroups = React.useMemo(() => (section?.groups ?? []).map(toPreviewGroup), [section]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose fullscreen className="flex flex-col p-0">
        <DialogTitle className="sr-only">
          {tx(t, "preview", "Preview")}: {data?.title ?? ""}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Student preview — answers stay in this preview and are not saved.
        </DialogDescription>

        {/* Compact unobtrusive close */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          autoFocus
          aria-label={tx(t, "backToEditing", "Back to editing")}
          className="absolute right-3 top-3 z-10 size-8 rounded-[6px] border border-border bg-bg/80 text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <X aria-hidden />
        </Button>

        {/* Slim section switcher — only when the exam really has several sections */}
        {!q.isLoading && !q.isError && sections.length > 1 && (
          <div
            className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2 pr-14"
            role="tablist"
            aria-label="Preview sections"
          >
            {sections.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === clampedSection}
                onClick={() => setActiveSection(i)}
                className={cn(
                  "h-8 shrink-0 rounded-[6px] border px-2.5 text-xs font-medium capitalize transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  i === clampedSection
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-transparent text-fg-muted hover:text-fg",
                )}
              >
                {s.title?.trim() || s.skill}
              </button>
            ))}
          </div>
        )}

        {/* Workspace */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {q.isLoading && (
            <div
              className="space-y-2 overflow-y-auto px-5 py-4 md:px-8"
              role="status"
              aria-label={tx(t, "loadingPreview", "Loading preview")}
            >
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          )}
          {q.isError && (
            <div className="overflow-y-auto px-5 py-4 md:px-8">
              <ErrorState
                title={tx(t, "previewFailed", "Preview failed to load.")}
                action={
                  <Button variant="outline" size="sm" onClick={() => q.refetch()}>
                    {tc("retry")}
                  </Button>
                }
              />
            </div>
          )}
          {!q.isLoading && !q.isError && sections.length === 0 && (
            <p className="px-5 py-4 text-sm text-fg-muted md:px-8">
              {tx(t, "previewEmpty", "Nothing to preview yet — add sections and questions first.")}
            </p>
          )}
          {!q.isLoading && !q.isError && sections.length > 0 && section && (
            section.skill === "reading" ? (
              <div key={section.id} className="min-h-0 flex-1">
                <ReadingPreviewShell groups={sectionGroups} />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
                <section key={section.id} aria-label={section.title?.trim() || section.skill}>
                  <h3 className="mb-1 text-sm font-bold capitalize text-fg">
                    {section.title?.trim() || section.skill}
                  </h3>
                  {section.instructions?.trim() && (
                    <p className="mb-2 text-sm text-fg-muted">{section.instructions}</p>
                  )}
                  <div className="space-y-3 pb-2">
                    {sectionGroups.map((pg) => (
                      <StudentPreview
                        key={pg.id}
                        group={pg}
                        skill={section.skill}
                        variant="inline"
                      />
                    ))}
                  </div>
                </section>
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
