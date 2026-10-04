"use client";

import * as React from "react";
import { Check, Link2, Loader2, Pencil, Send, Unlink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { useMe, useUpdateMe } from "@/hooks/use-me";
import {
  useTelegramLinkToken,
  useTelegramStatus,
  useUnlinkTelegram,
} from "@/hooks/use-telegram";
import { ApiError } from "@/lib/api-client";
import { formatPhone, isSafeHref } from "@/lib/utils";
import { ExamTrackSelector } from './exam-track-selector';

export function ProfileView() {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const format = useFormatter();
  const { data: me, isLoading } = useMe();
  const statusQ = useTelegramStatus();
  const linkToken = useTelegramLinkToken();
  const unlink = useUnlinkTelegram();
  const updateMe = useUpdateMe();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);

  function onLink() {
    linkToken.mutate(undefined, {
      onSuccess: (res) => {
        // Backend'dan kelgan URL — sxemani tekshiramiz (javascript: va sh.k. bloklanadi)
        if (!isSafeHref(res.url)) {
          toast.error(tc("unknownError"));
          return;
        }
        window.open(res.url, "_blank", "noopener,noreferrer");
        toast.success(t("telegramHint"));
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
    });
  }

  function onUnlink() {
    unlink.mutate(undefined, {
      onSuccess: () => toast.success(t("telegramNotLinked")),
      onError: () => toast.error(tc("unknownError")),
    });
  }

  function startEdit() {
    if (!me || updateMe.isPending) return;
    setName(me.user.name);
    setNameError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (!me || updateMe.isPending) return;
    setName(me.user.name);
    setNameError(null);
    setEditing(false);
  }

  function saveName() {
    const normalized = name.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > 100) {
      setNameError(t("nameError"));
      return;
    }
    setNameError(null);
    if (me && normalized === me.user.name) {
      setEditing(false);
      return;
    }
    updateMe.mutate(
      { name: normalized },
      {
        onSuccess: () => {
          toast.success(t("nameUpdated"));
          setEditing(false);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  if (isLoading || !me) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("title")} />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const linked = statusQ.data?.linked ?? me.telegramLinked;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={t("title")} />

      {me.user.role === 'student' && <ExamTrackSelector />}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("account")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar name={me.user.name} size="lg" />
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <Field label={tc("name")} error={nameError ?? undefined} htmlFor="profile-name">
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    maxLength={100}
                    autoFocus
                    disabled={updateMe.isPending}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" loading={updateMe.isPending} onClick={saveName}>
                    {tc("save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={updateMe.isPending}
                  >
                    {tc("cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-lg font-semibold text-fg">{me.user.name}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startEdit}
                  aria-label={t("editName")}
                  title={t("editName")}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            )}
            {!editing && (
              <>
                <p className="text-sm text-fg-muted">{formatPhone(me.user.phone)}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="brand">{tr(me.user.role)}</Badge>
                  <span className="text-xs text-fg-subtle">
                    {format.dateTime(new Date(me.user.createdAt), {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </>
            )}
            {editing && (
              <p className="mt-2 text-sm text-fg-muted">{formatPhone(me.user.phone)}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Send className="size-4 text-info" />
            {t("telegram")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-fg-muted">{t("telegramHint")}</p>
          {linked ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium text-success">
                <Check className="size-4" />
                {t("telegramLinked")}
              </span>
              <Button variant="outline" size="sm" loading={unlink.isPending} onClick={onUnlink}>
                <Unlink />
                {t("unlinkTelegram")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg-muted">{t("telegramNotLinked")}</span>
              <Button size="sm" loading={linkToken.isPending} onClick={onLink}>
                {linkToken.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
                {t("linkTelegram")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
