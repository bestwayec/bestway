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
import { useCreateUser, useUpdateUser } from "@/hooks/use-users";
import { ApiError } from "@/lib/api-client";
import type { CreateUserInput, GroupListItem, Role, UserListItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type CreatableRole = Exclude<Role, "super_admin">;

export function UserFormDialog({
  open,
  onClose,
  editUser,
  roleOptions,
  groups = [],
}: {
  open: boolean;
  onClose: () => void;
  /** Berilsa — tahrirlash rejimi */
  editUser?: UserListItem | null;
  /** Yaratishda tanlanadigan rollar */
  roleOptions: CreatableRole[];
  groups?: GroupListItem[];
}) {
  const t = useTranslations("staff");
  const isEdit = !!editUser;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("updated") : t("create")}</DialogTitle>
        </DialogHeader>
        {open && (
          <UserFormFields
            key={editUser?.id ?? "new"}
            editUser={editUser}
            roleOptions={roleOptions}
            groups={groups}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UserFormFields({
  editUser,
  roleOptions,
  groups,
  onClose,
}: {
  editUser?: UserListItem | null;
  roleOptions: CreatableRole[];
  groups: GroupListItem[];
  onClose: () => void;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const ts = useTranslations("student");
  const isEdit = !!editUser;

  const create = useCreateUser();
  const update = useUpdateUser(editUser?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = React.useState(editUser?.name ?? "");
  const [phone, setPhone] = React.useState(editUser?.phone ?? "");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<CreatableRole>(
    editUser ? (editUser.role === "super_admin" ? "admin" : editUser.role) : (roleOptions[0] ?? "student"),
  );
  const [groupId, setGroupId] = React.useState(editUser?.student?.groupId ?? "none");
  const [isActive, setIsActive] = React.useState(editUser?.isActive ?? true);
  const [isApproved, setIsApproved] = React.useState(editUser?.student?.isApproved ?? false);
  const [error, setError] = React.useState<string | null>(null);

  const effectiveRole = isEdit ? editUser!.role : role;
  const isStudent = effectiveRole === "student";

  function submit() {
    setError(null);
    if (name.trim().length < 2) return setError(tc("unknownError"));
    if (!/^\+?\d{9,15}$/.test(phone.replace(/\s/g, ""))) return setError(tc("unknownError"));

    const onSettled = {
      onSuccess: () => {
        toast.success(isEdit ? t("updated") : t("created"));
        onClose();
      },
      onError: (e: unknown) =>
        setError(e instanceof ApiError ? e.message : tc("unknownError")),
    };

    if (isEdit) {
      update.mutate(
        {
          name: name.trim(),
          phone: phone.replace(/\s/g, ""),
          isActive,
          ...(password ? { password } : {}),
          ...(isStudent ? { isApproved, groupId: groupId === "none" ? null : groupId } : {}),
        },
        onSettled,
      );
    } else {
      if (password.length < 6) return setError(tc("unknownError"));
      const input: CreateUserInput = {
        name: name.trim(),
        phone: phone.replace(/\s/g, ""),
        password,
        role,
        ...(role === "student" && groupId !== "none" ? { groupId } : {}),
      };
      create.mutate(input, onSettled);
    }
  }

  return (
    <>
      <DialogBody className="space-y-4">
        {error && (
          <div className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {!isEdit && roleOptions.length > 1 && (
          <Field label={t("role")}>
            <div className="flex flex-wrap gap-2">
              {roleOptions.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={role === r}
                  className={cn(
                    "rounded-field border px-3 py-2 text-sm font-medium transition-colors",
                    role === r
                      ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                      : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                  )}
                >
                  {tr(r)}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label={tc("name")} htmlFor="uname">
          <Input id="uname" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label={tc("phone")} htmlFor="uphone">
          <Input
            id="uphone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998901234567"
          />
        </Field>

        <Field label={isEdit ? t("passwordReset") : t("password")} htmlFor="upass">
          <Input
            id="upass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={isEdit ? "••••••" : tc("save")}
          />
        </Field>

        {isStudent && groups.length > 0 && (
          <Field label={tc("group")}>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tc("notSelected")}</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {isEdit && (
          <div className="flex flex-wrap gap-2">
            <ToggleChip active={isActive} onClick={() => setIsActive((v) => !v)}>
              {isActive ? t("active") : t("inactive")}
            </ToggleChip>
            {isStudent && (
              <ToggleChip active={isApproved} onClick={() => setIsApproved((v) => !v)}>
                {ts("approved")}
              </ToggleChip>
            )}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={pending}>
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-success bg-success-bg text-success"
          : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}
