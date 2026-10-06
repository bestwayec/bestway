"use client";

import * as React from "react";
import { Copy, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMe } from "@/hooks/use-me";
import { useApplyMultilevelSafeRepair, useCloneCorrectedMultilevel, useMultilevelRepairInspection } from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail } from "@/lib/types";

function errorText(error: unknown) {
  return error instanceof ApiError ? `${error.message} (${error.code})` : "Could not complete the admin action.";
}

/**
 * A separate, opt-in transaction gate for legacy Multilevel data. Opening the
 * dialog is read-only; neither repair nor clone runs until the admin checks the
 * acknowledgement and presses an explicit action.
 */
export function MultilevelRepairDialog({ examId, detail }: { examId: string; detail: MockExamDetail }) {
  const { data: me } = useMe();
  const isAdmin = me?.user.role === "admin" || me?.user.role === "super_admin";
  const [open, setOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const inspection = useMultilevelRepairInspection(examId, open && isAdmin);
  const repair = useApplyMultilevelSafeRepair(examId);
  const clone = useCloneCorrectedMultilevel(examId);
  const router = useRouter();

  // Reset the explicit acknowledgement whenever the dialog closes, without a
  // state-syncing effect.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmed(false);
  }

  if (!isAdmin || detail.type !== "multilevel") return null;
  const plan = inspection.data;

  function repairDraft() {
    if (!confirmed || repair.isPending) return;
    repair.mutate(undefined, {
      onSuccess: () => { toast.success("Exam is now a draft. Review is required before publishing."); handleOpenChange(false); },
      onError: (error) => toast.error(errorText(error)),
    });
  }
  function cloneCorrected() {
    if (!confirmed || clone.isPending) return;
    clone.mutate(undefined, {
      onSuccess: (copy) => { toast.success("Corrected copy created as a draft; the original was preserved."); handleOpenChange(false); router.push(`/exam-builder/${copy.id}`); },
      onError: (error) => toast.error(errorText(error)),
    });
  }

  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
      <ShieldCheck className="size-4" aria-hidden /> Inspect repair safety
    </Button>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Multilevel repair safety inspection</DialogTitle>
          <DialogDescription>Read-only until an explicit confirmed action. Existing student history is never rewritten.</DialogDescription>
        </DialogHeader>
        {inspection.isLoading && <Skeleton className="h-56" />}
        {inspection.isError && <p className="text-sm text-danger">Could not load the authoritative repair inspection.</p>}
        {plan && <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={plan.historyExists ? "danger" : "success"}>{plan.historyExists ? "Historical activity found" : "No historical activity"}</Badge>
            <Badge variant={plan.readiness.ready ? "success" : "warning"}>{plan.readiness.ready ? "Ready" : "Not ready"}</Badge>
            <Badge variant={plan.currentVersion ? "success" : "warning"}>{plan.currentVersion ? "Current specification" : "Legacy specification"}</Badge>
            <span className="text-fg-muted">Published: {String(plan.exam.isPublished)} · Content v{plan.exam.contentVersion}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[["Attempts", plan.attempts.attemptCount], ["Active", plan.attempts.activeAttemptCount], ["Completed", plan.attempts.completedAttemptCount], ["Submissions", plan.attempts.submissionCount], ["Results", plan.attempts.resultCount]].map(([label, value]) => <div key={String(label)} className="rounded border border-border p-2"><div className="text-xs text-fg-muted">{label}</div><div className="font-semibold">{value}</div></div>)}
          </div>
          <section><h3 className="font-semibold">Authoritative readiness failures</h3>{plan.readiness.exactIssues.length ? <ul className="list-disc space-y-1 pl-5 text-danger">{plan.readiness.exactIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : <p className="text-fg-muted">None.</p>}</section>
          <section><h3 className="font-semibold">Writing</h3><ul className="space-y-1">{plan.writing.map((task) => <li key={task.task}>{task.role}: {task.exists ? `/${task.maxScore ?? "—"} (expected /${task.expectedMaxScore}), prompt ${task.promptPresent ? "present" : "missing"}` : "missing"}</li>)}</ul><p className={plan.writingSharesStimulusRef ? "text-success" : "text-danger"}>Task 1.1 and 1.2 shared stimulusRef: {plan.writingSharesStimulusRef ? "yes" : "no"}</p></section>
          <section><h3 className="font-semibold">Speaking</h3><ul className="space-y-1">{plan.speaking.map((part) => <li key={part.part}>Part {part.part}: {part.exists ? `${part.responseCount}/${part.expectedResponseCount} responses, /${part.maxScore ?? "—"} (expected /${part.expectedMaxScore})${part.requiresTwoPictureAsset ? `, ${part.imageAssetCount} two-picture asset` : ""}` : "missing"}</li>)}</ul></section>
          {plan.proposedChanges.length > 0 && <section><h3 className="font-semibold">Proposed automatic metadata changes</h3><ul className="list-disc pl-5">{plan.proposedChanges.map((change) => <li key={change.field}>{change.field}: {String(change.from ?? "empty")} → {String(change.to)}</li>)}</ul></section>}
          {plan.manualAuthoringRequired.length > 0 && <section><h3 className="font-semibold">Manual authoring still required</h3><ul className="list-disc pl-5 text-warning">{plan.manualAuthoringRequired.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
          <label className="flex items-start gap-2 rounded border border-border p-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{plan.historyExists ? "I understand this creates a separate corrected draft and preserves the existing exam and its history." : "I understand this unpublishes the unused exam, reconciles it to the current Multilevel specification, and leaves it as a draft requiring Review before Publish."}</span></label>
        </div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          {plan?.historyExists ? <Button type="button" disabled={!confirmed || clone.isPending} loading={clone.isPending} onClick={cloneCorrected}><Copy className="size-4" aria-hidden /> Create corrected copy</Button> : plan?.safeRepairAllowed ? <Button type="button" disabled={!confirmed || repair.isPending} loading={repair.isPending} onClick={repairDraft}><Wrench className="size-4" aria-hidden /> Unpublish & repair metadata</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
