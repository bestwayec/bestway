"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";

type InvitationStatus = {
  invitation: { expiresAt: string; revokedAt: string | null; uses: number; maxUses: number | null; requiresApproval: boolean; active: boolean } | null;
  requests: { id: number; studentName: string }[];
};

export function ClassroomInvitation({ groupId }: { groupId: string }) {
  const t = useTranslations("classroomInvitation");
  const format = useFormatter();
  const qc = useQueryClient();
  const pathname = usePathname();
  const endpoint = `/groups/${encodeURIComponent(groupId)}/invitation`;
  const queryKey = ["group-invitation", groupId];
  const status = useQuery({ queryKey, queryFn: () => api.get<InvitationStatus>(endpoint) });
  const [code, setCode] = useState("");
  const [approval, setApproval] = useState(false);
  const [hours, setHours] = useState("168");
  const [uses, setUses] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey });
  const report = (err: unknown) => toast.error(err instanceof Error ? err.message : t("failed"));
  const issue = useMutation({
    mutationFn: () => api.post<{ code: string }>(endpoint, {
      requiresApproval: approval,
      expiresInHours: Number(hours),
      maxUses: uses ? Number(uses) : null,
    }),
    onSuccess: async (data) => {
      setCode(data.code);
      await refresh();
    },
    onError: report,
  });
  const revoke = useMutation({
    mutationFn: () => api.delete(endpoint),
    onSuccess: async () => {
      setCode("");
      await refresh();
    },
    onError: report,
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      api.post(`${endpoint}/requests/${id}`, { approve }),
    onSuccess: async () => {
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["group", groupId] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
    },
    onError: report,
  });

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied"));
    } catch (error) {
      report(error);
    }
  }

  const invite = status.data?.invitation;
  const current = invite?.active === true;
  const busy = issue.isPending || revoke.isPending || decide.isPending;
  return (
    <section aria-labelledby="group-invitation-title" className="mb-4 space-y-4 rounded-card border border-border bg-surface p-4">
      <h2 id="group-invitation-title" className="font-semibold text-fg">{t("title")}</h2>
      {status.isPending && <p role="status" className="text-sm text-fg-muted">{t("loading")}</p>}
      {status.isError && <p role="alert" className="text-sm text-fg-muted">{t("failed")}</p>}
      {invite && current && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-fg-muted">
            {t(invite.requiresApproval ? "approvalMode" : "automaticMode")} · {t("expiresAt", { date: format.dateTime(new Date(invite.expiresAt), { dateStyle: "medium", timeStyle: "short" }) })} · {t("usesCount", { count: invite.uses })}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => revoke.mutate()}>{t("revoke")}</Button>
        </div>
      )}
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); issue.mutate(); }}>
        <label className="flex min-h-10 items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={approval} onChange={(event) => setApproval(event.target.checked)} />
          {t("requireApproval")}
        </label>
        <label className="space-y-1 text-sm text-fg">
          <span>{t("expires")}</span>
          <Input className="w-28" type="number" min={1} max={720} value={hours} onChange={(event) => setHours(event.target.value)} required />
        </label>
        <label className="space-y-1 text-sm text-fg">
          <span>{t("useLimit")}</span>
          <Input className="w-28" type="number" min={1} max={1000} value={uses} onChange={(event) => setUses(event.target.value)} />
        </label>
        <Button type="submit" disabled={busy || !status.isSuccess}>{t(current ? "regenerate" : "create")}</Button>
      </form>
      {code && current && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded-control bg-brand-subtle px-2 py-1 text-fg">{code}</code>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(code)}>{t("copyCode")}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => {
            const locale = pathname.split("/")[1];
            void copy(`${window.location.origin}/${locale}/dashboard#join=${encodeURIComponent(code)}`);
          }}>{t("copyLink")}</Button>
        </div>
      )}
      {!!status.data?.requests.length && (
        <ul aria-label={t("pending")} className="divide-y divide-border">
          {status.data.requests.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="mr-auto text-sm text-fg">{row.studentName}</span>
              <Button size="sm" disabled={busy || !current} onClick={() => decide.mutate({ id: row.id, approve: true })}>{t("approve")}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => decide.mutate({ id: row.id, approve: false })}>{t("reject")}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
