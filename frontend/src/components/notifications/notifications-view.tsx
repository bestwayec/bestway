"use client";

import * as React from "react";
import { Bell, CalendarCheck, CheckCheck, FileCheck2, Gamepad2, Megaphone, Star, Wallet } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { BroadcastDialog } from "@/components/notifications/broadcast-dialog";
import { useNotifications, useMarkAllRead, useMarkRead } from "@/hooks/use-notifications";
import { useMe } from "@/hooks/use-me";
import type { NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  points: Star,
  payment_reminder: Wallet,
  test_result: FileCheck2,
  attendance: CalendarCheck,
  announcement: Megaphone,
  game: Gamepad2,
};

export function NotificationsView() {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const tb = useTranslations("broadcast");
  const format = useFormatter();
  // `relativeTime` requires an explicit reference point, otherwise next-intl falls back to
  // `Date.now()` on every call (ENVIRONMENT_FALLBACK). Anchor one value per mount so every
  // row in the list is measured against the same instant as the fetch that produced it.
  const [now] = React.useState(() => new Date());
  const { data, isLoading, isError, refetch } = useNotifications();
  const { data: me } = useMe();
  const markAll = useMarkAllRead();
  const markOne = useMarkRead();
  const [broadcastOpen, setBroadcastOpen] = React.useState(false);

  const isOffice = me?.user.role === "admin" || me?.user.role === "super_admin";
  const items = data ?? [];
  const unread = items.filter((n) => !n.read).length;

  // Opening the page counts as reading it (O4): mark everything read once so the bell
  // badge clears, but keep this visit's "new" highlight from the first loaded snapshot.
  const [freshIds, setFreshIds] = React.useState<Set<string> | null>(null);
  const autoMarked = React.useRef(false);
  const markAllMutate = markAll.mutate;
  React.useEffect(() => {
    if (!data || autoMarked.current) return;
    autoMarked.current = true;
    const fresh = new Set(data.filter((n) => !n.read).map((n) => n.id));
    setFreshIds(fresh);
    if (fresh.size > 0) markAllMutate();
  }, [data, markAllMutate]);
  const isNew = (n: { id: string; read: boolean }) => !n.read || Boolean(freshIds?.has(n.id));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t("title")}
        description={(freshIds?.size ?? unread) > 0 ? t("unread", { count: freshIds?.size ?? unread }) : undefined}
        actions={
          <div className="flex items-center gap-2">
            {isOffice && (
              <Button variant="outline" size="sm" onClick={() => setBroadcastOpen(true)}>
                <Megaphone />
                {tb("title")}
              </Button>
            )}
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                loading={markAll.isPending}
                onClick={() => markAll.mutate()}
              >
                <CheckCheck />
                {t("markAllRead")}
              </Button>
            )}
          </div>
        }
      />

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
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={t("empty")} />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => !n.read && markOne.mutate(n.id)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover",
                  isNew(n) && "bg-brand-subtle/20",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full",
                    isNew(n) ? "bg-brand-subtle text-brand-subtle-fg" : "bg-bg-subtle text-fg-muted",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm text-fg", isNew(n) && "font-medium")}>{n.text}</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {format.relativeTime(new Date(n.date), now)}
                  </p>
                </div>
                {isNew(n) && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-hidden />}
              </button>
            );
          })}
        </Card>
      )}

      <BroadcastDialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </div>
  );
}
