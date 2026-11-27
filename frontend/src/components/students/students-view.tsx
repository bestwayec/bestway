"use client";

import * as React from "react";
import { Ban, BookOpen, Check, ChevronRight, Plus, Search, Star, Trash2, Users } from "lucide-react";
import { DeleteStudentDialog } from "@/components/students/delete-student-dialog";
import type { UserListItem } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { ExportButton } from "@/components/app/export-button";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { useTeachers, useApproveStudent, useDeactivateUser, useDebouncedValue } from "@/hooks/use-users";
import { useGroups } from "@/hooks/use-groups";
import { useMe } from "@/hooks/use-me";
import { formatPhone } from "@/lib/utils";

export function StudentsView() {
  const t = useTranslations("common");
  const ts = useTranslations("student");
  const tst = useTranslations("staff");
  const { data: me } = useMe();
  const isSuper = me?.user.role === "super_admin";
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<UserListItem | null>(null);
  const tf = useTranslations("studentManagement");
  const [page, setPage] = React.useState(1);
  const [groupId, setGroup] = React.useState("");
  const [teacherId, setTeacher] = React.useState("");
  const [track, setTrack] = React.useState("");
  const [accountStatus, setStatus] = React.useState("");
  const debounced = useDebouncedValue(search);
  const filter = { role: "student", search: debounced || undefined, page, limit: 25, groupId: groupId || undefined,
    teacherId: teacherId || undefined, track: track || undefined, accountStatus: accountStatus || undefined };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", "students-page", filter],
    queryFn: () => api.getPaged<UserListItem[]>("/users", filter),
  });
  const groupsQ = useGroups();
  const teachersQ = useTeachers();
  const approve = useApproveStudent();
  const deactivate = useDeactivateUser();

  const students = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  function onApprove(id: string) {
    approve.mutate(id, {
      onSuccess: () => toast.success(ts("approved")),
      onError: () => toast.error(t("unknownError")),
    });
  }

  function onDeactivate(id: string) {
    if (!confirm(tst("deactivateConfirm"))) return;
    deactivate.mutate(id, {
      onSuccess: () => toast.success(tst("deactivated")),
      onError: () => toast.error(t("unknownError")),
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("students")}
        actions={
          <>
            <ExportButton path="/stats/export/students" />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t("add")}
            </Button>
          </>
        }
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={t("search")}
          aria-label={t("search")}
          type="search"
          className="pl-9"
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          [tf("group"), groupId, setGroup, (groupsQ.data ?? []).map((group) => [group.id, group.name])],
          [tf("teacher"), teacherId, setTeacher, (teachersQ.data ?? []).map((teacher) => [teacher.id, teacher.name])],
          [tf("track"), track, setTrack, [["IELTS", "IELTS"], ["MULTILEVEL", "Multilevel"]]],
          [tf("account"), accountStatus, setStatus, [["active", tf("active")], ["pending", tf("pending")], ["suspended", tf("suspended")]]],
        ] as const).map(([label, value, select, options]) => (
          <label key={label} className="min-w-0 text-xs text-fg-muted">
            {label}
            <select value={value} onChange={(event) => { select(event.target.value); setPage(1); }}
              className="mt-1 w-full rounded-control border border-border bg-surface px-2 py-2 text-sm text-fg">
              <option value="">{tf("all")}</option>
              {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        ))}
      </div>
      {isError ? (
        <ErrorState
          title={t("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t("retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : students.length === 0 ? (
        <EmptyState icon={Users} title={t("empty")} />
      ) : (
        <div className="space-y-2">
          {students.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <Link
                href={`/students/${s.id}`}
                className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-field p-1 hover:bg-surface-hover"
              >
                <Avatar name={s.name} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{s.name}</p>
                  <p className="truncate text-sm text-fg-muted">{formatPhone(s.phone)}</p>
                </div>
              </Link>
              <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0 sm:gap-3">
                {s.student?.groupName && (
                  <span className="hidden items-center gap-1 text-xs text-fg-muted sm:flex">
                    <BookOpen className="size-3.5" />
                    {s.student.groupName}
                  </span>
                )}
                <span className="flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-xs font-bold text-warning tabular-nums">
                  <Star className="size-3 fill-amber-400 text-amber-400" />
                  {s.student?.currentPoints ?? 0}
                </span>
                {s.student?.isApproved ? (
                  <Badge variant="success">
                    <Check /> <span className="hidden sm:inline">{ts("approved")}</span>
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="subtle"
                    className="h-7"
                    loading={approve.isPending && approve.variables === s.id}
                    onClick={() => onApprove(s.id)}
                  >
                    {t("confirm")}
                  </Button>
                )}
                {!s.isActive && <Badge variant="danger">{tst("inactive")}</Badge>}
                {isSuper && s.id !== me?.user.id && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="O'chirish"
                    onClick={() => setDeleteTarget(s)}
                    className="shrink-0 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300"
                  >
                    <Trash2 className="size-4 text-rose-400" />
                  </Button>
                )}
                {isSuper && s.isActive && s.id !== me?.user.id && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={tst("deactivate")}
                    onClick={() => onDeactivate(s.id)}
                    className="shrink-0 text-slate-400 hover:bg-slate-800"
                  >
                    <Ban className="size-3.5" />
                  </Button>
                )}
                <Link href={`/students/${s.id}`} aria-label={s.name}>
                  <ChevronRight className="size-4 text-fg-subtle" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(page > 1 || total > filter.limit) && (
        <nav aria-label={tf("pagination")} className="my-4 flex items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage(page - 1)} disabled={page <= 1 || isLoading}>{tf("previous")}</Button>
          <span className="text-sm text-fg-muted">{tf("page", { current: page, total: Math.max(1, Math.ceil(total / filter.limit)) })}</span>
          <Button size="sm" variant="outline" onClick={() => setPage(page + 1)} disabled={page * filter.limit >= total || isLoading}>{tf("next")}</Button>
        </nav>
      )}
      <UserFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roleOptions={["student"]}
        groups={groupsQ.data ?? []}
      />

      {deleteTarget && (
        <DeleteStudentDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          studentId={deleteTarget.id}
          studentName={deleteTarget.name}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  );
}
