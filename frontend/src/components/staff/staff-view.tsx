"use client";

import * as React from "react";
import { Ban, Pencil, Plus, Search, UserCog, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/app/page-header";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import {
  useUsersList,
  useDeactivateUser,
  useDebouncedValue,
} from "@/hooks/use-users";
import { useMe } from "@/hooks/use-me";
import type { Role, UserListItem } from "@/lib/types";
import { formatPhone } from "@/lib/utils";

type StaffRole = "teacher" | "admin" | "parent";

export function StaffView() {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const { data: me } = useMe();
  const isSuper = me?.user.role === "super_admin";

  const [tab, setTab] = React.useState<StaffRole>("teacher");
  const [search, setSearch] = React.useState("");
  const debounced = useDebouncedValue(search);
  const listQ = useUsersList(tab as Role, debounced);
  const deactivate = useDeactivateUser();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserListItem | null>(null);

  const users = listQ.data ?? [];
  const roleOptions: ("teacher" | "admin" | "parent")[] = isSuper
    ? ["teacher", "admin", "parent"]
    : ["teacher", "parent"];

  function onDeactivate(u: UserListItem) {
    if (!confirm(t("deactivateConfirm"))) return;
    deactivate.mutate(u.id, {
      onSuccess: () => toast.success(t("deactivated")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("create")}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as StaffRole)} className="mb-4">
        <TabsList>
          <TabsTrigger panel={false} value="teacher">{t("tabs.teacher")}</TabsTrigger>
          <TabsTrigger panel={false} value="admin">{t("tabs.admin")}</TabsTrigger>
          <TabsTrigger panel={false} value="parent">{t("tabs.parent")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tc("search")}
          className="pl-9"
        />
      </div>

      {listQ.isError ? (
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => listQ.refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      ) : listQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState icon={tab === "parent" ? Users : UserCog} title={t("empty")} />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id} className="flex items-center gap-3 p-3">
              <Avatar name={u.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{u.name}</p>
                <p className="truncate text-sm text-fg-muted">{formatPhone(u.phone)}</p>
              </div>
              {!u.isActive && <Badge variant="danger">{t("inactive")}</Badge>}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={tc("edit")}
                onClick={() => setEditUser(u)}
              >
                <Pencil />
              </Button>
              {isSuper && u.isActive && u.id !== me?.user.id && u.role !== "super_admin" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("deactivate")}
                  onClick={() => onDeactivate(u)}
                >
                  <Ban className="text-danger" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <UserFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roleOptions={roleOptions}
      />
      <UserFormDialog
        open={!!editUser}
        onClose={() => setEditUser(null)}
        editUser={editUser}
        roleOptions={roleOptions}
      />
    </div>
  );
}
