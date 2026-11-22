"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Flag, Send } from "lucide-react";
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
  flaggedCount?: number;
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
  flaggedCount = 0,
  skillName,
  isSingleSection,
}: SubmitConfirmModalProps) {
  const t = useTranslations("mock.submitDialog");
  const tSkills = useTranslations("mock.skills");
  const skillLabel = skillName && ["listening", "reading", "writing", "speaking"].includes(skillName) ? tSkills(skillName) : skillName;
  const hasQuestions = total > 0;
  const missing = Math.max(0, total - answered);
  const isAllAnswered = hasQuestions && missing === 0 && answered >= total;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 bg-bg-subtle border border-border text-fg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-fg">
            <Send className="size-5 text-brand" />
            {isSingleSection && skillLabel ? t("titleSection", { skill: skillLabel }) : t("title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 space-y-3">
          {/* Summary Cards Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-surface p-3 text-center space-y-1">
              <span className="text-[11px] font-medium text-fg-muted">{t("answeredCard")}</span>
              <p className="text-base font-bold text-success tabular-nums">
                {answered} / {total}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3 text-center space-y-1">
              <span className="text-[11px] font-medium text-fg-muted">{t("unansweredCard")}</span>
              <p className={`text-base font-bold tabular-nums ${missing > 0 ? "text-danger" : "text-fg-muted"}`}>
                {missing}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3 text-center space-y-1">
              <span className="text-[11px] font-medium text-fg-muted flex items-center justify-center gap-1">
                <Flag className="size-3 text-warning" />
                {t("flaggedCard")}
              </span>
              <p className={`text-base font-bold tabular-nums ${flaggedCount > 0 ? "text-warning" : "text-fg-muted"}`}>
                {flaggedCount}
              </p>
            </div>
          </div>

          {!hasQuestions ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-danger">
                  {t("noQuestionsTitle")}
                </p>
                <p className="mt-1 text-fg-muted">
                  {t("noQuestionsBody")}
                </p>
              </div>
            </div>
          ) : isAllAnswered ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-brand/30 bg-brand/10 p-3 text-xs text-brand-subtle-fg">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
              <p>{t("allAnswered")}</p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-bg p-3 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-warning">
                  {t("partialTitle", { answered, total })}
                </p>
                <p className="mt-1 text-fg-muted">
                  {t("partialBody")}
                </p>
              </div>
            </div>
          )}

          {flaggedCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              <Flag className="size-3.5 shrink-0" />
              <span>{t("flaggedNotice", { count: flaggedCount })}</span>
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
            {t("keepWorking")}
          </Button>
          <Button
            type="button"
            className="flex-1 bg-brand font-bold text-brand-fg hover:bg-brand-hover"
            disabled={!hasQuestions}
            loading={isSubmitting}
            onClick={onConfirm}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
