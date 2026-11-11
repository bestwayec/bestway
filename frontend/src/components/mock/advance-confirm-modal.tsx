"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** "Next section" is one-way in a full test, so it asks first, like finishing the exam does. */
export function AdvanceConfirmModal({ open, onOpenChange, onConfirm, busy }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("mock.advanceConfirm");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border border-border bg-bg-subtle p-6 text-fg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-fg"><ArrowRight className="size-5 text-brand" />{t("title")}</DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">{t("body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="min-h-[44px] flex-1" disabled={busy} onClick={() => onOpenChange(false)}>{t("stay")}</Button>
          <Button type="button" className="min-h-[44px] flex-1 bg-brand font-bold text-brand-fg hover:bg-brand-hover" loading={busy} onClick={onConfirm}>{t("confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
