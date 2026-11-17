"use client";

import * as React from "react";
import { ScrollText, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { useAuditLogs } from "@/hooks/use-audit";
import { useDebouncedValue } from "@/hooks/use-users";
import type { AuditLogItem } from "@/lib/types";

function tone(action: string): "success" | "danger" | "warning" | "info" | "neutral" {
  if (action.includes("create")) return "success";
  if (action.includes("delete") || action.includes("deactivate")) return "danger";
  if (action.includes("update") || action.includes("set")) return "warning";
  if (action.includes("remind") || action.includes("broadcast")) return "info";
  return "neutral";
}

export function AuditView() {
  const t = useTranslations("audit");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search);
  const { data, isLoading, isError, refetch } = useAuditLogs(debounced);

  const items = data ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("filterAction")}
          className="pl-9"
        />
      </div>

      {isError ? (
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("empty")} />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((item) => (
            <AuditRow key={item.id} item={item} time={format.dateTime(new Date(item.createdAt), {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })} entityLabel={t("entity")} />
          ))}
        </Card>
      )}
    </div>
  );
}

function AuditRow({
  item,
  time,
  entityLabel,
}: {
  item: AuditLogItem;
  time: string;
  entityLabel: string;
}) {
  const hasDetails = item.oldValue != null || item.newValue != null;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={tone(item.action)}>{item.action}</Badge>
          <span className="truncate text-sm text-fg-muted">
            {item.entity}
            {item.entityId ? ` · ${item.entityId.slice(0, 8)}` : ""}
          </span>
        </div>
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">{time}</span>
      </div>
      {hasDetails && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-fg-subtle">{entityLabel}</summary>
          <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto rounded-chip bg-bg-subtle p-2 text-[11px] leading-relaxed text-fg-muted">
            {JSON.stringify({ old: item.oldValue, new: item.newValue }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
