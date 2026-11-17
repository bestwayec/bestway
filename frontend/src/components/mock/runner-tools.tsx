"use client";

import * as React from "react";
import { BookOpenText, EyeOff, Focus, Highlighter, HelpCircle, Info, Settings2, StickyNote, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { highlightCurrentSelection } from "./cbt-annotated-text";
import type { ExamToolbarHandle } from "./exam-toolbar";

type ToolState = {
  notesCount: number;
  notesOpen: boolean;
  onNotes: () => void;
  /** null: word lookup is not offered (timed exam). */
  vocab: boolean | null;
  onVocab: () => void;
  focus: boolean;
  onFocus: () => void;
};

const icon = "min-h-11 min-w-11 px-2 touch-manipulation md:min-h-10 md:min-w-10";

/** Highlights the selected words; without a selection it says how. Keeps the selection on press. */
function useHighlight() {
  const t = useTranslations("mock.runnerUx");
  return React.useCallback(() => {
    if (!highlightCurrentSelection()) toast.info(t("highlightHint"));
  }, [t]);
}

/**
 * Header tools. From md: Info, Highlight, Notes, Word lookup (practice), Focus; from 2xl also the exam
 * toolbar (Settings, Help, Hide). Below that they are in the Info panel; phones show Info only.
 */
export function RunnerTools({ infoOpen, onInfo, children, ...tools }: ToolState & { infoOpen: boolean; onInfo: () => void; children?: React.ReactNode }) {
  const t = useTranslations("mock.runnerUx");
  const highlight = useHighlight();
  return (
    <div className="flex items-center gap-0.5 border-x border-border px-1 max-sm:border-x-0 max-sm:px-0" role="group" aria-label={t("toolsLabel")}>
      <Button size="sm" variant={infoOpen ? "subtle" : "ghost"} className={icon} aria-expanded={infoOpen} aria-controls="runner-info" onClick={onInfo} aria-label={t("infoTitle")} title={t("infoTitle")}>
        <Info className="size-4" aria-hidden />
      </Button>
      <div className="hidden items-center gap-0.5 md:flex">
        <Button size="sm" variant="ghost" className={icon} onMouseDown={(event) => event.preventDefault()} onClick={highlight} aria-label={t("highlight")} title={t("highlight")}>
          <Highlighter className="size-4" aria-hidden />
        </Button>
        <Button size="sm" variant={tools.notesOpen ? "subtle" : "ghost"} className={cn(icon, "relative")} aria-expanded={tools.notesOpen} onClick={tools.onNotes} aria-label={t("notesButton", { count: tools.notesCount })} title={t("notesButton", { count: tools.notesCount })}>
          <StickyNote className="size-4" aria-hidden />
          {tools.notesCount > 0 && <span className="absolute right-0.5 top-0.5 rounded-full bg-warning px-1 text-xs font-bold leading-4 text-warning-fg" aria-hidden>{tools.notesCount}</span>}
        </Button>
        {tools.vocab !== null && (
          <Button size="sm" variant={tools.vocab ? "subtle" : "ghost"} className={icon} aria-pressed={tools.vocab} onClick={tools.onVocab} aria-label={t("vocab")} title={t("vocab")}>
            <BookOpenText className="size-4" aria-hidden />
          </Button>
        )}
        <Button size="sm" variant={tools.focus ? "subtle" : "ghost"} className={icon} aria-pressed={tools.focus} onClick={tools.onFocus} aria-label={t("focus")} title={t("focus")}>
          <Focus className="size-4" aria-hidden />
        </Button>
      </div>
      {children}
    </div>
  );
}

/** The same tools with their names, in the Info panel: all of them on phones; Settings, Help and Hide below 2xl. */
export function PhoneToolsRow({ toolbar, ...tools }: ToolState & { toolbar: React.RefObject<ExamToolbarHandle | null> }) {
  const t = useTranslations("mock.runnerUx");
  const te = useTranslations("mock.examTools");
  const highlight = useHighlight();
  const item = "min-h-11 justify-start gap-2 px-3 text-sm";
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 2xl:hidden" role="group" aria-label={t("toolsLabel")}>
      <Button size="sm" variant="outline" className={cn(item, "md:hidden")} onMouseDown={(event) => event.preventDefault()} onClick={highlight}><Highlighter className="size-4" aria-hidden />{t("highlight")}</Button>
      <Button size="sm" variant={tools.notesOpen ? "subtle" : "outline"} className={cn(item, "md:hidden")} aria-expanded={tools.notesOpen} onClick={tools.onNotes}><StickyNote className="size-4 text-warning" aria-hidden />{t("notesButton", { count: tools.notesCount })}</Button>
      {tools.vocab !== null && <Button size="sm" variant={tools.vocab ? "subtle" : "outline"} className={cn(item, "md:hidden")} aria-pressed={tools.vocab} onClick={tools.onVocab}><BookOpenText className="size-4" aria-hidden />{t("vocab")}</Button>}
      <Button size="sm" variant={tools.focus ? "subtle" : "outline"} className={cn(item, "md:hidden")} aria-pressed={tools.focus} onClick={tools.onFocus}><Focus className="size-4" aria-hidden />{t("focus")}</Button>
      <Button size="sm" variant="outline" className={item} onClick={() => toolbar.current?.open("settings")}><Settings2 className="size-4" aria-hidden />{te("settings")}</Button>
      <Button size="sm" variant="outline" className={item} onClick={() => toolbar.current?.open("help")}><HelpCircle className="size-4" aria-hidden />{te("help")}</Button>
      <Button size="sm" variant="outline" className={item} onClick={() => toolbar.current?.hide()}><EyeOff className="size-4" aria-hidden />{te("hide")}</Button>
    </div>
  );
}

