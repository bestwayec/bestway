"use client";

import * as React from "react";
import { StickyNote, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { CbtStickyNote } from "./cbt-annotated-text";

/**
 * The attempt's notes in one list. Deleting asks first (inline, keyboard reachable);
 * the runner keeps the notes with the attempt on the server.
 */
export function ExamNotesPanel({
  notes,
  onDelete,
  onClose,
}: {
  notes: CbtStickyNote[];
  onDelete: (note: CbtStickyNote) => void;
  onClose: () => void;
}) {
  const t = useTranslations("mock.runnerUx");
  const [confirming, setConfirming] = React.useState<string | null>(null);
  return (
    <section aria-labelledby="exam-notes-title" className="mb-4 rounded-[10px] border border-border bg-surface p-4" data-testid="exam-notes-panel">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="exam-notes-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
          <StickyNote className="size-4 text-warning" aria-hidden />
          {t("notesTitle", { count: notes.length })}
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("notesClose")} className="min-h-[44px]">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("notesEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={`${note.storageKey ?? ""}:${note.id}`} className="rounded-[8px] border border-border bg-bg-subtle p-3 text-sm">
              <p className="text-xs text-fg-muted">&ldquo;{note.quote}&rdquo;</p>
              <p className="mt-1 whitespace-pre-wrap text-fg">{note.text}</p>
              {confirming === note.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={t("noteDeleteConfirm")}>
                  <span className="text-xs font-medium text-fg">{t("noteDeleteConfirm")}</span>
                  <Button size="sm" variant="danger" className="min-h-[44px]" onClick={() => { onDelete(note); setConfirming(null); }}>
                    {t("noteDeleteYes")}
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setConfirming(null)}>
                    {t("noteDeleteNo")}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="mt-1 min-h-[44px] text-danger" onClick={() => setConfirming(note.id)}>
                  <Trash2 className="size-4" aria-hidden />
                  {t("noteDelete")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
