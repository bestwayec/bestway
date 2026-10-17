"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SubmitConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  answered: number;
  total: number;
  skillName?: string;
  isSingleSection?: boolean;
}

export function SubmitConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  answered,
  total,
  skillName,
  isSingleSection,
}: SubmitConfirmModalProps) {
  const missing = Math.max(0, total - answered);
  const isAllAnswered = missing === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-fg">
            <Send className="size-5 text-brand" />
            {isSingleSection && skillName ? `${skillName.toUpperCase()} — Imtihonni topshirish` : "Imtihonni topshirish"}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            Javoblaringiz yakuniy baholash uchun yuboriladi
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-border bg-bg-subtle p-3.5">
            <span className="text-sm font-medium text-fg">Javob berilgan topshiriqlar:</span>
            <span className="text-base font-bold text-brand tabular-nums">
              {answered} / {total}
            </span>
          </div>

          {isAllAnswered ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              <p>Siz barcha topshiriqlarga to&apos;liq javob berdingiz. Ishingizni xotirjam topshirishingiz mumkin.</p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Diqqat: {missing} ta topshiriqqa javob berilmadi!</p>
                <p className="mt-0.5 text-fg-muted">
                  Topshirilsa, javob berilmagan savollarga ball berilmaydi. Shunga qaramay topshirishni tasdiqlaysizmi?
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Davom ettirish
          </Button>
          <Button
            type="button"
            className="flex-1 bg-brand font-bold text-white hover:bg-brand-hover"
            loading={isSubmitting}
            onClick={onConfirm}
          >
            Ha, topshirish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
