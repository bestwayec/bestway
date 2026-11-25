"use client";

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MockGroup } from "@/lib/types";

export function UnitGroupActions({ groups, select, add, busy, duplicate, move, reorder, targets }: {
  groups: MockGroup[];
  select: (id: string) => void;
  add?: () => void;
  busy: boolean;
  duplicate?: (groupId: string) => void;
  move?: (groupId: string, parentGroupId: string) => void;
  reorder?: (groupId: string, siblingId: string, before: boolean) => void;
  targets?: Array<{ id: string; label: string }>;
}) {
  const t = useTranslations("examBuilder");
  return <div className="flex flex-wrap gap-2 border-t border-border p-2">
    {groups.map((group, index) => {
      const previous = groups[index - 1];
      const next = groups[index + 1];
      return (
        <div key={group.id} className="flex flex-wrap items-center gap-1.5">
          {groups.length > 1 && <Button type="button" variant="outline" size="sm" onClick={() => select(group.id)}>
            {group.title || t("questions")}
          </Button>}
          {duplicate && <Button type="button" variant="outline" size="sm" disabled={busy}
            aria-label={t("duplicateUnitTaskGroup", { group: group.title || t("questions") })}
            onClick={() => duplicate(group.id)}>{t("duplicateUnitTaskGroupShort")}</Button>}
          {reorder && (
            <>
              {previous && <Button type="button" variant="ghost" size="sm" disabled={busy}
                aria-label={t("moveUnitTaskGroupUp", { group: group.title || t("questions") })}
                onClick={() => reorder(group.id, previous.id, true)}><ArrowUp className="size-4" aria-hidden /></Button>}
              {next && <Button type="button" variant="ghost" size="sm" disabled={busy}
                aria-label={t("moveUnitTaskGroupDown", { group: group.title || t("questions") })}
                onClick={() => reorder(group.id, next.id, false)}><ArrowDown className="size-4" aria-hidden /></Button>}
            </>
          )}
          {move && !!targets?.length && !group.passageText?.trim() && !group.hasAudio && (
            <select aria-label={t("moveUnitTaskGroup", { group: group.title ?? t("questions") })}
              className="h-8 max-w-48 rounded-field border border-border bg-surface px-1.5 text-xs"
              value="" disabled={busy} onChange={(event) => move(group.id, event.target.value)}>
              <option value="" disabled>{t("moveUnitTaskGroupShort")}</option>
              {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select>
          )}
        </div>
      );
    })}
    {add && <Button type="button" variant="outline" size="sm" loading={busy} onClick={add}>{t("addUnitTaskGroup")}</Button>}
  </div>;
}
