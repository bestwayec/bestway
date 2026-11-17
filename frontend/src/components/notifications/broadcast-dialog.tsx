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
import { Field, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBroadcast } from "@/hooks/use-broadcast";
import { useGroups } from "@/hooks/use-groups";
import { ApiError } from "@/lib/api-client";
import type { BroadcastAudience, BroadcastInput, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const AUDIENCES: BroadcastAudience[] = ["all", "role", "group", "debtors"];
const ROLES: Role[] = ["student", "parent", "teacher"];

export function BroadcastDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("broadcast");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        {open && <BroadcastFields onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function BroadcastFields({ onClose }: { onClose: () => void }) {
  const t = useTranslations("broadcast");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const send = useBroadcast();
  const groupsQ = useGroups();

  const [audience, setAudience] = React.useState<BroadcastAudience>("all");
  const [role, setRole] = React.useState<Role>("student");
  const [groupId, setGroupId] = React.useState("");
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    if (text.trim().length < 3) return setError(tc("unknownError"));
    if (audience === "group" && !groupId) return setError(tc("notSelected"));

    const input: BroadcastInput = {
      audience,
      text: text.trim(),
      ...(audience === "role" ? { role } : {}),
      ...(audience === "group" ? { groupId, includeParents: true } : {}),
      ...(audience === "debtors" ? { includeParents: true } : {}),
    };
    send.mutate(input, {
      onSuccess: (res) => {
        toast.success(t("sent", { count: res.notified }));
        onClose();
      },
      onError: (e) => setError(e instanceof ApiError ? e.message : tc("unknownError")),
    });
  }

  return (
    <>
      <DialogBody className="space-y-4">
        {error && (
          <div className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <Field label={t("audience")}>
          <div className="grid grid-cols-2 gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                aria-pressed={audience === a}
                className={cn(
                  "rounded-field border px-3 py-2 text-sm font-medium transition-colors",
                  audience === a
                    ? "border-brand bg-brand-subtle text-brand-subtle-fg"
                    : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                )}
              >
                {t(a)}
              </button>
            ))}
          </div>
        </Field>

        {audience === "role" && (
          <Field label={t("byRole")}>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tr(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        {audience === "group" && (
          <Field label={t("byGroup")}>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder={tc("notSelected")} />
              </SelectTrigger>
              <SelectContent>
                {(groupsQ.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label={t("message")} htmlFor="btext">
          <Textarea
            id="btext"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("messagePlaceholder")}
            className="min-h-28"
            maxLength={2000}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={send.isPending}>
          {t("send")}
        </Button>
      </DialogFooter>
    </>
  );
}
