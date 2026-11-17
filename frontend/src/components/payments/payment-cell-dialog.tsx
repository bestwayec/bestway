"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { PaymentState } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PaymentCellTarget {
  studentId: string;
  studentName: string;
  month: number;
  state?: PaymentState;
  amount: number;
  note: string | null;
}

const STATES: PaymentState[] = ["paid", "partial", "unpaid", "empty"];

const stateStyle: Record<PaymentState, string> = {
  paid: "border-success bg-success-bg text-success",
  partial: "border-warning bg-warning-bg text-warning",
  unpaid: "border-danger bg-danger-bg text-danger",
  empty: "border-border bg-surface text-fg-muted",
};

export function PaymentCellDialog({
  target,
  onClose,
  onSave,
  defaultAmount,
}: {
  target: PaymentCellTarget | null;
  onClose: () => void;
  onSave: (values: { state: PaymentState; amount: number; note: string }) => void;
  defaultAmount: number;
}) {
  const t = useTranslations("payments");
  const tMonths = useTranslations("months");

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target ? t("editCell", { month: tMonths(String(target.month)), name: target.studentName }) : ""}
          </DialogTitle>
        </DialogHeader>

        {target && (
          <PaymentCellFields
            key={`${target.studentId}-${target.month}`}
            target={target}
            defaultAmount={defaultAmount}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentCellFields({
  target,
  defaultAmount,
  onClose,
  onSave,
}: {
  target: PaymentCellTarget;
  defaultAmount: number;
  onClose: () => void;
  onSave: (values: { state: PaymentState; amount: number; note: string }) => void;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const initial = target.state ?? "paid";

  const [state, setState] = React.useState<PaymentState>(initial);
  const [amount, setAmount] = React.useState<string>(
    String(target.amount || (initial === "paid" ? defaultAmount : 0) || ""),
  );
  const [note, setNote] = React.useState<string>(target.note ?? "");

  function submit() {
    onSave({ state, amount: Number(amount) || 0, note: note.trim() });
  }

  return (
    <>
      <DialogBody className="space-y-4">
        <Field label={tc("confirm")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STATES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setState(s);
                  if (s === "paid" && (!amount || amount === "0")) setAmount(String(defaultAmount || ""));
                  if (s === "unpaid" || s === "empty") setAmount("0");
                }}
                aria-pressed={state === s}
                className={cn(
                  "rounded-field border px-3 py-2 text-sm font-medium transition-colors",
                  state === s
                    ? stateStyle[s]
                    : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                )}
              >
                {t(s)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={`${t("amount")} (${tc("sum")})`} htmlFor="amount">
          <Input
            id="amount"
            type="number"
            inputMode="numeric"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </Field>

        <Field label={t("note")} htmlFor="note">
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            maxLength={500}
          />
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit}>{tc("save")}</Button>
      </DialogFooter>
    </>
  );
}
