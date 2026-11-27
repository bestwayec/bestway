"use client";

import * as React from "react";
import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import type { GroupListItem } from "@/lib/types";

export type TransferStudent = { id: string; name: string };

/**
 * Moves one student from `sourceGroupId` to another active group.
 * The server owns authorization (teacher must own both groups unless office
 * staff) and closes the former enrollment interval; this dialog only offers
 * non-archived targets and reports the server verdict.
 */
export function StudentTransferDialog({
  sourceGroupId,
  student,
  groups,
  onClose,
}: {
  sourceGroupId: string;
  student: TransferStudent | null;
  groups: GroupListItem[] | undefined;
  onClose: () => void;
}) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const targets = React.useMemo(
    () => (groups ?? []).filter((g) => g.id !== sourceGroupId && !g.archived),
    [groups, sourceGroupId],
  );
  const [chosenGroupId, setTargetGroupId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Derived so a refetched group list or archived target never leaves a stale choice.
  const targetGroupId = targets.some((g) => g.id === chosenGroupId) ? chosenGroupId : targets[0]?.id ?? "";

  async function submit() {
    if (!student || !targetGroupId || busy) return;
    setBusy(true);
    try {
      await api.post(`/groups/${encodeURIComponent(targetGroupId)}/students`, {
        studentId: student.id,
        sourceGroupId,
      });
      toast.success(t("transferSuccess"));
      setTargetGroupId("");
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["group", sourceGroupId] }),
        queryClient.invalidateQueries({ queryKey: ["group", targetGroupId] }),
        queryClient.invalidateQueries({ queryKey: ["groups"] }),
        queryClient.invalidateQueries({ queryKey: ["classroom-management"] }),
      ]);
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : tc("unknownError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!student} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="size-5 text-brand" aria-hidden />
            {t("transferTitle")}
          </DialogTitle>
          <DialogDescription>{t("transferDescription", { name: student?.name ?? "" })}</DialogDescription>
        </DialogHeader>
        {targets.length === 0 ? (
          <p className="py-2 text-sm text-fg-muted" role="status">{t("transferNoTargets")}</p>
        ) : (
          <div className="space-y-1.5 py-2">
            <label htmlFor="transfer-target-group" className="text-xs font-medium text-fg-muted">
              {t("transferTarget")}
            </label>
            <select
              id="transfer-target-group"
              value={targetGroupId}
              onChange={(e) => setTargetGroupId(e.target.value)}
              disabled={busy}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-brand"
            >
              {targets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {t("transferStudents", { count: g.studentsCount })}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {tc("cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !targetGroupId}>
            {busy ? tc("loading") : t("transferSubmit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
