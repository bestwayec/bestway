"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

type Shares = {
  teachers: { id: string; name: string; shared: boolean }[];
  inactiveShares: string[];
};

export function PracticeResultSharing({ attemptId }: { attemptId: string }) {
  const t = useTranslations("practiceSharing");
  const endpoint = `/mock/attempts/${encodeURIComponent(attemptId)}/practice-shares`;
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: ["practice-result-shares", attemptId],
    queryFn: () => api.get<Shares>(endpoint),
    enabled: open,
  });
  const update = useMutation({
    mutationFn: ({ teacherId, shared }: { teacherId: string; shared: boolean }) => api.put<Shares>(endpoint, { teacherId, shared }),
    onSuccess: () => status.refetch(),
  });
  return (
    <details className="mt-4 rounded-card border border-border bg-surface p-4 print:hidden" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold text-fg">{t("title")}</summary>
      {status.isPending && open && <p className="mt-2 text-sm text-fg-muted" role="status">{t("loading")}</p>}
      {(status.isError || update.isError) && <p className="mt-2 text-sm text-fg-muted" role="alert">{t("failed")}</p>}
      {status.data && (
        <ul className="mt-2 space-y-2">
          {status.data.teachers.map((teacher) => (
            <li key={teacher.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-fg">{teacher.name}</span>
              <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({
                teacherId: teacher.id,
                shared: !teacher.shared,
              })}>{t(teacher.shared ? "revoke" : "allow")}</Button>
            </li>
          ))}
          {status.data.inactiveShares.map((teacherId) => (
            <li key={teacherId} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-fg-muted">{t("former")}</span>
              <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({
                teacherId, shared: false,
              })}>{t("revoke")}</Button>
            </li>
          ))}
          {!status.data.teachers.length && !status.data.inactiveShares.length && (
            <li className="text-sm text-fg-muted">{t("empty")}</li>
          )}
        </ul>
      )}
    </details>
  );
}
