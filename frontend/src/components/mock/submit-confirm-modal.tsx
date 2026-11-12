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
  const hasQuestions = total > 0;
  const missing = Math.max(0, total - answered);
  const isAllAnswered = hasQuestions && missing === 0 && answered >= total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 bg-bg-subtle border border-border text-fg">
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

          {!hasQuestions ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-danger">
                  Savollar yuklanmadi yoki mavjud emas (0 / 0)
                </p>
                <p className="mt-1 text-fg-muted">
                  Savollar ro&apos;yxati yuklanmaganligi sababli imtihonni topshirib bo&apos;lmaydi. Iltimos, sahifani yangilang yoki administratorga murojaat qiling.
                </p>
              </div>
            </div>
          ) : isAllAnswered ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-brand/30 bg-brand/10 p-3 text-xs text-brand">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              <p>Siz barcha topshiriqlarga to&apos;liq javob berdingiz. Ishingizni xotirjam topshirishingiz mumkin.</p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-warning">
                  Siz {total} tadan {answered} ta savolga javob berdingiz.
                </p>
                <p className="mt-1 text-fg-muted">
                  Qolgan javob berilmagan savollarga 0 ball qo&apos;yiladi. Imtihonni yakunlaysizmi?
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
            ⬅️ Davom etish
          </Button>
          <Button
            type="button"
            className="flex-1 bg-brand font-bold text-brand-fg hover:bg-brand-hover"
            disabled={!hasQuestions}
            loading={isSubmitting}
            onClick={onConfirm}
          >
            ✅ Ha, yakunlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
