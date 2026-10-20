"use client";

import * as React from "react";
import { Ban, BookOpen, Check, ChevronRight, Plus, Search, Star, Trash2, Users } from "lucide-react";
import { DeleteStudentDialog } from "@/components/students/delete-student-dialog";
import type { UserListItem } from "@/lib/types";
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
import { useStudents, useApproveStudent, useDeactivateUser, useDebouncedValue } from "@/hooks/use-users";
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
  const debounced = useDebouncedValue(search);
  const { data, isLoading, isError, refetch } = useStudents(debounced);
  const groupsQ = useGroups();
  const approve = useApproveStudent();
  const deactivate = useDeactivateUser();

  const students = data ?? [];

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
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          className="pl-9"
        />
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
                className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
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
                <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-xs font-bold text-amber-400 tabular-nums shadow-sm shadow-amber-950/20">
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
