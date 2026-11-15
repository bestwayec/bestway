"use client";

import { BellRing, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { useDebtors, useRemind } from "@/hooks/use-payments";
import { formatMoney, formatPhone } from "@/lib/utils";

export function DebtorsCard({ year, month }: { year: number; month: number }) {
  const t = useTranslations("payments");
  const tMonths = useTranslations("months");
  const tc = useTranslations("common");
  const debtorsQ = useDebtors(year, month);
  const remind = useRemind(year, month);

  const debtors = debtorsQ.data ?? [];

  function remindAll() {
    remind.mutate(undefined, {
      onSuccess: (res) => toast.success(t("reminderSent", { count: res.notified })),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle>{t("debtors")}</CardTitle>
          {debtors.length > 0 && <Badge variant="danger">{debtors.length}</Badge>}
          <span className="text-xs text-fg-subtle">{tMonths(String(month))}</span>
        </div>
        {debtors.length > 0 && (
          <Button size="sm" variant="outline" loading={remind.isPending} onClick={remindAll}>
            <BellRing />
            {t("sendReminder")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {debtorsQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : debtors.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-fg-muted">
            <CheckCircle2 className="size-4 text-success" />
            {tc("empty")}
          </div>
        ) : (
          <ul className="scrollbar-thin max-h-72 divide-y divide-border overflow-y-auto" tabIndex={0}>
            {debtors.map((d) => (
              <li key={d.studentId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{d.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {d.groupName ?? "—"} · {formatPhone(d.phone)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {d.amount > 0 && (
                    <span className="text-xs text-fg-muted tabular-nums">
                      {formatMoney(d.amount)}
                    </span>
                  )}
                  <Badge
                    variant={d.state === "partial" ? "warning" : d.state === "empty" ? "neutral" : "danger"}
                  >
                    {t(d.state)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
