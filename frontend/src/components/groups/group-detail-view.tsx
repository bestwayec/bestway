"use client";

import * as React from "react";
import {
  ArrowLeft,
  CalendarClock,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  User,
  UserMinus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { GroupFormDialog } from "@/components/groups/group-form-dialog";
import { AdjustPointsDialog } from "@/components/students/adjust-points-dialog";
import {
  useAddStudentToGroup,
  useGroupDetail,
  useRemoveStudentFromGroup,
} from "@/hooks/use-groups";
import { useStudents, useDebouncedValue } from "@/hooks/use-users";
import { useSettings } from "@/hooks/use-settings";
import { useMe } from "@/hooks/use-me";
import { formatPhone } from "@/lib/utils";
import { GroupAiRanking } from "@/components/teacher/group-ai-ranking";

export function GroupDetailView({ groupId }: { groupId: string }) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const tw = useTranslations("weekdaysShort");
  const { data: group, isLoading, isError, refetch } = useGroupDetail(groupId);
  const removeStudent = useRemoveStudentFromGroup(groupId);
  const addStudent = useAddStudentToGroup(groupId);
  const { data: me } = useMe();
  const settingsQ = useSettings();
  const [editOpen, setEditOpen] = React.useState(false);
  const [pointsTarget, setPointsTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search);
  const picker = useStudents(debounced);

  const isOffice = me?.user.role === "admin" || me?.user.role === "super_admin";
  const canSeePhones =
    me?.user.role === "teacher" || me?.user.role === "admin" || me?.user.role === "super_admin";
  const teacherLimit = me?.user.role === "teacher" ? settingsQ.data?.teacherPointLimit : undefined;

  const memberIds = new Set((group?.students ?? []).map((s) => s.studentId));
  const candidates = (picker.data ?? []).filter((u) => !memberIds.has(u.id)).slice(0, 6);

  function onAdd(studentId: string) {
    addStudent.mutate(studentId, {
      onSuccess: () => {
        toast.success(t("studentAdded"));
        setSearch("");
      },
      onError: () => toast.error(tc("unknownError")),
    });
  }

  function onRemove(studentId: string) {
    removeStudent.mutate(studentId, {
      onSuccess: () => toast.success(t("studentRemoved")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }

  if (isLoading || !group) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const days = [...new Set((group.schedule ?? []).map((s) => s.day))].map((d) => tw(d)).join(", ");
  const time = group.schedule?.[0] ? `${group.schedule[0].startTime}–${group.schedule[0].endTime}` : "";

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/groups"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {t("title")}
      </Link>

      <Card className="mb-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-fg">{group.name}</h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-fg-muted">
              <User className="size-4" />
              {group.teacherName ?? t("noTeacher")}
            </p>
            {time && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
                <CalendarClock className="size-4" />
                {days} · {time}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil />
            {t("edit")}
          </Button>
        </div>
      </Card>

      {canSeePhones && <GroupAiRanking groupId={groupId} />}

      {/* O'quvchi qo'shish */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Plus className="size-4 text-brand" />
            {t("addStudent")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchStudent")}
              className="pl-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {debounced && (
            <div className="mt-2 max-h-64 divide-y divide-border overflow-y-auto overscroll-contain">
              {candidates.length === 0 ? (
                <p className="py-3 text-sm text-fg-muted">{tc("empty")}</p>
              ) : (
                candidates.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={u.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{u.name}</p>
                        {canSeePhones && (
                          <p className="truncate text-xs text-fg-muted">{formatPhone(u.phone)}</p>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="subtle" className="h-7" onClick={() => onAdd(u.id)}>
                      <Plus />
                      {tc("add")}
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Guruh o'quvchilari */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("students")} · {group.students.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {group.students.length === 0 ? (
            <EmptyState title={t("noStudents")} className="border-0 py-6" />
          ) : (
            <div className="divide-y divide-border">
              {group.students.map((s) => {
                const info = (
                  <>
                    <Avatar name={s.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{s.name}</p>
                      {canSeePhones && (
                        <p className="truncate text-xs text-fg-muted">{formatPhone(s.phone)}</p>
                      )}
                    </div>
                  </>
                );
                return (
                  <div key={s.studentId} className="flex items-center justify-between gap-2 py-2.5">
                    {isOffice ? (
                      <Link
                        href={`/students/${s.studentId}`}
                        className="flex min-w-0 items-center gap-2.5 hover:opacity-80"
                      >
                        {info}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2.5">{info}</div>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="flex items-center gap-1 text-sm font-medium text-fg tabular-nums">
                        <Star className="size-3.5 text-brand" />
                        {s.currentPoints}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("addStudent")}
                        onClick={() => setPointsTarget({ id: s.studentId, name: s.name })}
                      >
                        <Sparkles className="text-brand" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("remove")}
                        onClick={() => onRemove(s.studentId)}
                      >
                        <UserMinus className="text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <GroupFormDialog open={editOpen} group={group} onClose={() => setEditOpen(false)} />
      <AdjustPointsDialog
        open={!!pointsTarget}
        onClose={() => setPointsTarget(null)}
        studentId={pointsTarget?.id ?? ""}
        studentName={pointsTarget?.name ?? ""}
        limit={teacherLimit}
      />
    </div>
  );
}