export type ClearScope = "part" | "section";

/**
 * Clearing answers asks first and says what stays (recordings, other parts and sections).
 * With more than one part the student chooses: only the open part, or the whole section.
 */
export function ClearAnswersDialog({ open, sectionName, count, part, onCancel, onConfirm }: {
  open: boolean;
  sectionName: string;
  count: number;
  /** The open part, when the section has more than one; its answered count may be 0. */
  part?: { name: string; count: number } | null;
  onCancel: () => void;
  onConfirm: (scope: ClearScope) => void;
}) {
  const t = useTranslations("mock.runnerUx");
  const [scope, setScope] = React.useState<ClearScope>("part");
  const partUsable = Boolean(part && part.count > 0);
  const effective: ClearScope = partUsable ? scope : "section";
  React.useEffect(() => { if (open) setScope(partUsable ? "part" : "section"); }, [open, partUsable]);
  const removing = effective === "part" && part ? part.count : count;
  const option = (value: ClearScope, label: string, disabled = false) => (
    <label className={cn("flex items-center gap-2 rounded-field border p-2.5 text-sm", effective === value ? "border-danger/50 bg-danger-bg" : "border-border bg-surface", disabled ? "opacity-60" : "cursor-pointer")}>
      <input type="radio" name="clear-scope" value={value} checked={effective === value} disabled={disabled} onChange={() => setScope(value)} className="accent-danger" />
      <span className="text-fg">{label}</span>
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onCancel(); }}>
      <DialogContent className="max-w-md border border-border bg-bg-subtle p-6 text-fg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-fg"><Trash2 className="size-5 text-danger" aria-hidden />{part ? t("clearTitleAny") : t("clearTitle", { section: sectionName })}</DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">{t(effective === "part" ? "clearBodyPart" : "clearBody", { count: removing })}</DialogDescription>
        </DialogHeader>
        {part && (
          <fieldset className="space-y-1.5" data-testid="clear-scope">
            <legend className="sr-only">{t("clearScopeLabel")}</legend>
            {option("part", t("clearScopePart", { part: part.name, count: part.count }), !partUsable)}
            {option("section", t("clearScopeSection", { section: sectionName, count }))}
          </fieldset>
        )}
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-[44px] flex-1" onClick={onCancel}>{t("clearCancel")}</Button>
          <Button type="button" className="min-h-[44px] flex-1 bg-danger font-bold text-white hover:bg-danger/90" disabled={removing === 0} onClick={() => onConfirm(effective)}>{t("clearConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
