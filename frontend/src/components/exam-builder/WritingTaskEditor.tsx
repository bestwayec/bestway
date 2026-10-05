"use client";

import * as React from "react";
import { Eye, EyeOff, ImagePlus, Save, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  useDeleteMockGroup,
  useSetMockGroupMedia,
  useSaveMockGroupContent,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail, MockQuestionType } from "@/lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { StudentPreview } from "./StudentPreview";
import { nextQuestionNumber, tx, type Selection } from "./types";

type TaskKind = "task1" | "task2" | "informalLetter" | "formalLetter" | "publication";

function resolveTaskKind(
  group: NonNullable<MockExamDetail["sections"][number]["groups"][number] | undefined>,
  sectionGroups: MockExamDetail["sections"][number]["groups"],
  multilevel: boolean,
): TaskKind {
  if (multilevel) {
    const index = [...sectionGroups].sort((a, b) => a.sortOrder - b.sortOrder).findIndex((candidate) => candidate.id === group?.id);
    return (["informalLetter", "formalLetter", "publication"] as const)[index] ?? "informalLetter";
  }
  if (group?.questions.some((q) => q.type === "essay_task1")) return "task1";
  if (group?.questions.some((q) => q.type === "essay_task2")) return "task2";
  const title = group?.title?.toLowerCase() ?? "";
  if (title.includes("task 1") || title.trim() === "task 1") return "task1";
  if (title.includes("task 2") || title.trim() === "task 2") return "task2";
  // Empty new block: take the free slot so Task 1 + Task 2 stay exact.
  const hasT1 = sectionGroups.some((g) => g.questions.some((q) => q.type === "essay_task1"));
  if (!hasT1) return "task1";
  return "task2";
}

const TASK_META: Record<
  TaskKind,
  { label: string; type: MockQuestionType; recommended: number; time: string; placeholder: string; rawMax?: number; stimulusRef?: string }
> = {
  task1: {
    label: "Task 1",
    type: "essay_task1",
    recommended: 150,
    time: "You should spend about 20 minutes on this task.",
    placeholder: "e.g. The chart below shows… Summarise the information by selecting and reporting the main features.",
  },
  task2: {
    label: "Task 2",
    type: "essay_task2",
    recommended: 250,
    time: "You should spend about 40 minutes on this task.",
    placeholder: "e.g. Some people think… Discuss both views and give your own opinion.",
  },
  informalLetter: {
    label: "Task 1.1 — Informal Letter", type: "essay_task1", recommended: 50,
    time: "Write about 50 words.", placeholder: "Write an informal letter to a friend about the shared situation.", rawMax: 5, stimulusRef: "writing-task-1",
  },
  formalLetter: {
    label: "Task 1.2 — Formal Letter", type: "essay_task1", recommended: 120,
    time: "Write 120–150 words.", placeholder: "Write a formal letter about the same situation.", rawMax: 5, stimulusRef: "writing-task-1",
  },
  publication: {
    label: "Task 2 — Publication", type: "essay_task2", recommended: 180,
    time: "Write 180–200 words.", placeholder: "Write a publication, forum, or blog response.", rawMax: 6,
  },
};

interface LocalQ {
  clientKey: string;
  savedId?: string;
  number: number;
  prompt: string;
}

/**
 * Dedicated Writing editor: one task = one prompt, teacher-graded.
 *
 * Only writing-relevant fields: label, instructions, chart/context (+ diagram),
 * prompt, and a human-readable recommended minimum (150 / 250). No options,
 * no answer keys, no points input, no question-type menu — the type is fixed
 * by the task. Persistence reuses the standard group/question/media APIs, so a
 * reload keeps Task 1 / Task 2 intact.
 */
