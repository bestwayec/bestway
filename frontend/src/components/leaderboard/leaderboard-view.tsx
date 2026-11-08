"use client";

import { Star, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { useLeaderboard } from "@/hooks/use-leaderboard";
import { useMe } from "@/hooks/use-me";
import { cn, initials } from "@/lib/utils";

const RANK_STYLE: Record<number, string> = {
  1: "bg-warning-bg text-warning border-warning-border",
  2: "bg-bg-subtle text-fg-muted border-border-strong",
  3: "bg-[#f5e0c3] text-[#8a5a1c] border-[#e0c49a]",
};

export function LeaderboardView() {
  const t = useTranslations("points");
  const tc = useTranslations("common");
  const { data, isLoading, isError, refetch } = useLeaderboard();
  const { data: me } = useMe();

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("leaderboard")} />

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
      ) : rows.length === 0 ? (
        <EmptyState icon={Trophy} title={tc("empty")} />
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((r) => {
            const isSelf = me?.user.id === r.studentId;
            return (
              <div
                key={r.studentId}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  isSelf && "bg-brand-subtle/30",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold tabular-nums",
                    RANK_STYLE[r.rank] ?? "border-border bg-surface text-fg-muted",
                  )}
                >
                  {r.rank}
                </span>
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-xs font-semibold text-fg-muted">
                  {initials(r.name)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {r.name}
                  {isSelf && <span className="ml-2 text-xs text-brand">({t("you")})</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1 font-semibold text-fg tabular-nums">
                  <Star className="size-4 text-brand" />
                  {r.points}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
