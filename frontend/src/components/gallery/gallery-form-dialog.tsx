"use client";

import * as React from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useCreateGallery, useUpdateGallery } from "@/hooks/use-gallery";
import { ApiError } from "@/lib/api-client";
import { isSafeHref } from "@/lib/utils";
import type { GalleryAdminItem } from "@/lib/types";

export function GalleryFormDialog({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item?: GalleryAdminItem | null;
}) {
  const isEdit = !!item;
  const tGallery = useTranslations("gallery");
  // fallback to common if gallery namespace missing
  const tCommon = useTranslations("common");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" hideClose>
        {open && (
          <div className="flex max-h-[min(92dvh,720px)] flex-col overflow-hidden rounded-card">
            <GalleryFormFields
            key={item?.id ?? "new"}
            item={item}
            onClose={onClose}
            title={isEdit ? tGallery("edit") : tGallery("create")}
            tGallery={tGallery}
            tCommon={tCommon}
          />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GalleryFormFields({
  item,
  onClose,
  title,
  tGallery,
  tCommon,
}: {
  item?: GalleryAdminItem | null;
  onClose: () => void;
  title: string;
  tGallery: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const isEdit = !!item;
  const create = useCreateGallery();
  const update = useUpdateGallery(item?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [label, setLabel] = React.useState(item?.label ?? "");
  const [link, setLink] = React.useState(item?.link ?? "");
  const [alt, setAlt] = React.useState(item?.alt ?? "");
  const [sortOrder, setSortOrder] = React.useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = React.useState(item?.isActive ?? true);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    if (!isEdit && !file) {
      setError(tGallery("imageRequired") ?? "Image is required");
      return;
    }
    if (label.trim().length > 120) {
      setError("Label too long");
      return;
    }
    // javascript:/data: kabi xavfli sxemalar saqlanmasin (saqlangan XSS)
    if (link.trim() && !isSafeHref(link.trim())) {
      setError(tGallery("linkInvalid") !== "linkInvalid" ? (tGallery("linkInvalid") as string) : "Link must start with https:// or http://");
      return;
    }
    const form = new FormData();
    if (label.trim()) form.set("label", label.trim());
    if (link.trim()) form.set("link", link.trim());
    if (alt.trim()) form.set("alt", alt.trim());
    form.set("sortOrder", String(Number(sortOrder) || 0));
    form.set("isActive", String(isActive));
    if (file) form.set("image", file);

    const handlers = {
      onSuccess: () => {
        toast.success(isEdit ? (tGallery("updated") as string) : (tGallery("created") as string));
        onClose();
      },
      onError: (e: unknown) => setError(e instanceof ApiError ? e.message : (tCommon("unknownError") as string)),
    };
    if (isEdit) update.mutate(form, handlers);
    else create.mutate(form, handlers);
  }

  return (
    <>
      <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-4 sm:px-6">
        <DialogTitle className="pt-0.5 pr-0 text-lg font-bold">{title}</DialogTitle>
        <DialogClose
          aria-label={tCommon("close")}
          className="inline-flex shrink-0 items-center justify-center rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </DialogClose>
      </DialogHeader>
      <DialogBody className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        {error && (
          <div
            role="alert"
            className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}
        {isEdit && item?.image && !file && (
          <div className="overflow-hidden rounded-xl border border-border bg-bg-subtle">
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic admin-uploaded preview URL; next/image optimizer cannot handle, plain img with lazy is intentional */}
            <img src={item.image} alt={item.alt || item.label || ""} loading="lazy" decoding="async" className="max-h-52 w-full object-cover" />
          </div>
        )}
        <Field label={tGallery("image")} htmlFor="gimage">
          <div className="rounded-xl border border-dashed border-border-strong bg-bg-subtle/50 px-4 py-4 transition-colors hover:border-brand/50 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand-subtle-fg">
                <ImagePlus className="size-5" aria-hidden />
              </span>
              <Input
                id="gimage"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="h-auto cursor-pointer border-0 bg-transparent px-0 py-1 shadow-none file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-subtle file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-subtle-fg hover:file:opacity-80 focus-visible:ring-0"
              />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">{tGallery("imageHint")}</p>
        </Field>
        <Field label={tGallery("label")} htmlFor="glabel">
          <Input
            id="glabel"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={tGallery("labelPlaceholder")}
            maxLength={120}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tGallery("link")} htmlFor="glink">
            <Input
              id="glink"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://..."
              maxLength={500}
            />
          </Field>
          <Field label={tGallery("alt")} htmlFor="galt">
            <Input id="galt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder={tGallery("altPlaceholder")} maxLength={300} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-bg-subtle/50 p-4 sm:grid-cols-2 sm:items-center">
          <Field label={tGallery("sortOrder")} htmlFor="gsort">
            <Input
              id="gsort"
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-surface"
            />
          </Field>
          <div>
            <span className="text-sm font-medium text-fg">{tGallery("isActive")}</span>
            <label htmlFor="gactive" className="mt-2 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-fg-muted">{isActive ? tCommon("yes") : tCommon("no")}</span>
              <input
                id="gactive"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative h-6 w-11 shrink-0 rounded-full bg-border-strong transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
              />
            </label>
          </div>
        </div>
      </DialogBody>
      <DialogFooter className="border-t border-border bg-bg-subtle/40 px-5 py-4 sm:px-6">
        <Button variant="outline" onClick={onClose} className="h-11 sm:h-10">
          {tCommon("cancel")}
        </Button>
        <Button onClick={submit} loading={pending} className="h-11 sm:h-10">
          {tCommon("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