export function WritingTaskEditor({
  examId,
  detail,
  sectionId,
  groupId,
  onSelect,
  registerSave,
  onDirty,
}: {
  examId: string;
  detail: MockExamDetail;
  sectionId: string;
  groupId: string;
  onSelect: (s: Selection) => void;
  registerSave: (fn: (() => Promise<boolean>) | null) => void;
  onDirty: (d: boolean) => void;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const section = detail.sections.find((s) => s.id === sectionId);
  const group = section?.groups.find((g) => g.id === groupId);

  const saveContent = useSaveMockGroupContent(examId);
  // Track only IDs this editor has loaded or saved; never delete unseen additions.
  const persistedQuestionIds = React.useRef(group?.questions.map((q) => q.id) ?? []);
  const setMedia = useSetMockGroupMedia(examId);
  const delGroup = useDeleteMockGroup(examId);

  const kind: TaskKind = React.useMemo(
    () => (group && section ? resolveTaskKind(group, section.groups, detail.type === "multilevel") : "task1"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on groupId/sectionId to avoid recompute on object identity
    [groupId, sectionId],
  );
  const meta = TASK_META[kind];

  const initial = React.useMemo(() => {
    if (!group) return null;
    const qs: LocalQ[] =
      group.questions.length > 0
        ? group.questions.map((q) => ({
            clientKey: q.id,
            savedId: q.id,
            number: q.number,
            prompt: q.prompt ?? "",
          }))
        : [
            {
              clientKey: `new-${kind}`,
              number: nextQuestionNumber(detail.sections),
              prompt: "",
            },
          ];
    return {
      title: group.title ?? "",
      instructions: group.instructions ?? "",
      passageText: group.passageText ?? "",
      questions: qs,
      _q0type: group.questions[0]?.type ?? meta.type,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial snapshot only; group/detail omitted to avoid wiping draft edits
  }, [groupId]);

  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [instructions, setInstructions] = React.useState(initial?.instructions ?? "");
  const [passageText, setPassageText] = React.useState(initial?.passageText ?? "");
  const [questions, setQuestions] = React.useState<LocalQ[]>(initial?.questions ?? []);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [localImageUrl, setLocalImageUrl] = React.useState<string | null>(null);
  const [showPreview, setShowPreview] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const [baseline, setBaseline] = React.useState(initial);

  React.useEffect(
    () => () => {
      if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    },
    [localImageUrl],
  );

  const dirty = React.useMemo(() => {
    if (!baseline) return false;
    return (
      title !== baseline.title ||
      instructions !== baseline.instructions ||
      passageText !== baseline.passageText ||
      JSON.stringify(questions) !== JSON.stringify(baseline.questions) ||
      imageFile != null
    );
  }, [title, instructions, passageText, questions, imageFile, baseline]);
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = React.useCallback(async () => {
    if (!group || !section) return false;
    const errs: string[] = [];
    if (questions.length === 0) errs.push("Add at least one question");
    questions.forEach((q) => {
      if (!q.prompt.trim()) errs.push(`Task prompt is required`);
    });
    // De-dupe identical messages so one empty prompt = one error.
    const unique = [...new Set(errs)];
    setErrors(unique);
    if (unique.length > 0) {
      toast.error(tx(t, "fixErrors", "Fix the errors above first."));
      return false;
    }
    setSaving(true);
    try {
      const saved = await saveContent.mutateAsync({
        groupId: group.id,
        input: {
          title: title.trim() || meta.label,
          instructions: instructions.trim(),
          passageText: passageText.trim(),
          ...(meta.rawMax ? { maxScore: meta.rawMax, stimulusRef: meta.stimulusRef } : {}),
        },
        questions: questions.map((q) => ({ id: q.savedId, number: q.number, type: meta.type as MockQuestionType, prompt: q.prompt, points: meta.rawMax ?? 9 })),
        deletedQuestionIds: persistedQuestionIds.current.filter((id) => !questions.some((local) => local.savedId === id)),
      });
      persistedQuestionIds.current = saved.questions.map((q) => q.id);
      const savedQuestions = questions.map((q, index) => ({ ...q, savedId: saved.questions[index].id }));
      setQuestions(savedQuestions);
      if (imageFile) {
        const form = new FormData();
        form.append("image", imageFile);
        await setMedia.mutateAsync({ groupId: group.id, form });
      }
      toast.success(tc("saved"));
      setErrors([]);
      setBaseline({ title, instructions, passageText, questions: JSON.parse(JSON.stringify(savedQuestions)), _q0type: meta.type });
      if (imageFile) setImageFile(null);
      if (localImageUrl) {
        URL.revokeObjectURL(localImageUrl);
        setLocalImageUrl(null);
      }
      return true;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : tc("unknownError");
      setErrors([msg]);
      toast.error(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }, [group, section, questions, title, instructions, passageText, imageFile, meta, saveContent, setMedia, localImageUrl, t, tc]);

  React.useEffect(() => {
    registerSave(() => save());
    return () => registerSave(null);
  }, [registerSave, save]);

  if (!section || !group || !initial) return null;

  const promptMissing = questions.some((q) => !q.prompt.trim());
  const serverImage = `/api/backend/mock/groups/${group.id}/image`;

  return (
    <div className="space-y-4">
      {/* Task context — the admin always knows which task this is. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-fg-muted">
          Writing <span aria-hidden>→</span>{" "}
          <span className="font-bold text-fg">{meta.label}</span>
        </p>
        <Badge variant="info" className="ml-auto">
          Teacher graded
        </Badge>
      </div>

      {errors.length > 0 && (
        <div className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e, i) => (
              <li key={`${e}-${i}`}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Writing {meta.label} <span className="font-normal text-fg-muted">· content</span>
          </CardTitle>
          <p className="text-xs text-fg-muted">
            {meta.time} Recommended minimum: {meta.recommended} words.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Task label" hint="Shown to students as WRITING TASK 1 / 2." htmlFor="wt-title">
            <Input
              id="wt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={meta.label}
            />
          </Field>

          <Field
            label="Task instructions (optional)"
            hint="Shown above the prompt — e.g. time guidance."
            htmlFor="wt-instr"
          >
            <Textarea
              id="wt-instr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-20"
              placeholder={meta.time}
            />
          </Field>

          <Field
            label="Chart / supporting material (optional)"
            hint="Paste chart data, table contents, or background text students need."
            htmlFor="wt-material"
          >
            <Textarea
              id="wt-material"
              value={passageText}
              onChange={(e) => setPassageText(e.target.value)}
              className="min-h-24"
            />
          </Field>

          <div className="rounded-[8px] border border-border p-3">
            <p className="text-sm font-semibold text-fg">
              <ImagePlus className="mr-1.5 inline size-4" aria-hidden />
              Diagram / image <span className="font-normal text-fg-subtle">(optional)</span>
            </p>
            {(group.imageUrl || localImageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- blob: object URL preview (URL.createObjectURL); next/image cannot optimize blob: URLs
              <img
                src={localImageUrl ?? serverImage}
                alt=""
                className="mt-2 max-h-48 rounded-[8px] border border-border"
              />
            )}
            <div className="mt-2">
              <input
                ref={imageRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (localImageUrl) URL.revokeObjectURL(localImageUrl);
                  setLocalImageUrl(URL.createObjectURL(f));
                  setImageFile(f);
                }}
              />
              <Button size="sm" variant="outline" onClick={() => imageRef.current?.click()}>
                <Upload className="size-4" aria-hidden />
                {group.imageUrl || imageFile ? "Replace image" : "Upload image"}
              </Button>
              {imageFile && <span className="ml-2 text-xs text-fg-muted">{imageFile.name}</span>}
            </div>
            <p className="mt-1.5 text-[11px] text-fg-subtle">
              Task 1 often includes a chart or diagram. Task 2 usually needs none.
            </p>
          </div>

          {questions.map((q, qi) => (
            <Field
              key={q.clientKey}
              label={questions.length > 1 ? `Task prompt ${qi + 1}` : "Task prompt"}
              hint="The exact question students read. Required."
              htmlFor={`wt-prompt-${q.clientKey}`}
              error={!q.prompt.trim() ? "Task prompt is required." : undefined}
            >
              <Textarea
                id={`wt-prompt-${q.clientKey}`}
                value={q.prompt}
                onChange={(e) =>
                  setQuestions((prev) =>
                    prev.map((x) => (x.clientKey === q.clientKey ? { ...x, prompt: e.target.value } : x)),
                  )
                }
                className="min-h-32"
                placeholder={meta.placeholder}
              />
            </Field>
          ))}

          <div className="rounded-[8px] border border-border bg-surface-hover p-3 text-sm">
            <p className="font-semibold text-fg">Recommended minimum: {meta.recommended} words</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Students see a gentle reminder at {meta.recommended} words. There is no automatic
              fail — you score the essay 0–9.
            </p>
          </div>

          <div className="rounded-[8px] border border-brand/25 bg-brand-subtle/40 p-3 text-sm">
            <p className="font-semibold text-fg">Teacher graded</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              No answer key needed. You score this 0–9; it counts toward the Writing band
              {kind === "task2" ? " (Task 2 counts double)" : " (Task 2 counts double)"}.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={saving} onClick={() => void save()}>
              <Save className="size-4" aria-hidden />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
            >
              {showPreview ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              {tx(t, "preview", "Preview")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={delGroup.isPending}
              onClick={() => setConfirmDelete(true)}
              className="ml-auto"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete {meta.label.toLowerCase()}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPreview && (
        <div className="rounded-[12px] border border-brand/30 bg-surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Student view · writing
          </p>
          <h4 className="mt-1 text-base font-black tracking-wide text-fg">
            WRITING {meta.label.toUpperCase()}
          </h4>
          <p className="mt-1 text-[13px] text-fg-muted">{meta.time}</p>
          {(instructions.trim() || passageText.trim()) && (
            <p className="mt-1.5 rounded-[8px] bg-sky-500/10 px-2.5 py-1.5 text-[13px] text-fg ring-1 ring-sky-500/20">
              {[instructions.trim(), passageText.trim()].filter(Boolean).join("\n\n")}
            </p>
          )}
          {(group.imageUrl || localImageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element -- blob: object URL preview (URL.createObjectURL); next/image cannot optimize blob: URLs
            <img
              src={localImageUrl ?? serverImage}
              alt=""
              className="mt-2 max-h-56 rounded-[8px] border border-border"
            />
          )}
          <div className="mt-3">
            <StudentPreview
              group={{
                id: group.id,
                title: null,
                instructions: null,
                passageText: null,
                hasAudio: false,
                imageUrl: null,
                questions: questions.map((q) => ({
                  id: q.clientKey,
                  number: q.number,
                  type: meta.type,
                  prompt: q.prompt || "(empty prompt)",
                  options: [],
                  points: 9,
                  wordLimit: null,
                })),
              }}
              skill="writing"
            />
          </div>
          <div className="mt-2">
            <Badge variant="info">{tx(t, "previewNote", "Preview only — students see this after you publish.")}</Badge>
          </div>
          {promptMissing && (
            <p className="mt-2 text-xs text-danger">
              This task is not ready yet — the prompt is missing.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${meta.label} — “${title.trim() || meta.label}”?`}
        description={`Delete this writing task and its prompt? Students will no longer see ${meta.label}.`}
        confirmLabel={`Delete ${meta.label.toLowerCase()}`}
        loading={delGroup.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          delGroup.mutate(group.id, {
            onSuccess: () => {
              toast.success(tx(t, "deletedGeneric", "Deleted"));
              onSelect({ kind: "section", sectionId });
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
          })
        }
      />
    </div>
  );
}
