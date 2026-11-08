"use client";

import * as React from "react";
import { UserRoundPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useMe, useUpdateMe } from "@/hooks/use-me";
import { ApiError } from "@/lib/api-client";
import { isPlaceholderName } from "@/lib/display-name";

/** Asks students with a placeholder name ("Student", test names) to enter their real name (O2). */
export function NamePromptCard() {
  const t = useTranslations("namePrompt");
  const { data: me } = useMe();
  const updateMe = useUpdateMe();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  if (!me || !isPlaceholderName(me.user.name)) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = name.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > 100 || isPlaceholderName(normalized)) {
      setError(t("invalid"));
      return;
    }
    setError(null);
    updateMe.mutate(
      { name: normalized },
      {
        onSuccess: () => toast.success(t("saved")),
        onError: (err) => setError(err instanceof ApiError ? err.message : t("invalid")),
      },
    );
  }

  return (
    <Card className="mb-4 border-warning-border bg-warning-bg/40 p-4" data-testid="name-prompt">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 items-start gap-3">
          <UserRoundPen className="mt-1 size-5 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-fg">{t("title")}</p>
            <p className="mb-2 text-xs text-fg-muted">{t("hint")}</p>
            <Field label={t("label")} error={error ?? undefined} htmlFor="name-prompt-input">
              <Input id="name-prompt-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
            </Field>
          </div>
        </div>
        <Button type="submit" loading={updateMe.isPending}>{t("save")}</Button>
      </form>
    </Card>
  );
}
