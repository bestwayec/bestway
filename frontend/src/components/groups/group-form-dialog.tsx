"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateGroup, useUpdateGroup } from "@/hooks/use-groups";
import { useTeachers } from "@/hooks/use-users";
import { useMe } from "@/hooks/use-me";
import type { GroupDetail, GroupListItem, WeekDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS: WeekDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function GroupFormDialog({
  group,
  open,
  onClose,
}: {
  group: GroupListItem | GroupDetail | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("groups");
  const { data: me } = useMe();
  const isTeacher = me?.user.role === "teacher";
  const isEdit = !!group;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? (isTeacher ? "Guruh nomini tahrirlash" : t("edit")) : t("create")}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <GroupFormFields
            key={group?.id ?? "new"}
            group={group}
            isTeacher={isTeacher}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GroupFormFields({
  group,
  isTeacher,
  onClose,
}: {
  group: GroupListItem | GroupDetail | null;
  isTeacher?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdaysShort");
  const isEdit = !!group;

  const teachersQ = useTeachers();
  const create = useCreateGroup();
  const update = useUpdateGroup(group?.id ?? "");
  const pending = create.isPending || update.isPending;

  const sched = group?.schedule ?? [];
  const [name, setName] = React.useState(group?.name ?? "");
  const [teacherId, setTeacherId] = React.useState(group?.teacherId ?? "none");
  const [days, setDays] = React.useState<Set<string>>(new Set(sched.map((s) => s.day)));
  const [start, setStart] = React.useState(sched[0]?.startTime ?? "");
  const [end, setEnd] = React.useState(sched[0]?.endTime ?? "");

  function toggleDay(d: string) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    const schedule =
      start && end ? [...days].map((day) => ({ day: day as WeekDay, startTime: start, endTime: end })) : [];

    const onSettled = {
      onSuccess: () => {
        toast.success(isEdit ? t("updated") : t("created"));
        onClose();
      },
      onError: () => toast.error(tc("unknownError")),
    };

    if (isEdit) {
      if (isTeacher) {
        update.mutate({ name: trimmed, schedule }, onSettled);
      } else {
        update.mutate(
          { name: trimmed, teacherId: teacherId === "none" ? null : teacherId, schedule },
          onSettled,
        );
      }
    } else {
      create.mutate(
        { name: trimmed, ...(teacherId !== "none" ? { teacherId } : {}), schedule },
        onSettled,
      );
    }
  }

  return (
    <>
      <DialogBody className="space-y-4">
        <Field label={t("name")} htmlFor="gname">
          <Input
            id="gname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            autoFocus
          />
        </Field>

        {!isTeacher && (
          <Field label={t("teacher")}>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("noTeacher")}</SelectItem>
                {(teachersQ.data ?? []).map((tch) => (
                  <SelectItem key={tch.id} value={tch.id}>
                    {tch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label={t("schedule")}>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.has(d)}
                className={cn(
                  "size-9 rounded-[8px] border text-xs font-medium capitalize transition-colors",
                  days.has(d)
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                )}
              >
                {tw(d)}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("startTime")} htmlFor="gstart">
            <Input id="gstart" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t("endTime")} htmlFor="gend">
            <Input id="gend" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={pending} disabled={name.trim().length < 2}>
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
