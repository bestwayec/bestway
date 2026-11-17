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
import { useCreateArticle, useUpdateArticle } from "@/hooks/use-articles";
import { ApiError } from "@/lib/api-client";
import type { Article } from "@/lib/types";

export function ArticleFormDialog({
  open,
  onClose,
  article,
}: {
  open: boolean;
  onClose: () => void;
  article?: Article | null;
}) {
  const t = useTranslations("articles");
  const isEdit = !!article;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {open && (
          <ArticleFormFields
            key={article?.id ?? "new"}
            article={article}
            onClose={onClose}
            title={isEdit ? t("edit") : t("create")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ArticleFormFields({
  article,
  onClose,
  title,
}: {
  article?: Article | null;
  onClose: () => void;
  title: string;
}) {
  const t = useTranslations("articles");
  const tc = useTranslations("common");
  const isEdit = !!article;
  const create = useCreateArticle();
  const update = useUpdateArticle(article?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [titleValue, setTitle] = React.useState(article?.title ?? "");
  const [body, setBody] = React.useState(article?.body ?? "");
  const [category, setCategory] = React.useState(article?.category ?? "");
  const [tags, setTags] = React.useState(article?.tags?.join(", ") ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<{
    title?: string;
    body?: string;
    category?: string;
  }>({});

  function submit() {
    setError(null);
    // Backend CreateArticleDto bilan bir xil chegaralar — har bir maydonda
    // aniq xabar ko'rsatamiz (umumiy "unknownError" emas).
    const fe: { title?: string; body?: string; category?: string } = {};
    if (titleValue.trim().length < 3) fe.title = t("titleMin");
    if (body.trim().length < 10) fe.body = t("bodyMin");
    if (category.trim().length < 2) fe.category = t("categoryMin");
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) return;
    const input = {
      title: titleValue.trim(),
      body: body.trim(),
      category: category.trim(),
      tags: tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const handlers = {
      onSuccess: () => {
        toast.success(isEdit ? t("updated") : t("created"));
        onClose();
      },
      // Server xabarini har doim ko'rsatamiz; kutilmagan holatda ham
      // bo'sh "unknownError" o'rniga haqiqiy sabab chiqadi.
      onError: (e: unknown) => {
        if (e instanceof ApiError) {
          setError(e.code ? `${e.message} (${e.code})` : e.message);
        } else if (e instanceof Error && e.message) {
          setError(e.message);
        } else if (typeof e === "string" && e) {
          setError(e);
        } else {
          setError(tc("unknownError"));
        }
      },
    };
    if (isEdit) update.mutate(input, handlers);
    else create.mutate(input, handlers);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {error && (
          <div className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <Field label={t("articleTitle")} htmlFor="atitle" error={fieldErrors.title}>
          <Input
            id="atitle"
            value={titleValue}
            onChange={(e) => {
              setTitle(e.target.value);
              if (fieldErrors.title) setFieldErrors((p) => ({ ...p, title: undefined }));
            }}
            aria-invalid={fieldErrors.title ? true : undefined}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("category")} htmlFor="acat" error={fieldErrors.category}>
            <Input
              id="acat"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                if (fieldErrors.category) setFieldErrors((p) => ({ ...p, category: undefined }));
              }}
              aria-invalid={fieldErrors.category ? true : undefined}
              placeholder={t("categoryPlaceholder")}
            />
          </Field>
          <Field label={t("tags")} htmlFor="atags">
            <Input id="atags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>
        <Field label={t("body")} htmlFor="abody" error={fieldErrors.body}>
          <Textarea
            id="abody"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (fieldErrors.body) setFieldErrors((p) => ({ ...p, body: undefined }));
            }}
            aria-invalid={fieldErrors.body ? true : undefined}
            className="min-h-40"
          />
        </Field>
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
