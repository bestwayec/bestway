"use client";

import * as React from "react";
import { Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Single keys of the exam window. None of them work while the student types an answer. */
export const RUNNER_SHORTCUTS = [
  { keys: ["N"], action: "next" },
  { keys: ["P"], action: "previous" },
  { keys: ["F"], action: "flag" },
  { keys: ["H"], action: "highlight" },
  { keys: ["?"], action: "help" },
  { keys: ["Esc"], action: "close" },
] as const;
export type RunnerShortcutAction = (typeof RUNNER_SHORTCUTS)[number]["action"];

/** True when a key press belongs to typing (answer fields, editable text) or to another control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["radio", "checkbox", "button", "submit", "range"].includes(type);
  }
  return Boolean(target.closest('[role="textbox"], [contenteditable="true"]'));
}

/** Which shortcut a key press is, if any (no modifiers; "?" is Shift + / on most layouts). */
export function shortcutFor(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">): Exclude<RunnerShortcutAction, "close"> | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  switch (event.key) {
    case "n": case "N": return "next";
    case "p": case "P": return "previous";
    case "f": case "F": return "flag";
    case "h": case "H": return "highlight";
    case "?": return "help";
    default: return null;
  }
}

/** Calls `handlers[action]` for the shortcuts given; the latest handlers are used without re-subscribing. */
export function useRunnerShortcuts(handlers: Partial<Record<Exclude<RunnerShortcutAction, "close">, () => void>>, enabled = true) {
  const latest = React.useRef(handlers);
  React.useEffect(() => { latest.current = handlers; });
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const action = shortcutFor(event);
      const handler = action ? latest.current[action] : undefined;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** The "?" help: every shortcut of the exam window. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("mock.shortcuts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Keyboard className="size-5 text-brand" aria-hidden />{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="divide-y divide-border" data-testid="shortcuts-list">
            {RUNNER_SHORTCUTS.map(({ keys, action }) => (
              <div key={action} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="text-fg">{t(action)}</dt>
                <dd className="flex gap-1">
                  {keys.map((key) => (
                    <kbd key={key} className="min-w-[1.75rem] rounded-md border border-border bg-bg-subtle px-1.5 py-0.5 text-center font-mono text-xs font-semibold text-fg">{key}</kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
