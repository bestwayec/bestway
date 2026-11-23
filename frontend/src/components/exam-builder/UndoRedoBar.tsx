"use client";

import * as React from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { tx } from "./types";
import { shortcutFor, type UndoableState } from "./undo-history";

/**
 * Undo / Redo for the open editor panel's unsaved changes. Keyboard: Ctrl/⌘+Z and
 * Ctrl/⌘+Shift+Z (or Ctrl+Y) when focus is not inside a text field — inside a field the
 * browser's own text undo keeps working.
 */
export function UndoRedoBar({
  history,
  disabled = false,
  disabledReason,
}: {
  history: Pick<UndoableState<unknown>, "undo" | "redo" | "canUndo" | "canRedo">;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const t = useTranslations("examBuilder");
  const { undo, redo, canUndo, canRedo } = history;

  React.useEffect(() => {
    if (disabled) return;
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (action === "undo" && canUndo) {
        event.preventDefault();
        undo();
      } else if (action === "redo" && canRedo) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, undo, redo, canUndo, canRedo]);

  const undoLabel = tx(t, "undo", "Undo");
  const redoLabel = tx(t, "redo", "Redo");
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={tx(t, "editHistory", "Edit history")} title={disabled ? disabledReason : undefined}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={undo}
        disabled={disabled || !canUndo}
        aria-label={`${undoLabel} (Ctrl+Z)`}
        title={`${undoLabel} (Ctrl+Z)`}
        data-testid="editor-undo"
      >
        <Undo2 className="size-4" aria-hidden />
        <span className="max-sm:sr-only">{undoLabel}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={redo}
        disabled={disabled || !canRedo}
        aria-label={`${redoLabel} (Ctrl+Shift+Z)`}
        title={`${redoLabel} (Ctrl+Shift+Z)`}
        data-testid="editor-redo"
      >
        <Redo2 className="size-4" aria-hidden />
        <span className="max-sm:sr-only">{redoLabel}</span>
      </Button>
    </div>
  );
}
