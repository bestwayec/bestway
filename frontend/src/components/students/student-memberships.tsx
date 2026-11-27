"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentTransferDialog } from "@/components/groups/student-transfer-dialog";
import { api } from "@/lib/api-client";
import type { GroupListItem } from "@/lib/types";

type Membership = { groupId: string; name: string; teacherName: string | null; archived: boolean };

export function StudentMemberships({ studentId, name, groups }: {
  studentId: string;
  name: string;
  groups: GroupListItem[];
}) {
  const t = useTranslations("studentManagement");
  const qc = useQueryClient();
  const [target, setTarget] = useState("");
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const key = ["student-memberships", studentId];
  const memberships = useQuery({
    queryKey: key,
    queryFn: () => api.get<Membership[]>(`/users/${encodeURIComponent(studentId)}/memberships`),
  });
  const change = useMutation({
    mutationFn: ({ groupId, remove }: { groupId: string; remove: boolean }) => {
      const path = `/groups/${encodeURIComponent(groupId)}/students`;
      return remove ? api.delete(`${path}/${encodeURIComponent(studentId)}`) : api.post(path, { studentId });
    },
    onSuccess: async (_, { groupId }) => {
      setTarget("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: ["groups"] }),
        qc.invalidateQueries({ queryKey: ["group", groupId] }),
        qc.invalidateQueries({ queryKey: ["users"] }),
        qc.invalidateQueries({ queryKey: ["user", studentId] }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const available = groups.filter((group) => !group.archived && !memberships.data?.some((item) => item.groupId === group.id));

  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>{t("memberships")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {memberships.isError && <p role="alert" className="text-sm text-fg-muted">{t("failed")}</p>}
        {memberships.data?.length === 0 && <p className="text-sm text-fg-muted">{t("noMemberships")}</p>}
        <ul className="divide-y divide-border">
          {memberships.data?.map((item) => (
            <li key={item.groupId} className="flex flex-wrap items-center gap-2 py-2">
              <Link href={`/groups/${encodeURIComponent(item.groupId)}?tab=students`} className="mr-auto text-sm font-medium text-fg underline-offset-4 hover:underline">
                {item.name}
                {item.teacherName && <span className="ml-2 font-normal text-fg-muted">{item.teacherName}</span>}
              </Link>
              {!item.archived && (
                <>
                  <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => setTransferFrom(item.groupId)}>{t("transfer")}</Button>
                  <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => {
                    if (confirm(t("removeConfirm", { name: item.name }))) change.mutate({ groupId: item.groupId, remove: true });
                  }}>{t("remove")}</Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {!!available.length && memberships.isSuccess && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (available.some((group) => group.id === target)) change.mutate({ groupId: target, remove: false });
          }}>
            <label className="min-w-0 flex-1 text-sm text-fg-muted">
              {t("group")}
              <select value={target} onChange={(event) => setTarget(event.target.value)} required
                className="mt-1 w-full rounded-control border border-border bg-surface px-2 py-2 text-sm text-fg">
                <option value="">{t("choose")}</option>
                {available.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <Button type="submit" disabled={!target || change.isPending}>{t("add")}</Button>
          </form>
        )}
      </CardContent>
      {transferFrom && (
        <StudentTransferDialog sourceGroupId={transferFrom} student={{ id: studentId, name }} groups={groups} onClose={() => {
          setTransferFrom(null);
          void qc.invalidateQueries({ queryKey: key });
        }} />
      )}
    </Card>
  );
}
