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
import { Field, Input, Textarea } from "@/components/ui/input";
import { useCreateVideo } from "@/hooks/use-videos";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function VideoCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("videos");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("create")}</DialogTitle>
        </DialogHeader>
        {open && <VideoCreateFields onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function VideoCreateFields({ onClose }: { onClose: () => void }) {
  const t = useTranslations("videos");
  const tc = useTranslations("common");
  const create = useCreateVideo();

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [price, setPrice] = React.useState("0");
  const [isFreeForApproved, setIsFreeForApproved] = React.useState(true);
  const [file, setFile] = React.useState<File | null>(null);
  const [thumb, setThumb] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    if (title.trim().length < 3 || !file) return setError(tc("unknownError"));
    const form = new FormData();
    form.set("title", title.trim());
    form.set("description", description.trim());
    form.set("price", String(Number(price) || 0));
    form.set("isFreeForApproved", String(isFreeForApproved));
    form.set("file", file);
    if (thumb) form.set("thumbnail", thumb);

    create.mutate(form, {
      onSuccess: () => {
        toast.success(t("created"));
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
        <Field label={tc("name")} htmlFor="vtitle">
          <Input id="vtitle" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={t("description")} htmlFor="vdesc">
          <Textarea id="vdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t("price")} (${tc("sum")})`} htmlFor="vprice">
            <Input id="vprice" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label={t("file")} htmlFor="vfile">
            <Input id="vfile" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <Field label={t("thumbnail")} htmlFor="vthumb">
          <Input id="vthumb" type="file" accept="image/*" onChange={(e) => setThumb(e.target.files?.[0] ?? null)} />
        </Field>
        <button
          type="button"
          onClick={() => setIsFreeForApproved((v) => !v)}
          aria-pressed={isFreeForApproved}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
            isFreeForApproved ? "border-success bg-success-bg text-success" : "border-border text-fg-muted hover:bg-surface-hover",
          )}
        >
          {t("freeForApproved")}
        </button>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={create.isPending}>
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
