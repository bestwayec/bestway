"use client";

import * as React from "react";
import { ExamTrackSelector } from '@/components/profile/exam-track-selector';
import { ArrowLeft, Ban, BookOpen, Check, Pencil, Sparkles, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { AdjustPointsDialog } from "@/components/students/adjust-points-dialog";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { useUserDetail, useApproveStudent, useDeactivateUser } from "@/hooks/use-users";
import { useMe } from "@/hooks/use-me";
import { usePoints } from "@/hooks/use-points";
import { useStudentAttendance } from "@/hooks/use-attendance";
import { useChildPayments } from "@/hooks/use-child";
import { useGroups } from "@/hooks/use-groups";
import type { AttendanceState, PaymentState } from "@/lib/types";
import { cn, currentMonthKey, formatPhone } from "@/lib/utils";

const ATT_TONE: Record<AttendanceState, string> = {
  present: "text-success",
  absent: "text-danger",
  late: "text-warning",
  empty: "text-fg-subtle",
  blank: "text-fg-subtle",
};
const PAY_TONE: Record<PaymentState, string> = {
  paid: "bg-success-bg text-success border-success-border",
  partial: "bg-warning-bg text-warning border-warning-border",
  unpaid: "bg-danger-bg text-danger border-danger-border",
  empty: "border-border bg-surface text-fg-subtle",
};

export function StudentDetailView({ studentId }: { studentId: string }) {
  const t = useTranslations("student");
  const tc = useTranslations("common");
  const tp = useTranslations("points");
  const tpay = useTranslations("payments");
  const tatt = useTranslations("attendance");
  const tMonthsShort = useTranslations("monthsShort");

  const userQ = useUserDetail(studentId);
  const pointsQ = usePoints(studentId);
  const groupsQ = useGroups();
  const approve = useApproveStudent();
  const deactivate = useDeactivateUser();
  const { data: me } = useMe();
  const isSuper = me?.user.role === "super_admin";
  const router = useRouter();
  const tst = useTranslations("staff");
  const [adjustOpen, setAdjustOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);

  const user = userQ.data;
  const groupId = user?.student?.groupId ?? undefined;

  const month = currentMonthKey();
  const year = new Date().getFullYear();
  const attQ = useStudentAttendance(groupId, studentId, month);
  const payQ = useChildPayments(studentId, year);

  if (userQ.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => userQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (userQ.isLoading || !user) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const att = { present: 0, absent: 0, late: 0 } as Record<Exclude<AttendanceState, "empty" | "blank">, number>;
  for (const r of attQ.data ?? []) {
    if (r.state === "empty" || r.state === "blank") continue;
    att[r.state as Exclude<AttendanceState, "empty" | "blank">]++;
  }
  const attTotal = att.present + att.absent + att.late;
  const attRate = attTotal > 0 ? Math.round(((att.present + att.late) / attTotal) * 100) : null;

  const payByMonth = new Map<number, PaymentState>();
  for (const r of payQ.data ?? []) payByMonth.set(r.month, r.state);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/students"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {tc("students")}
      </Link>

      {/* Sarlavha */}
      <ExamTrackSelector studentId={studentId} />
      <Card className="mb-4 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-fg">{user.name}</h1>
              <p className="text-sm text-fg-muted">{formatPhone(user.phone)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-sm text-fg-muted">
                  <BookOpen className="size-3.5" />
                  {user.student?.groupName ?? t("noGroup")}
                </span>
                {user.student?.isApproved ? (
                  <Badge variant="success">{t("approved")}</Badge>
                ) : (
                  <Badge variant="warning">{t("notApproved")}</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-2xl font-bold text-fg tabular-nums">
              <Star className="size-5 text-brand" />
              {user.student?.currentPoints ?? 0}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button size="sm" onClick={() => setAdjustOpen(true)}>
            <Sparkles />
            {tp("adjust")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil />
            {tc("edit")}
          </Button>
          {!user.student?.isApproved && (
            <Button
              size="sm"
              variant="subtle"
              loading={approve.isPending}
              onClick={() =>
                approve.mutate(studentId, {
                  onSuccess: () => toast.success(t("approved")),
                  onError: () => toast.error(tc("unknownError")),
                })
              }
            >
              <Check />
              {tc("confirm")}
            </Button>
          )}
          {isSuper && user.isActive && user.id !== me?.user.id && user.role !== "super_admin" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger hover:bg-danger-bg"
              loading={deactivate.isPending}
              onClick={() => {
                if (!confirm(tst("deactivateConfirm"))) return;
                deactivate.mutate(studentId, {
                  onSuccess: () => {
                    toast.success(tst("deactivated"));
                    router.push("/students");
                  },
                  onError: () => toast.error(tc("unknownError")),
                });
              }}
            >
              <Ban />
              {tst("deactivate")}
            </Button>
          )}
          {!user.isActive && <Badge variant="danger">{tst("inactive")}</Badge>}
        </div>
      </Card>

      {/* Davomat + to'lov */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{tatt("title")}</CardTitle>
            {attRate !== null && <span className="text-sm font-semibold text-fg">{attRate}%</span>}
          </CardHeader>
          <CardContent>
            {attQ.isLoading ? (
              <Skeleton className="h-14" />
            ) : attTotal === 0 ? (
              <p className="text-sm text-fg-muted">{tatt("notMarked")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:gap-2 max-[360px]:grid-cols-1">
                {(["present", "absent", "late"] as const).map((s) => (
                  <div key={s} className="rounded-[8px] bg-bg-subtle px-2 py-2 text-center">
                    <p className={cn("text-lg font-bold tabular-nums", ATT_TONE[s])}>{att[s]}</p>
                    <p className="text-[11px] text-fg-muted">{tatt(s)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{tpay("title")}</CardTitle>
            <span className="text-xs text-fg-muted tabular-nums">{year}</span>
          </CardHeader>
          <CardContent>
            {payQ.isLoading ? (
              <Skeleton className="h-14" />
            ) : (
              <div className="grid grid-cols-6 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1;
                  const state = payByMonth.get(m);
                  return (
                    <span
                      key={m}
                      title={`${tMonthsShort(String(m))} · ${state ? tpay(state) : tpay("notMarked")}`}
                      className={cn(
                        "flex h-7 items-center justify-center rounded-[6px] border text-[10px] font-semibold",
                        state ? PAY_TONE[state] : "border-border bg-surface text-fg-subtle",
                      )}
                    >
                      {tMonthsShort(String(m)).slice(0, 1)}
                    </span>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ball tarixi */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{tp("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {pointsQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (pointsQ.data?.history.length ?? 0) === 0 ? (
            <EmptyState title={tp("noHistory")} className="border-0 py-6" />
          ) : (
            <ul className="scrollbar-thin max-h-96 divide-y divide-border overflow-y-auto">
              {pointsQ.data!.history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-fg">{h.reason}</p>
                    <p className="text-xs text-fg-subtle">{h.byUserName ?? tp("system")}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-bold tabular-nums",
                      h.change >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {h.change >= 0 ? "+" : ""}
                    {h.change}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AdjustPointsDialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        studentId={studentId}
        studentName={user.name}
      />
      <UserFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editUser={user}
        roleOptions={["student"]}
        groups={groupsQ.data ?? []}
      />
    </div>
  );
}
