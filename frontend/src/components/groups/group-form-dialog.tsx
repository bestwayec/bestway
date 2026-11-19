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
import type { GroupDetail, GroupListItem, ScheduleItem, WeekDay } from "@/lib/types";

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
            {isEdit
              ? isTeacher
                ? "Guruh nomini tahrirlash"
                : t("edit")
              : isTeacher
                ? "Yangi guruh yaratish"
                : t("create")}
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

  const teachersQ = useTeachers(!isTeacher);
  const create = useCreateGroup();
  const update = useUpdateGroup(group?.id ?? "");
  const pending = create.isPending || update.isPending;

  const sched = group?.schedule ?? [];
  const [name, setName] = React.useState(group?.name ?? "");
  const [teacherId, setTeacherId] = React.useState(group?.teacherId ?? "none");
  const tm = useTranslations("classroomManagement");
  const [schedule, setSchedule] = React.useState<ScheduleItem[]>(sched);
  function editSlot(index: number, slot: Partial<ScheduleItem>) {
    setSchedule(previous => previous.map((current, item) => item === index ? { ...current, ...slot } : current));
  }

  function submit() {
    const trimmed = name.trim();
    if (trimmed.length < 2 || schedule.some(slot => !slot.startTime || !slot.endTime || slot.startTime > slot.endTime)) return;

    const onSettled = {
      onSuccess: () => {
        toast.success(isEdit ? (isTeacher ? "Guruh nomi muvaffaqiyatli saqlandi" : t("updated")) : t("created"));
        onClose();
      },
      onError: (err: any) => {
        const msg =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          tc("unknownError");
        toast.error(msg);
      },
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
        {
          name: trimmed,
          ...(!isTeacher && teacherId !== "none" ? { teacherId } : {}),
          schedule,
        },
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

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("schedule")}</legend>
          {schedule.map((slot, index) => (
            <div className="flex flex-wrap items-end gap-2" key={index}>
              <label className="grid gap-1 text-sm">{tm("day")}
                <select className="rounded-field border border-border bg-surface p-2" value={slot.day} onChange={event => editSlot(index, { day: event.target.value as WeekDay })}>
                  {DAYS.map(day => <option value={day} key={day}>{tw(day)}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">{t("startTime")}
                <Input type="time" value={slot.startTime} onChange={event => editSlot(index, { startTime: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">{t("endTime")}
                <Input type="time" value={slot.endTime} onChange={event => editSlot(index, { endTime: event.target.value })} />
              </label>
              <Button type="button" variant="outline" onClick={() => setSchedule(previous => previous.filter((_, item) => item !== index))}>{tm("removeSlot")}</Button>
            </div>
          ))}
          <Button type="button" variant="outline" disabled={schedule.length >= 28} onClick={() => setSchedule(previous => [...previous, { day: "mon", startTime: "09:00", endTime: "10:00" }])}>{tm("addSlot")}</Button>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={pending} disabled={name.trim().length < 2 || schedule.some(slot => !slot.startTime || !slot.endTime || slot.startTime > slot.endTime)}>
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
