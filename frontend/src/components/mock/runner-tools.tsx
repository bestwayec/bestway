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

const icon = "min-h-[40px] min-w-[40px] px-2 touch-manipulation";

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
    <div className="flex items-center gap-0.5" role="group" aria-label={t("toolsLabel")}>
      <Button size="sm" variant={infoOpen ? "subtle" : "ghost"} className={icon} aria-expanded={infoOpen} aria-controls="runner-info" onClick={onInfo} aria-label={t("infoTitle")} title={t("infoTitle")}>
        <Info className="size-4" aria-hidden />
      </Button>
      <div className="hidden items-center gap-0.5 md:flex">
        <Button size="sm" variant="ghost" className={icon} onMouseDown={(event) => event.preventDefault()} onClick={highlight} aria-label={t("highlight")} title={t("highlight")}>
          <Highlighter className="size-4" aria-hidden />
        </Button>
        <Button size="sm" variant={tools.notesOpen ? "subtle" : "ghost"} className={cn(icon, "relative")} aria-expanded={tools.notesOpen} onClick={tools.onNotes} aria-label={t("notesButton", { count: tools.notesCount })} title={t("notesButton", { count: tools.notesCount })}>
          <StickyNote className="size-4 text-warning" aria-hidden />
          {tools.notesCount > 0 && <span className="absolute right-0.5 top-0.5 rounded-full bg-warning px-1 text-[10px] font-bold leading-4 text-slate-950" aria-hidden>{tools.notesCount}</span>}
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
  const item = "min-h-[40px] justify-start gap-2 px-3 text-sm";
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

/** Clearing answers asks first and says what stays (recordings, other sections). */
export function ClearAnswersDialog({ open, sectionName, count, onCancel, onConfirm }: {
  open: boolean;
  sectionName: string;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("mock.runnerUx");
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onCancel(); }}>
      <DialogContent className="max-w-md border border-border bg-bg-subtle p-6 text-fg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-fg"><Trash2 className="size-5 text-danger" aria-hidden />{t("clearTitle", { section: sectionName })}</DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">{t("clearBody", { count })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-[44px] flex-1" onClick={onCancel}>{t("clearCancel")}</Button>
          <Button type="button" className="min-h-[44px] flex-1 bg-danger font-bold text-white hover:bg-danger/90" onClick={onConfirm}>{t("clearConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
