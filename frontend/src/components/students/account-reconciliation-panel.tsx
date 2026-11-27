"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, GitMerge, History, ShieldAlert } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";

type AccountSummary = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  role: string;
  isActive: boolean;
  telegramLinked: boolean;
  memberships: Array<{ groupId: string; groupName: string; teacherName?: string | null }>;
  counts: {
    mockAttempts: number;
    testAttempts: number;
    payments: number;
    attendance: number;
    homework: number;
  };
};

type DuplicatePair = {
  signal: string;
  verifiedIdentityMatch: boolean;
  accounts: [AccountSummary, AccountSummary];
};

type MergePreview = {
  canMerge: boolean;
  identityBasis: string;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  previewToken: string;
  source: AccountSummary;
  canonical: AccountSummary;
};

type MergeHistoryItem = {
  id: string;
  canonicalUserId: string;
  sourceUserId: string;
  actorName: string;
  reason: string;
  identityBasis: string;
  createdAt: string;
};

export function AccountReconciliationPanel() {
  const t = useTranslations("studentManagement");
  const qc = useQueryClient();
  const [sourceId, setSourceId] = React.useState("");
  const [canonicalId, setCanonicalId] = React.useState("");
  const [verifiedOwnership, setVerifiedOwnership] = React.useState(false);
  const [transferTelegram, setTransferTelegram] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [preview, setPreview] = React.useState<MergePreview | null>(null);

  const dupsQ = useQuery({
    queryKey: ["account-reconciliation"],
    queryFn: () => api.get<{ duplicates: DuplicatePair[]; history: MergeHistoryItem[] }>("/users/reconciliation"),
  });

  const previewMut = useMutation({
    mutationFn: () =>
      api.post<MergePreview>("/users/reconciliation/preview", {
        sourceUserId: sourceId.trim(),
        canonicalUserId: canonicalId.trim(),
        verifiedOwnership,
        transferTelegram,
      }),
    onSuccess: (data) => setPreview(data),
    onError: (err) => toast.error(err.message),
  });

  const mergeMut = useMutation({
    mutationFn: () =>
      api.post<{ merged: boolean }>("/users/reconciliation/merge", {
        sourceUserId: sourceId.trim(),
        canonicalUserId: canonicalId.trim(),
        reason: reason.trim(),
        confirmText: confirmText.trim(),
        previewToken: preview?.previewToken ?? "",
        verifiedOwnership,
        transferTelegram,
      }),
    onSuccess: async () => {
      toast.success(t("mergeSuccess"));
      setPreview(null);
      setReason("");
      setConfirmText("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["account-reconciliation"] }),
        qc.invalidateQueries({ queryKey: ["users"] }),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className="mb-6 border-border">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="size-4 text-brand" />
            {t("reconciliationTitle")}
          </CardTitle>
          <p className="mt-1 text-xs text-fg-muted">{t("reconciliationSubtitle")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => dupsQ.refetch()} loading={dupsQ.isFetching}>
          {t("discoverDuplicates")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {dupsQ.data?.duplicates.length ? (
          <div className="space-y-2">
            {dupsQ.data.duplicates.map((pair, idx) => (
              <div key={idx} className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border bg-bg-subtle p-3 text-xs">
                <div className="space-y-1">
                  <Badge variant="warning">{pair.signal}</Badge>
                  <p className="font-medium text-fg">
                    {pair.accounts[0].name} ({pair.accounts[0].phone}) ↔ {pair.accounts[1].name} ({pair.accounts[1].phone})
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSourceId(pair.accounts[1].id);
                    setCanonicalId(pair.accounts[0].id);
                    setPreview(null);
                  }}
                >
                  {t("previewMerge")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-muted">{t("noDuplicates")}</p>
        )}

        <div className="rounded-field border border-border p-3 space-y-3">
          <p className="text-xs font-semibold text-fg">{t("manualCompare")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={sourceId}
              onChange={(e) => { setSourceId(e.target.value); setPreview(null); }}
              placeholder={t("sourceAccount")}
              aria-label={t("sourceAccount")}
            />
            <Input
              value={canonicalId}
              onChange={(e) => { setCanonicalId(e.target.value); setPreview(null); }}
              placeholder={t("canonicalAccount")}
              aria-label={t("canonicalAccount")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={verifiedOwnership}
                onChange={(e) => { setVerifiedOwnership(e.target.checked); setPreview(null); }}
              />
              {t("verifiedOwnershipLabel")}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={transferTelegram}
                onChange={(e) => { setTransferTelegram(e.target.checked); setPreview(null); }}
              />
              {t("transferTelegramLabel")}
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!sourceId.trim() || !canonicalId.trim()}
              loading={previewMut.isPending}
              onClick={() => previewMut.mutate()}
            >
              {t("previewMerge")}
            </Button>
          </div>
        </div>

        {preview && (
          <div className="space-y-3 rounded-field border border-border bg-surface p-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: t("sourceAccount"), data: preview.source },
                { label: t("canonicalAccount"), data: preview.canonical },
              ].map(({ label, data }) => (
                <div key={data.id} className="rounded-field border border-border bg-bg-subtle p-3 space-y-1">
                  <p className="font-semibold text-fg">{label}</p>
                  <p className="text-sm font-bold text-fg">{data.name}</p>
                  <p className="text-fg-muted">{data.phone} {data.email ? `· ${data.email}` : ""}</p>
                  <p className="text-fg-muted">
                    Groups: {data.memberships.length} · Exams: {data.counts.mockAttempts} · Payments: {data.counts.payments} · Attendance: {data.counts.attendance}
                  </p>
                </div>
              ))}
            </div>

            {preview.blockers.length > 0 && (
              <div role="alert" className="rounded-field border border-danger-border bg-danger-bg p-3 text-danger space-y-1">
                <p className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="size-4" />
                  {t("mergeBlockers")}
                </p>
                {preview.blockers.map((b) => (
                  <p key={b.code}>• {b.message}</p>
                ))}
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="rounded-field border border-warning-border bg-warning-bg p-3 text-warning space-y-1">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="size-4" />
                  {t("mergeWarnings")}
                </p>
                {preview.warnings.map((w) => (
                  <p key={w.code}>• {w.message}</p>
                ))}
              </div>
            )}

            {preview.canMerge && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="flex items-center gap-1.5 font-semibold text-success">
                  <CheckCircle2 className="size-4" />
                  {preview.identityBasis}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("mergeReason")}
                    aria-label={t("mergeReason")}
                  />
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={t("mergeConfirmWord")}
                    aria-label={t("mergeConfirmWord")}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={confirmText.trim().toUpperCase() !== "MERGE" || reason.trim().length < 5}
                  loading={mergeMut.isPending}
                  onClick={() => mergeMut.mutate()}
                >
                  <GitMerge className="size-4" />
                  {t("confirmMerge")}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-border pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg">
            <History className="size-3.5" />
            {t("mergeHistory")}
          </p>
          {!dupsQ.data?.history.length ? (
            <p className="text-xs text-fg-muted">{t("noMergeHistory")}</p>
          ) : (
            <ul className="space-y-1 text-xs text-fg-muted">
              {dupsQ.data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-bg-subtle px-2.5 py-1.5">
                  <span>{h.sourceUserId.slice(0, 8)} → {h.canonicalUserId.slice(0, 8)} · {h.reason}</span>
                  <span>{h.actorName} · {h.identityBasis}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
