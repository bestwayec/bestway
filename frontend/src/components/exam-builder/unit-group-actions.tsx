"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MockGroup } from "@/lib/types";

export function UnitGroupActions({ groups, select, add, busy, move, targets }: {
  groups: MockGroup[];
  select: (id: string) => void;
  add?: () => void;
  busy: boolean;
  move?: (groupId: string, parentGroupId: string) => void;
  targets?: Array<{ id: string; label: string }>;
}) {
  const t = useTranslations("examBuilder");
  return <div className="flex flex-wrap gap-2 border-t border-border p-2">
    {groups.map((group) => (
      <div key={group.id} className="flex items-center gap-1.5">
        {groups.length > 1 && <Button type="button" variant="outline" size="sm" onClick={() => select(group.id)}>
          {group.title || t("questions")}
        </Button>}
        {move && !!targets?.length && !group.passageText?.trim() && !group.hasAudio && (
          <select aria-label={t("moveUnitTaskGroup", { group: group.title ?? t("questions") })}
            className="h-8 max-w-48 rounded-field border border-border bg-surface px-1.5 text-xs"
            value="" disabled={busy} onChange={(event) => move(group.id, event.target.value)}>
            <option value="" disabled>{t("moveUnitTaskGroupShort")}</option>
            {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
          </select>
        )}
      </div>
    ))}
    {add && <Button type="button" variant="outline" size="sm" loading={busy} onClick={add}>{t("addUnitTaskGroup")}</Button>}
  </div>;
}
