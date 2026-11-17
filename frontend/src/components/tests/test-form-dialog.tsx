"use client";

import * as React from "react";
import { Clock, Eye, EyeOff, Info, Layers, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useCreateTest, useUpdateTest } from "@/hooks/use-tests";
import { ApiError } from "@/lib/api-client";
import type { TestListItem, TestType, TestSection } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPES: TestType[] = ["ielts", "multilevel"];
const SECTIONS: TestSection[] = ["listening", "reading", "writing", "speaking"];

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  try {
    const v = t(key as never) as unknown;
    if (typeof v !== "string" || !v || v === key || v.endsWith(`.${key}`)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

export function TestFormDialog({
  open,
  onClose,
  test,
}: {
  open: boolean;
  onClose: () => void;
  test?: TestListItem | null;
}) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const isEdit = !!test;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <>
                <Layers className="size-4 text-brand" />
                {tFallback(t, "editTest", tc("edit"))}
              </>
            ) : (
              <>
                <Sparkles className="size-4 text-brand" />
                {tFallback(t, "create", "Create test")}
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? tFallback(t, "editTestHint", "Update test settings. Changes apply to future attempts.")
              : tFallback(t, "createHint", "Create a new test. You can add questions after creation.")}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TestFormFields
            key={test?.id ?? "new"}
            test={test}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestFormFields({
  test,
  onClose,
}: {
  test?: TestListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const isEdit = !!test;
  const create = useCreateTest();
  const update = useUpdateTest(test?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [type, setType] = React.useState<TestType>(test?.type ?? "ielts");
  const [title, setTitle] = React.useState(test?.title ?? "");
  const [level, setLevel] = React.useState(test?.level ?? "");
  const [duration, setDuration] = React.useState(
    test?.durationMinutes ? String(test.durationMinutes) : "",
  );
  const [isDemo, setIsDemo] = React.useState(test?.isDemo ?? false);
  const [isActive, setIsActive] = React.useState(test?.isActive ?? true);
  // sectionQuestionCounts editor — per-section limits as strings to allow empty
  const initialCounts = (test as unknown as { sectionQuestionCounts?: Record<string, number> | null })?.sectionQuestionCounts ?? null;
  const [counts, setCounts] = React.useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    SECTIONS.forEach((s) => {
      const v = initialCounts?.[s];
      r[s] = v != null ? String(v) : "";
    });
    return r;
  });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  function validate(): boolean {
    const fe: Record<string, string> = {};
    if (title.trim().length < 3) fe.title = tFallback(t, "titleRequired", "Title must be at least 3 characters");
    if (title.trim().length > 200) fe.title = "Max 200 characters";
    if (level.trim() && level.trim().length > 50) fe.level = "Max 50 characters";
    if (duration) {
      const n = Number(duration);
      if (!Number.isFinite(n) || n < 1 || n > 600) fe.duration = "1 – 600 minutes";
    }
    for (const s of SECTIONS) {
      const raw = counts[s];
      if (raw) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 100) fe[`count_${s}`] = "1 – 100";
      }
    }
    setFieldErrors(fe);
    if (Object.keys(fe).length) {
      setError(tFallback(tc, "unknownError", "Please fix highlighted fields"));
      return false;
    }
    return true;
  }

  function submit() {
    setError(null);
    setFieldErrors({});
    if (!validate()) return;
    const sectionQuestionCounts: Record<string, number> | undefined = (() => {
      const r: Record<string, number> = {};
      let has = false;
      for (const s of SECTIONS) {
        const raw = counts[s]?.trim();
        if (raw) {
          const n = Number(raw);
          if (Number.isFinite(n) && n > 0) {
            r[s] = n;
            has = true;
          }
        }
      }
      return has ? r : undefined;
    })();

    const base = {
      title: title.trim(),
      level: level.trim() || undefined,
      durationMinutes: duration ? Number(duration) : undefined,
      isDemo,
      ...(sectionQuestionCounts ? { sectionQuestionCounts } : {}),
    };
    const handlers = {
      onSuccess: () => {
        toast.success(isEdit ? tc("saved") : tFallback(t, "created", "Test created"));
        onClose();
      },
      onError: (e: unknown) => setError(e instanceof ApiError ? e.message : tFallback(tc, "unknownError", "An unexpected error occurred")),
    };
    if (isEdit) update.mutate({ ...base, isActive }, handlers);
    else create.mutate({ ...base, type }, handlers);
  }

  return (
    <>
      <DialogBody className="space-y-5 overflow-y-auto pr-1">
        {error && (
          <div className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger flex gap-2">
            <Info className="size-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {!isEdit && (
          <div>
            <p className="text-xs font-medium text-fg-muted mb-2">{tFallback(t, "testType", "Test type")}</p>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map((ty) => (
                <button
                  key={ty}
                  type="button"
                  onClick={() => setType(ty)}
                  aria-pressed={type === ty}
                  className={cn(
                    "rounded-control border px-3 py-3 text-sm font-medium uppercase transition-colors text-left flex flex-col gap-1",
                    type === ty
                      ? "border-brand bg-brand-subtle text-brand-subtle-fg ring-1 ring-brand/10"
                      : "border-border bg-surface text-fg-muted hover:bg-surface-hover",
                  )}
                >
                  <span className="font-semibold">{ty}</span>
                  <span className="text-[11px] font-normal normal-case opacity-80">
                    {ty === "ielts"
                      ? tFallback(t, "typeHintIelts", "Academic / General — 4 skills")
                      : tFallback(t, "typeHintMultilevel", "B1–C1 national certificate")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <Field
          label={tFallback(t, "testTitle", tc("name"))}
          htmlFor="ttitle"
          error={fieldErrors.title}
          hint={!fieldErrors.title ? tFallback(t, "titleHint", "Short, clear title students will see. e.g. 'IELTS Mock 7 — Academic'") : undefined}
        >
          <Input
            id="ttitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder={tFallback(t, "titlePlaceholder", "e.g. Mock 3 — Listening Practice")}
            aria-invalid={!!fieldErrors.title}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={tFallback(t, "level", "Level")}
            htmlFor="tlevel"
            error={fieldErrors.level}
            hint={!fieldErrors.level ? tFallback(t, "levelHint", "e.g. B2, C1, Academic") : undefined}
          >
            <Input
              id="tlevel"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="B2"
              aria-invalid={!!fieldErrors.level}
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5 text-fg-subtle" /> {tFallback(t, "duration", "Duration (min)")}
              </span> as unknown as string
            }
            htmlFor="tdur"
            error={fieldErrors.duration}
            hint={!fieldErrors.duration ? tFallback(t, "durationHint", "Leave empty for no limit") : undefined}
          >
            <Input
              id="tdur"
              type="number"
              min={1}
              max={600}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="60"
              aria-invalid={!!fieldErrors.duration}
            />
          </Field>
        </div>

        {/* Per-section random limits */}
        <div className="rounded-control border border-border bg-bg-subtle p-3">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="size-3.5 text-brand" />
            <p className="text-sm font-medium text-fg">{tFallback(t, "sectionLimits", "Per-section question limits")}</p>
          </div>
          <p className="text-xs text-fg-muted leading-relaxed mb-3">
            {tFallback(
              t,
              "sectionLimitsHint",
              "How many questions to show per section (random pick). Leave empty to use all questions. Helpful for large banks.",
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <Field
                key={s}
                label={tFallback(t, `sections.${s}`, s)}
                htmlFor={`cnt-${s}`}
                error={fieldErrors[`count_${s}`]}
                className="space-y-1"
              >
                <Input
                  id={`cnt-${s}`}
                  type="number"
                  min={1}
                  max={100}
                  placeholder={tFallback(t, "all", "All")}
                  value={counts[s]}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [s]: e.target.value }))}
                  aria-invalid={!!fieldErrors[`count_${s}`]}
                />
              </Field>
            ))}
          </div>
        </div>

        {/* Toggles with description */}
        <div className="space-y-3">
          <div
            className={cn(
              "rounded-control border p-3 flex items-start gap-3 transition-colors cursor-pointer",
              isDemo ? "border-info bg-info-bg/50" : "border-border bg-surface hover:bg-surface-hover",
            )}
            role="button"
            tabIndex={0}
            aria-pressed={isDemo}
            onClick={() => setIsDemo((v) => !v)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsDemo((v) => !v); } }}
          >
            <span
              className={cn(
                "mt-0.5 grid size-5 place-items-center rounded-chip border shrink-0",
                isDemo ? "bg-info border-info text-white" : "border-border bg-surface",
              )}
              aria-hidden
            >
              {isDemo && <Eye className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium flex items-center gap-1.5">
                {isDemo ? <Eye className="size-3.5 text-info" /> : <EyeOff className="size-3.5 text-fg-subtle" />}
                {tFallback(t, "isDemo", "Demo (visible to guests)")}
                {isDemo && <span className="ml-1 rounded-full bg-info px-1.5 py-0.5 text-[10px] font-semibold text-white">DEMO</span>}
              </p>
              <p className="text-xs text-fg-muted leading-relaxed mt-1">
                {tFallback(
                  t,
                  "isDemoHint",
                  "Demo tests are visible to guests and parents without enrollment. Use for public samples, placements, or survey-style reading/listening.",
                )}
              </p>
              <p className="text-xs text-info mt-1 font-medium">
                {tFallback(t, "demoActiveHint", "When ON, this test appears on the public demo list and requires no login.")}
              </p>
            </div>
          </div>

          {isEdit && (
            <div
              className={cn(
                "rounded-control border p-3 flex items-start gap-3 transition-colors cursor-pointer",
                isActive ? "border-success bg-success-bg/40" : "border-warning bg-warning-bg/30",
              )}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              onClick={() => setIsActive((v) => !v)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsActive((v) => !v); } }}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-chip border shrink-0",
                  isActive ? "bg-success border-success text-white" : "border-warning bg-warning text-warning-fg",
                )}
                aria-hidden
              >
                {isActive ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  {tFallback(t, "isActive", "Active")}
                  <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", isActive ? "bg-success text-white" : "bg-warning text-warning-fg")}>
                    {isActive ? tFallback(t, "activeOn", "Active") : tFallback(t, "activeOff", "Hidden")}
                  </span>
                </p>
                <p className="text-xs text-fg-muted leading-relaxed mt-1">
                  {tFallback(
                    t,
                    "isActiveHint",
                    "Inactive tests are hidden from students but remain editable for admins.",
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter className="border-t border-border mt-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={pending}>
          {tc("save")}
        </Button>
      </DialogFooter>
    </>
  );
}
