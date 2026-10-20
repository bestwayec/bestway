"use client";

import * as React from "react";
import { Headphones, BookOpenText, PenLine, Mic, Save, Trash2, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useDeleteMockExam, useUpdateMockExam } from "@/hooks/use-mock";
import { useMe } from "@/hooks/use-me";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail, MockSkill } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExamQuestionsEditorDialog } from "./ExamQuestionsEditorDialog";
import { Sparkles } from "lucide-react";
import { EXAM_TYPE_LABEL, tx, type Selection } from "./types";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

/** Exam settings + content summary + danger zone. */
export function OverviewPanel({
  examId,
  detail,
  onSelect,
  registerSave,
  onDirty,
}: {
  examId: string;
  detail: MockExamDetail;
  onSelect: (s: Selection) => void;
  registerSave: (fn: (() => Promise<boolean>) | null) => void;
  onDirty: (d: boolean) => void;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const { data: me } = useMe();
  const router = useRouter();
  const isSuper = me?.user.role === "super_admin";
  const update = useUpdateMockExam(examId);
  const del = useDeleteMockExam();

  const [title, setTitle] = React.useState(detail.title);
  const [description, setDescription] = React.useState(detail.description ?? "");
  const [level, setLevel] = React.useState(detail.level ?? "");
  const [price, setPrice] = React.useState(String(detail.price ?? 0));
  const [isFreeForApproved, setIsFreeForApproved] = React.useState(detail.isFreeForApproved);
  const [isDemo, setIsDemo] = React.useState(detail.isDemo);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [quickEditorOpen, setQuickEditorOpen] = React.useState(false);

  const dirty = React.useMemo(
    () =>
      title !== detail.title ||
      description !== (detail.description ?? "") ||
      level !== (detail.level ?? "") ||
      price !== String(detail.price ?? 0) ||
      isFreeForApproved !== detail.isFreeForApproved ||
      isDemo !== detail.isDemo,
    [title, description, level, price, isFreeForApproved, isDemo, detail],
  );
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const doSave = React.useCallback(async (): Promise<boolean> => {
    const priceNum = price === "" ? 0 : Number(price);
    if (title.trim().length < 3) {
      toast.error(tx(t, "titleTooShort", "Title must be at least 3 characters."));
      return false;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error(tx(t, "priceInvalid", "Price must be 0 or more."));
      return false;
    }
    try {
      await update.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        level: level.trim() || undefined,
        price: priceNum,
        isFreeForApproved,
        isDemo,
      });
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("unknownError"));
      return false;
    }
  }, [title, description, level, price, isFreeForApproved, isDemo, update, t, tc]);

  React.useEffect(() => {
    registerSave(() => doSave());
    return () => registerSave(null);
  }, [registerSave, doSave]);

  function save() {
    void (async () => {
      const ok = await doSave();
      if (ok) toast.success(tc("saved"));
    })();
  }

  const totalGroups = detail.sections.reduce((a, s) => a + s.groups.length, 0);

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>{tx(t, "examSettings", "Exam settings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={detail.isPublished ? "success" : "warning"}>
                {detail.isPublished ? tx(t, "published", "Published") : tx(t, "draft", "Draft")}
              </Badge>
              <Badge variant="info">{EXAM_TYPE_LABEL[detail.type]}</Badge>
              <Badge variant="info">
                {detail.profile === "full_mock"
                  ? tx(t, "modeFull", "Full Mock")
                  : tx(t, "modePractice", "Practice")}
              </Badge>
              <Badge>{detail.price > 0 ? formatMoney(detail.price) : tx(t, "free", "Free")}</Badge>
            </div>
            <Field label={tx(t, "title", "Title")} htmlFor="ov-title">
              <Input id="ov-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={tx(t, "description", "Description")} htmlFor="ov-desc">
              <Textarea
                id="ov-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-20"
                placeholder={tx(t, "descriptionHint", "What is this exam for? Shown to students.")}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tx(t, "level", "Level")} htmlFor="ov-level">
                <Input
                  id="ov-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  placeholder="Academic / B1–B2"
                />
              </Field>
              <Field label={tx(t, "price", "Price (0 = free)")} htmlFor="ov-price">
                <Input
                  id="ov-price"
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={isFreeForApproved}
                onChange={(e) => setIsFreeForApproved(e.target.checked)}
                className="accent-[var(--color-brand,#89F336)]"
              />
              {tx(t, "freeApproved", "Free for enrolled students")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={isDemo}
                onChange={(e) => setIsDemo(e.target.checked)}
                className="accent-[var(--color-brand,#89F336)]"
              />
              {tx(t, "demoVisible", "Visible as a public demo")}
            </label>
            <Button size="sm" loading={update.isPending} onClick={save}>
              <Save className="size-4" />
              {tc("save")}
            </Button>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>{tx(t, "content", "Content")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
              <div className="min-w-0 rounded-[8px] bg-surface-hover p-2 sm:p-2.5">
                <p className="text-lg font-bold text-fg tabular-nums sm:text-xl">{detail.sections.length}</p>
                <p className="truncate text-[11px] text-fg-muted">{tx(t, "sections", "sections")}</p>
              </div>
              <div className="min-w-0 rounded-[8px] bg-surface-hover p-2 sm:p-2.5">
                <p className="text-lg font-bold text-fg tabular-nums sm:text-xl">{totalGroups}</p>
                <p className="truncate text-[11px] text-fg-muted">{tx(t, "blocks", "blocks")}</p>
              </div>
              <div className="min-w-0 rounded-[8px] bg-surface-hover p-2 sm:p-2.5">
                <p className="text-lg font-bold text-fg tabular-nums sm:text-xl">{detail.questionCount}</p>
                <p className="truncate text-[11px] text-fg-muted">{tx(t, "questions", "questions")}</p>
              </div>
            </div>
            {detail.sections.map((s) => {
              const Icon = SKILL_ICON[s.skill];
              const n = s.groups.reduce((a, g) => a + g.questions.length, 0);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect({ kind: "section", sectionId: s.id })}
                  className="flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-left text-sm transition hover:border-fg-subtle"
                >
                  <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="truncate font-medium capitalize text-fg">{s.skill}</span>
                  <span className="ml-auto shrink-0 truncate text-xs text-fg-muted tabular-nums">
                    {s.groups.length} {tx(t, "blocks", "blocks")} · {n}q
                    {s.skill !== "listening" && s.durationMinutes != null && ` · ${s.durationMinutes} min`}
                  </span>
                </button>
              );
            })}
            {detail.sections.length === 0 && (
              <p className="text-sm text-fg-muted">
                {tx(t, "noSectionsHint", "No sections yet — add Listening, Reading, Writing and Speaking from the sidebar (+).")}
              </p>
            )}
            <div className="pt-2">
              <Button
                size="sm"
                variant="subtle"
                className="w-full justify-center border border-emerald-600/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50"
                onClick={() => setQuickEditorOpen(true)}
              >
                <Sparkles className="size-3.5 text-emerald-400" />
                <span>Savollar Redaktori (Tezkor kiritish)</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-danger-border">
        <CardHeader>
          <CardTitle className="text-danger">{tx(t, "danger", "Danger zone")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {detail.isPublished && (
            <Button
              size="sm"
              variant="outline"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { isPublished: false },
                  {
                    onSuccess: () => toast.success(tx(t, "unpublished", "Exam is back to draft.")),
                    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
                  },
                )
              }
            >
              <EyeOff className="size-4" />
              {tx(t, "unpublish", "Unpublish")}
            </Button>
          )}
          {isSuper ? (
            <Button
              size="sm"
              variant="danger"
              loading={del.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
              {tx(t, "deleteExam", "Delete exam")}
            </Button>
          ) : (
            <p className="text-xs text-fg-subtle">
              {tx(t, "superOnly", "Only super admins can delete exams")}
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete && isSuper}
        title={`${tx(t, "deleteExam", "Delete exam")} — “${detail.title}”?`}
        description={tx(
          t,
          "deleteExamConfirm",
          "Delete this exam permanently? Its sections, parts, questions and media files are removed too.",
        )}
        confirmLabel={tx(t, "deleteExam", "Delete exam")}
        loading={del.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          del.mutate(examId, {
            onSuccess: () => {
              toast.success(tx(t, "deleted", "Exam deleted"));
              router.push("/exam-builder");
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
          })
        }
      />
    </div>
  );
}
