"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { ExportButton } from "@/components/app/export-button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid/data-grid";
import { ApiError } from "@/lib/api-client";
import { StateCell, type CellTone } from "@/components/data-grid/state-cell";
import {
  PaymentCellDialog,
  type PaymentCellTarget,
} from "@/components/payments/payment-cell-dialog";
import { DebtorsCard } from "@/components/payments/debtors-card";
import { useGroups, useGroupDetail } from "@/hooks/use-groups";
import { useMe } from "@/hooks/use-me";
import { usePayments, useSavePaymentCell, type PaymentCellChange } from "@/hooks/use-payments";
import { useSettings } from "@/hooks/use-settings";
import type { PaymentRow, PaymentState } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

const TONE: Record<PaymentState, CellTone> = {
  paid: "success",
  partial: "warning",
  unpaid: "danger",
  // Empty = yozuv yo'q: neytral (davomat panelidagi empty/blank kabi)
  empty: "neutral",
};

/** Tsikl: Empty → Paid → Partially Paid → Unpaid → Empty (yozuv yo'qligi = Empty) */
function nextState(cur?: PaymentState): PaymentState {
  if (cur === "paid") return "partial";
  if (cur === "partial") return "unpaid";
  if (cur === "unpaid") return "empty";
  return "paid";
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function PaymentsPanel() {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const tMonthsShort = useTranslations("monthsShort");
  const params = useSearchParams();

  const groupsQ = useGroups();
  const settingsQ = useSettings();
  const [groupId, setGroupId] = React.useState<string>("");
  const [year, setYear] = React.useState<number>(new Date().getFullYear());
  const [target, setTarget] = React.useState<PaymentCellTarget | null>(null);

  const wantedGroup = params.get("group");
  const fallbackGroupId =
    groupsQ.data && groupsQ.data.length > 0
      ? wantedGroup && groupsQ.data.some((g) => g.id === wantedGroup)
        ? wantedGroup
        : groupsQ.data[0].id
      : "";
  const activeGroupId = groupId || fallbackGroupId;

  const detailQ = useGroupDetail(activeGroupId || undefined);
  const paymentsQ = usePayments(year);
  // CSV eksport backend'da admin-only — o'qituvchiga tugmani ko'rsatmaymiz
  const { data: me } = useMe();
  const canExport = me?.user.role === "admin" || me?.user.role === "super_admin";
  const save = useSavePaymentCell(year);
  const monthlyFee = settingsQ.data?.monthlyFee ?? 0;

  const students = detailQ.data?.students ?? [];
  const currentMonth = React.useMemo(() => new Date().getMonth() + 1, []);
  const currentYear = React.useMemo(() => new Date().getFullYear(), []);

  const studentsById = React.useMemo(() => new Map(students.map((s) => [s.studentId, s])), [students]);

  const rows = React.useMemo(
    () =>
      students.map((s) => ({
        id: s.studentId,
        header: (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{s.name}</span>
            {!s.isActive && (
              <Badge variant="neutral" className="shrink-0">
                {tc("blocked")}
              </Badge>
            )}
          </span>
        ),
      })),
    [students, tc],
  );

  // "studentId|month" -> PaymentRow
  const rowMap = React.useMemo(() => {
    const map = new Map<string, PaymentRow>();
    for (const r of paymentsQ.data ?? []) map.set(`${r.studentId}|${r.month}`, r);
    return map;
  }, [paymentsQ.data]);

  const columns: DataGridColumn[] = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        return {
          id: String(m),
          width: 58,
          highlight: year === currentYear && m === currentMonth,
          header: tMonthsShort(String(m)),
        };
      }),
    [year, currentYear, currentMonth, tMonthsShort],
  );

  const commit = React.useCallback(
    (change: PaymentCellChange) => {
      save.mutate(change, {
        onError: (e) => {
          // Backend STUDENT_BLOCKED rad etsa — aniq sababni ko'rsatamiz
          if (e instanceof ApiError && e.code === "STUDENT_BLOCKED") {
            toast.error(tc("studentBlocked"));
            return;
          }
          toast.error(tc("unknownError"));
        },
      });
    },
    [save, tc],
  );

  const cycle = React.useCallback(
    (studentId: string, studentName: string, month: number) => {
      // Bloklangan o'quvchi: so'rov yubormaymiz — darhol xabardor qilamiz
      if (studentsById.get(studentId)?.isActive === false) {
        toast.error(tc("studentBlocked"));
        return;
      }
      const cur = rowMap.get(`${studentId}|${month}`);
      const state = nextState(cur?.state);
      // Unpaid → Empty: yozuv o'chiriladi (backend deleteMany), amount/note kerak emas
      if (state === "empty") {
        commit({ studentId, studentName, month, state });
        return;
      }
      let amount = cur?.amount ?? 0;
      if (state === "paid") amount = amount > 0 ? amount : monthlyFee;
      else if (state === "unpaid") amount = 0;
      commit({ studentId, studentName, month, state, amount, note: cur?.note ?? undefined });
    },
    [studentsById, rowMap, monthlyFee, commit, tc],
  );

  const renderCell = React.useCallback(
    (studentId: string, monthStr: string) => {
      const month = Number(monthStr);
      const student = studentsById.get(studentId);
      const row = rowMap.get(`${studentId}|${month}`);
      const tone: CellTone = row ? TONE[row.state] : "neutral";
      const title = row
        ? `${t(row.state)}${row.amount ? ` · ${formatMoney(row.amount)} ${tc("sum")}` : ""}${row.note ? ` · ${row.note}` : ""}`
        : t("notMarked");
      return (
        <StateCell
          tone={tone}
          title={title}
          onClick={() => cycle(studentId, student?.name ?? "", month)}
          onContextMenu={(e) => {
            e.preventDefault();
            setTarget({
              studentId,
              studentName: student?.name ?? "",
              month,
              state: row?.state,
              amount: row?.amount ?? 0,
              note: row?.note ?? null,
            });
          }}
        >
          <CellContent row={row} />
        </StateCell>
      );
    },
    [studentsById, rowMap, t, tc, cycle],
  );

  return (
    <div className="mx-auto max-w-full">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            {canExport && <ExportButton path={`/stats/export/payments?year=${year}`} />}
            {groupsQ.data && groupsQ.data.length > 0 && (
              <Select value={activeGroupId} onValueChange={setGroupId}>
                <SelectTrigger className="w-full min-w-[9rem] max-w-full sm:w-44" aria-label={tc("group")}>
                  <SelectValue placeholder={tc("group")} />
                </SelectTrigger>
                <SelectContent>
                  {groupsQ.data.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />

      {groupsQ.isError ? (
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => groupsQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : groupsQ.isLoading ? (
        <Skeleton className="h-72" />
      ) : (groupsQ.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Users} title={t("noPayments")} />
      ) : (
        <>
          {/* Yil navigatsiyasi */}
          <div className="mb-4 flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setYear((y) => y - 1)}
              aria-label={tc("back")}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-20 text-center text-sm font-semibold text-fg tabular-nums">
              {year}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setYear((y) => y + 1)}
              aria-label={tc("next")}
            >
              <ChevronRight />
            </Button>
          </div>

          {detailQ.isLoading || paymentsQ.isLoading ? (
            <Skeleton className="h-72" />
          ) : students.length === 0 ? (
            <EmptyState icon={Users} title={tc("empty")} />
          ) : (
            <>
              <DataGrid columns={columns} corner={tc("student")} rows={rows} renderCell={renderCell} />
              <p className="mt-3 text-xs text-fg-subtle">{t("subtitle")}</p>
            </>
          )}

          <div className="mt-6">
            <DebtorsCard year={year} month={currentMonth} />
          </div>
        </>
      )}

      <PaymentCellDialog
        target={target}
        onClose={() => setTarget(null)}
        defaultAmount={monthlyFee}
        onSave={(v) => {
          if (target) {
            commit({
              studentId: target.studentId,
              studentName: target.studentName,
              month: target.month,
              state: v.state,
              amount: v.amount,
              note: v.note,
            });
          }
          setTarget(null);
        }}
      />
    </div>
  );
}

function CellContent({ row }: { row?: PaymentRow }) {
  if (!row) return <span className="text-fg-subtle">·</span>;
  if (row.state === "unpaid") return <X />;
  if (row.amount > 0) return <span className="tabular-nums">{compact(row.amount)}</span>;
  return row.state === "paid" ? <Check /> : <span className="text-xs font-bold">½</span>;
}
