"use client";

import * as React from "react";
import { BookOpen, Link2, Star, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { useMe } from "@/hooks/use-me";
import { useChildAttendance, useChildPayments, useLinkChild } from "@/hooks/use-child";
import type { AttendanceState, ChildSummary, ParentSelfProfile, PaymentState } from "@/lib/types";
import { cn, currentMonthKey } from "@/lib/utils";

export function ChildrenView() {
  const t = useTranslations("parent");
  const params = useSearchParams();

  const { data: me, isLoading } = useMe();
  const profile = me?.profile && "children" in me.profile ? (me.profile as ParentSelfProfile) : null;
  const children = profile?.children ?? [];

  const [childId, setChildId] = React.useState<string>("");

  const wantedChild = params.get("child");
  const fallbackChildId =
    children.length > 0
      ? wantedChild && children.some((c) => c.studentId === wantedChild)
        ? wantedChild
        : children[0].studentId
      : "";
  const activeChildId = childId || fallbackChildId;

  const selected = children.find((c) => c.studentId === activeChildId);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t("children")} />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("children")} description={t("readOnlyNotice")} />

      {children.length === 0 ? (
        <>
          <EmptyState icon={Users} title={t("noChildren")} description={t("noChildrenHint")} />
          <div className="mt-4">
            <LinkChildForm />
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {children.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {children.map((c) => (
                <button
                  key={c.studentId}
                  type="button"
                  onClick={() => setChildId(c.studentId)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    c.studentId === activeChildId
                      ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                      : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {selected && <ChildDetail child={selected} />}

          <LinkChildForm />
        </div>
      )}
    </div>
  );
}

function ChildDetail({ child }: { child: ChildSummary }) {
  const ts = useTranslations("student");

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-fg">{child.name}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
              <BookOpen className="size-4" />
              {child.groupName ?? ts("noGroup")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="flex items-center gap-1.5 text-lg font-bold text-fg tabular-nums">
              <Star className="size-4 text-brand" />
              {child.currentPoints}
            </span>
            {child.isApproved ? (
              <Badge variant="success">{ts("approved")}</Badge>
            ) : (
              <Badge variant="warning">{ts("notApproved")}</Badge>
            )}
          </div>
        </div>
      </Card>

      <ChildAttendance studentId={child.studentId} />
      <ChildPayments studentId={child.studentId} />
    </>
  );
}

const ATT_TONE: Record<AttendanceState, string> = {
  present: "text-success",
  absent: "text-danger",
  late: "text-warning",
  empty: "text-fg-subtle",
  blank: "text-fg-subtle",
};

function ChildAttendance({ studentId }: { studentId: string }) {
  const t = useTranslations("attendance");
  const month = currentMonthKey();
  const { data, isLoading } = useChildAttendance(studentId, month);

  const counts = React.useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, empty: 0, blank: 0 } as Record<AttendanceState, number> & { present: number; absent: number; late: number };
    for (const r of data ?? []) {
      if (r.state === "empty" || r.state === "blank") continue;
      c[r.state]++;
    }
    return { present: c.present, absent: c.absent, late: c.late };
  }, [data]);
  const total = counts.present + counts.absent + counts.late;
  const rate = total > 0 ? Math.round(((counts.present + counts.late) / total) * 100) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t("title")}</CardTitle>
        {rate !== null && <span className="text-sm font-semibold text-fg">{rate}%</span>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10" />
        ) : total === 0 ? (
          <p className="text-sm text-fg-muted">{t("notMarked")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["present", "absent", "late"] as const).map((state) => (
              <div key={state} className="rounded-field bg-bg-subtle px-3 py-2 text-center">
                <p className={cn("text-xl font-bold tabular-nums", ATT_TONE[state])}>
                  {counts[state]}
                </p>
                <p className="text-xs text-fg-muted">{t(state)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PAY_TONE: Record<PaymentState, string> = {
  paid: "bg-success-bg text-success border-success-border",
  partial: "bg-warning-bg text-warning border-warning-border",
  unpaid: "bg-danger-bg text-danger border-danger-border",
  empty: "border-border bg-surface text-fg-subtle",
};

function ChildPayments({ studentId }: { studentId: string }) {
  const tp = useTranslations("payments");
  const tMonthsShort = useTranslations("monthsShort");
  const year = new Date().getFullYear();
  const { data, isLoading } = useChildPayments(studentId, year);

  const byMonth = React.useMemo(() => {
    const m = new Map<number, PaymentState>();
    for (const r of data ?? []) m.set(r.month, r.state);
    return m;
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{tp("title")}</CardTitle>
        <span className="text-sm text-fg-muted tabular-nums">{year}</span>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {Array.from({ length: 12 }, (_, i) => {
              const m = i + 1;
              const state = byMonth.get(m);
              return (
                <div key={m} className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-chip border text-[10px] font-semibold",
                      state ? PAY_TONE[state] : "border-border bg-surface text-fg-subtle",
                    )}
                    title={state ? tp(state) : tp("notMarked")}
                  >
                    {state === "paid" ? "✓" : state === "partial" ? "½" : state === "unpaid" ? "✕" : "·"}
                  </span>
                  <span className="text-[10px] text-fg-subtle">{tMonthsShort(String(m))}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkChildForm() {
  const t = useTranslations("parent");
  const tc = useTranslations("common");
  const link = useLinkChild();
  const [code, setCode] = React.useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 4) return;
    link.mutate(code.trim(), {
      onSuccess: () => {
        toast.success(tc("saved"));
        setCode("");
      },
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Link2 className="size-4 text-brand" />
        <p className="text-sm font-medium text-fg">{t("addChild")}</p>
      </div>
      <form onSubmit={submit} className="flex items-end gap-2">
        <Field label={t("linkCodeLabel")} className="flex-1" htmlFor="linkCode">
          <Input
            id="linkCode"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("linkCodePlaceholder")}
            maxLength={8}
            className="tracking-[0.2em]"
            autoComplete="off"
          />
        </Field>
        <Button type="submit" loading={link.isPending} disabled={code.trim().length < 4}>
          {t("linkChild")}
        </Button>
      </form>
    </Card>
  );
}
