"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import { useAdjustPoints } from "@/hooks/use-points";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function AdjustPointsDialog({
  open,
  onClose,
  studentId,
  studentName,
  limit,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  /** O'qituvchi chegarasi (admin/super uchun berilmaydi) */
  limit?: number;
}) {
  const t = useTranslations("points");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("adjust")} · {studentName}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <AdjustPointsFields
            key={studentId}
            studentId={studentId}
            limit={limit}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdjustPointsFields({
  studentId,
  limit,
  onClose,
}: {
  studentId: string;
  limit?: number;
  onClose: () => void;
}) {
  const t = useTranslations("points");
  const tc = useTranslations("common");
  const adjust = useAdjustPoints(studentId);

  const [dir, setDir] = React.useState<1 | -1>(1);
  const [amount, setAmount] = React.useState("5");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    const change = dir * (Number(amount) || 0);
    if (change === 0) return;
    if (reason.trim().length < 3) {
      setError(t("reasonRequired"));
      return;
    }
    adjust.mutate(
      { change, reason: reason.trim() },
      {
        onSuccess: (res) => {
          toast.success(`${t("current")}: ${res.current}`);
          onClose();
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  return (
    <>
      <DialogBody className="space-y-4">
        {error && (
          <div className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDir(1)}
            aria-pressed={dir === 1}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-field border px-3 py-2.5 text-sm font-medium transition-colors",
              dir === 1
                ? "border-success bg-success-bg text-success"
                : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Plus className="size-4" />
            {t("add")}
          </button>
          <button
            type="button"
            onClick={() => setDir(-1)}
            aria-pressed={dir === -1}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-field border px-3 py-2.5 text-sm font-medium transition-colors",
              dir === -1
                ? "border-danger bg-danger-bg text-danger"
                : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
            )}
          >
            <Minus className="size-4" />
            {t("subtract")}
          </button>
        </div>

        <Field label={t("change")} htmlFor="pamount" hint={limit ? t("teacherLimit", { limit }) : undefined}>
          <Input
            id="pamount"
            type="number"
            min={1}
            max={limit ?? undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <Field label={t("reason")} htmlFor="preason">
          <Textarea
            id="preason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            maxLength={300}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={adjust.isPending}>
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
