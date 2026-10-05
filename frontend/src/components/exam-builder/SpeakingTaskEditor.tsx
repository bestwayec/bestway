"use client";

import * as React from "react";
import { Eye, EyeOff, ImagePlus, Mic, Plus, Save, Trash2 } from "lucide-react";
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
import type { MockQuestionType, MockExamDetail } from "@/lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { StudentPreview } from "./StudentPreview";
import { nextQuestionNumber, tx, type Selection } from "./types";

interface LocalQ {
  clientKey: string;
  savedId?: string;
  number: number;
  prompt: string;
}

/**
 * Focused Speaking editor: prompt + instructions only.
 *
 * No answer keys, no options, no points input, no question-type menu — the
 * type is always speaking_task. Students record audio; teachers score 0–9.
 * Group audio/image are preserved server-side but not exposed, keeping the
 * UI calm. Persistence reuses the standard group/question APIs.
 */
export function SpeakingTaskEditor({
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
  const delGroup = useDeleteMockGroup(examId);

  const groupIdsKey = section?.groups.map((g) => g.id).join(",") ?? "";
  const partIndex = React.useMemo(() => {
    if (!section) return 0;
    const sorted = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
    const i = sorted.findIndex((g) => g.id === groupId);
    return i >= 0 ? i : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on groupIdsKey string to avoid recompute on section object identity
  }, [groupIdsKey, groupId]);
  const partLabel = group?.title?.trim() || `Part ${partIndex + 1}`;
  const multilevel = detail.type === "multilevel";
  const requiredResponses = multilevel ? ([3, 3, 1, 1][partIndex] ?? 1) : 1;
  const partMax = multilevel ? ([5, 5, 5, 6][partIndex] ?? 5) : 9;
  const canonicalLabel = multilevel ? `Part ${(["1.1", "1.2", "2", "3"][partIndex] ?? partIndex + 1)}` : partLabel;

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
        : Array.from({ length: requiredResponses }, (_, index) => ({ clientKey: `new-speaking-${index}`, number: nextQuestionNumber(detail.sections) + index, prompt: "" }));
    return {
      title: group.title ?? "",
      instructions: group.instructions ?? "",
      context: group.passageText ?? "",
      questions: qs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial snapshot only; group/detail omitted to avoid wiping draft edits
  }, [groupId]);

  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [instructions, setInstructions] = React.useState(initial?.instructions ?? "");
  const [context, setContext] = React.useState(initial?.context ?? "");
  const [questions, setQuestions] = React.useState<LocalQ[]>(initial?.questions ?? []);
  const [showPreview, setShowPreview] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const setMedia = useSetMockGroupMedia(examId);
  const [baseline, setBaseline] = React.useState(initial);

  const dirty = React.useMemo(() => {
    if (!baseline) return false;
    return (
      title !== baseline.title ||
      instructions !== baseline.instructions ||
      context !== baseline.context ||
      JSON.stringify(questions) !== JSON.stringify(baseline.questions)
    );
  }, [title, instructions, context, questions, baseline]);
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = React.useCallback(async () => {
    if (!group || !section) return false;
    const errs: string[] = [];
    if (questions.length !== requiredResponses) errs.push(multilevel ? `${canonicalLabel} requires exactly ${requiredResponses} responses.` : "Add at least one speaking prompt");
    if (questions.some((q) => !q.prompt.trim())) errs.push("Speaking prompt is required");
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
          title: title.trim() || canonicalLabel,
          instructions: instructions.trim(),
          passageText: context.trim(),
          ...(multilevel ? { maxScore: partMax } : {}),
        },
        questions: questions.map((q) => ({ id: q.savedId, number: q.number, type: "speaking_task" as MockQuestionType, prompt: q.prompt, points: partMax })),
        deletedQuestionIds: persistedQuestionIds.current.filter((id) => !questions.some((local) => local.savedId === id)),
      });
      persistedQuestionIds.current = saved.questions.map((q) => q.id);
      if (multilevel && partIndex === 1 && imageFile) {
        const form = new FormData();
        form.append("image", imageFile);
        await setMedia.mutateAsync({ groupId: group.id, form });
        setImageFile(null);
      }
      const savedQuestions = questions.map((q, index) => ({ ...q, savedId: saved.questions[index].id }));
      setQuestions(savedQuestions);
      toast.success(tc("saved"));
      setErrors([]);
      setBaseline({ title, instructions, context, questions: JSON.parse(JSON.stringify(savedQuestions)) });
      return true;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : tc("unknownError");
      setErrors([msg]);
      toast.error(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }, [group, section, questions, title, instructions, context, partLabel, canonicalLabel, multilevel, partIndex, partMax, requiredResponses, imageFile, saveContent, setMedia, t, tc]);

  React.useEffect(() => {
    registerSave(() => save());
    return () => registerSave(null);
  }, [registerSave, save]);

  if (!section || !group || !initial) return null;

  const promptMissing = questions.some((q) => !q.prompt.trim());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-fg-muted">
          Speaking <span aria-hidden>→</span> <span className="font-bold text-fg">{partLabel}</span>
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
            {partLabel} <span className="font-normal text-fg-muted">· prompt</span>
          </CardTitle>
          <p className="text-xs text-fg-muted">
            Students record an audio answer. No answer key — you score it 0–9.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Task label" hint="e.g. Part 1, Part 2, Part 3." htmlFor="sp-title">
            <Input
              id="sp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Part ${partIndex + 1}`}
            />
          </Field>

          <Field
            label="Instructions (optional)"
            hint="Short guidance shown with the prompt."
            htmlFor="sp-instr"
          >
            <Textarea
              id="sp-instr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-20"
              placeholder="e.g. Talk about this topic for 1–2 minutes."
            />
          </Field>

          {questions.map((q, qi) => (
            <Field
              key={q.clientKey}
              label={questions.length > 1 ? `Speaking prompt ${qi + 1}` : "Speaking prompt"}
              hint="The exact cue students see and respond to. Required."
              htmlFor={`sp-prompt-${q.clientKey}`}
              error={!q.prompt.trim() ? "Speaking prompt is required." : undefined}
            >
              <Textarea
                id={`sp-prompt-${q.clientKey}`}
                value={q.prompt}
                onChange={(e) =>
                  setQuestions((prev) =>
                    prev.map((x) => (x.clientKey === q.clientKey ? { ...x, prompt: e.target.value } : x)),
                  )
                }
                className="min-h-28"
                placeholder="e.g. Describe a place you like to visit in your free time."
              />
            </Field>
          ))}
          {multilevel && questions.length < requiredResponses && (
            <Button size="sm" variant="outline" onClick={() => setQuestions((prev) => [...prev, { clientKey: `new-speaking-${prev.length}`, number: nextQuestionNumber(detail.sections) + prev.length, prompt: "" }])}>
              <Plus className="size-4" aria-hidden /> Add response
            </Button>
          )}

          <Field
            label="Extra context (optional)"
            hint="Cue-card bullets or follow-up points for Part 2 / Part 3."
            htmlFor="sp-context"
          >
            <Textarea
              id="sp-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="min-h-20"
              placeholder="e.g. You should say: where it is · who you go with · why you like it"
            />
          </Field>
          {multilevel && partIndex === 1 && (
            <Field label="Two-picture asset" hint="Upload one paired image asset containing the two related pictures." htmlFor="sp-two-picture">
              <input ref={imageRef} id="sp-two-picture" type="file" accept="image/*" className="sr-only" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} />
              <Button type="button" size="sm" variant="outline" onClick={() => imageRef.current?.click()}><ImagePlus className="size-4" />{imageFile ? imageFile.name : group.imageUrl ? "Replace paired images" : "Upload paired images"}</Button>
            </Field>
          )}

          <div className="rounded-[8px] border border-brand/25 bg-brand-subtle/40 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-fg">
              <Mic className="size-4" aria-hidden /> Teacher graded
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Students record audio in the runner. No answer key needed — you score each response
              0–9 with optional band rubrics.
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
              Delete task
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPreview && (
        <div className="rounded-[12px] border border-brand/30 bg-surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            Student view · speaking
          </p>
          <h4 className="mt-1 text-base font-bold text-fg">{partLabel}</h4>
          {instructions.trim() && (
            <p className="mt-1.5 rounded-[8px] bg-sky-500/10 px-2.5 py-1.5 text-[13px] text-fg ring-1 ring-sky-500/20">
              {instructions.trim()}
            </p>
          )}
          {context.trim() && (
            <div className="mt-2 whitespace-pre-wrap rounded-[8px] bg-surface-hover p-3 text-sm leading-relaxed text-fg">
              {context.trim()}
            </div>
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
                  type: "speaking_task",
                  prompt: q.prompt || "(empty prompt)",
                  options: [],
                  points: 9,
                  wordLimit: null,
                })),
              }}
              skill="speaking"
            />
          </div>
          <div className="mt-2">
            <Badge variant="info">{tx(t, "previewNote", "Preview only — students see this after you publish.")}</Badge>
          </div>
          {promptMissing && (
            <p className="mt-2 text-xs text-danger">
              This task is not ready yet — the speaking prompt is missing.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete task — “${partLabel}”?`}
        description="Delete this speaking task and its prompt? Students will no longer see it."
        confirmLabel="Delete task"
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
