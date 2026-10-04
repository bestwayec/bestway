"use client";

import * as React from "react";
import { Eye, EyeOff, ImagePlus, Music, Plus, Save, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { QuestionEditor } from "@/components/mock/exam-builder/QuestionEditor";
import {
  newQuestion,
  validatePart,
  type BuilderPart,
  type BuilderQuestion,
} from "@/components/mock/exam-builder/types";
import {
  useDeleteMockGroup,
  useSetMockGroupMedia,
  useSaveMockGroupContent,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail, MockQuestionType, MockSkill } from "@/lib/types";
import { ImportPanel } from "./ImportPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { StudentPreview } from "./StudentPreview";
import { VisualQuestionCanvas } from "./visual-editor/VisualQuestionCanvas";
import { SKILL_META, TYPES_BY_SKILL, nextQuestionNumber, tx, type Selection } from "./types";

function toBuilder(group: MockExamDetail["sections"][number]["groups"][number]): BuilderPart {
  return {
    clientId: group.id,
    title: group.title ?? "",
    instructions: group.instructions ?? "",
    passageText: group.passageText ?? "",
    partNumber: group.partNumber ?? undefined,
    audioFileName: undefined,
    audioPendingFile: null,
    audioDurationSec: group.audioDurationSec ?? undefined,
    audioPlayLimit: group.audioPlayLimit ?? 1,
    hasAudio: group.hasAudio,
    savedGroupId: group.id,
    questions: group.questions.map((q) => ({
      clientId: q.id,
      number: q.number,
      type: q.type,
      prompt: q.prompt,
      options: q.options ?? [],
      correctAnswers: q.correctAnswers ?? [],
      acceptedVariants: q.acceptedVariants ?? [],
      points: q.points,
      wordLimit: q.wordLimit ?? undefined,
      savedQuestionId: q.id,
    })),
  };
}

function defaultTypeFor(skill: MockSkill, existing: BuilderQuestion[]): MockQuestionType {
  if (skill === "writing")
    return existing.some((q) => q.type === "essay_task1") ? "essay_task2" : "essay_task1";
  if (skill === "speaking") return "speaking_task";
  return "multiple_choice";
}

function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One content block editor: material (title/instructions/passage/audio) +
 * its questions with a dynamic per-type editor + import + live preview.
 * Audio belongs to the block — never per question.
 */
export function GroupEditor({
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
  const skill: MockSkill = section?.skill ?? "listening";
  const meta = SKILL_META[skill];

  const saveContent = useSaveMockGroupContent(examId);
  // Track only IDs this editor has loaded or saved; never delete unseen additions.
  const persistedQuestionIds = React.useRef(group?.questions.map((q) => q.id) ?? []);
  const setMedia = useSetMockGroupMedia(examId);
  const delGroup = useDeleteMockGroup(examId);

  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [showImport, setShowImport] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [visualPreview, setVisualPreview] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const audioRef = React.useRef<HTMLInputElement | null>(null);
  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = React.useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = React.useState<string | null>(null);

  // Fresh server snapshot per group (parent keys by groupId).
  const [snapshot, setSnapshot] = React.useState<BuilderPart | null>(() => (group ? toBuilder(group) : null));
  const [part, setPart] = React.useState<BuilderPart | null>(() => snapshot);
  // Visual paste mode (Task 8): second view over the same part state.
  const [mode, setMode] = React.useState<"form" | "visual">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("examBuilder.questionMode") === "visual"
      ? "visual"
      : "form",
  );
  const [visualText, setVisualText] = React.useState(part?.passageText ?? "");
  const [visualQuestions, setVisualQuestions] = React.useState<BuilderQuestion[]>(part?.questions ?? []);
  const baseNumber = visualQuestions.length
    ? Math.min(...visualQuestions.map((q) => q.number)) - 1
    : nextQuestionNumber(detail.sections) - 1;
  React.useEffect(
    () => () => {
      if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
      if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    },
    [localAudioUrl, localImageUrl],
  );

  const dirty = React.useMemo(
    () =>
      JSON.stringify(part) !== JSON.stringify(snapshot) ||
      imageFile != null ||
      (mode === "visual" &&
        snapshot != null &&
        (visualText !== snapshot.passageText ||
          JSON.stringify(visualQuestions) !== JSON.stringify(snapshot.questions))),
    [part, snapshot, imageFile, mode, visualText, visualQuestions],
  );
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = React.useCallback(async () => {
    const g = group;
    if (!part || !g) return false;
    // Visual mode: run the same save body against the visual copies.
    let p = mode === "visual" ? { ...part, passageText: visualText, questions: visualQuestions } : part;
    if (!p || !g) return false;
    const errs = validatePart(skill, p);
    if (p.passageText.length > 20000) {
      errs.push(tx(t, "passageTooLong", "Passage text must be 20000 characters or fewer."));
    }
    setErrors(errs);
    if (errs.length > 0) {
      toast.error(tx(t, "fixErrors", "Fix the errors above first."));
      return false;
    }
    setSaving(true);
    try {
      const saved = await saveContent.mutateAsync({
        groupId: g.id,
        input: {
          title: p.title.trim() || undefined,
          instructions: p.instructions.trim(),
          passageText: p.passageText.trim(),
          partNumber: p.partNumber,
          audioDurationSec: p.audioDurationSec,
          audioPlayLimit: p.audioPlayLimit,
        },
        questions: p.questions.map((q) => ({ id: q.savedQuestionId, number: q.number, type: q.type, prompt: q.prompt,
          options: q.options, correctAnswers: q.correctAnswers, acceptedVariants: q.acceptedVariants,
          points: q.points, wordLimit: q.wordLimit })),
        deletedQuestionIds: persistedQuestionIds.current.filter((id) => !p.questions.some((local) => local.savedQuestionId === id)),
      });
      persistedQuestionIds.current = saved.questions.map((q) => q.id);
      const savedQuestions = p.questions.map((q, index) => ({ ...q, savedQuestionId: saved.questions[index].id }));
      p = { ...p, questions: savedQuestions };
      setPart(p);
      if (mode === "visual") setVisualQuestions(savedQuestions);
      if (p.audioPendingFile || imageFile) {
        const form = new FormData();
        if (p.audioPendingFile) form.append("audio", p.audioPendingFile);
        if (imageFile) form.append("image", imageFile);
        await setMedia.mutateAsync({ groupId: g.id, form });
      }
      toast.success(tc("saved"));
      setErrors([]);
      const cleaned: BuilderPart = { ...p, audioPendingFile: null, audioFileName: p.audioPendingFile ? p.audioPendingFile.name : p.audioFileName };
      setSnapshot(JSON.parse(JSON.stringify(cleaned)));
      setPart(cleaned);
      if (mode === "visual") {
        setVisualText(cleaned.passageText);
        setVisualQuestions(cleaned.questions);
      }
      if (imageFile) setImageFile(null);
      if (localAudioUrl) {
        URL.revokeObjectURL(localAudioUrl);
        setLocalAudioUrl(null);
      }
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
  }, [part, group, skill, imageFile, mode, visualText, visualQuestions, saveContent, setMedia, localAudioUrl, localImageUrl, t, tc]);

  React.useEffect(() => {
    registerSave(() => save());
    return () => registerSave(null);
  }, [registerSave, save]);

  if (!section || !group || !part) return null;

  function update(fn: (p: BuilderPart) => BuilderPart) {
    setPart((p) => (p ? fn(p) : p));
  }

  function selectMode(m: "form" | "visual") {
    const current = part;
    if (m === "visual" && current) {
      setVisualText(current.passageText);
      setVisualQuestions(current.questions);
    }
    if (m === "form" && mode === "visual") {
      update((p) => ({ ...p, passageText: visualText, questions: visualQuestions }));
    }
    setVisualPreview(false);
    setMode(m);
    try {
      window.localStorage.setItem("examBuilder.questionMode", m);
    } catch {
      // Private-mode storage may throw — mode still switches for this session.
    }
  }

  function addQuestion() {
    const p = part;
    if (!p) return;
    const maxLocal = p.questions.reduce((m, q) => Math.max(m, q.number), 0);
    const maxExam = nextQuestionNumber(detail.type === 'multilevel' ? detail.sections.filter((s) => s.id === sectionId) : detail.sections) - 1;
    const number = Math.max(maxLocal, maxExam) + 1;
    const specPart = detail.specification?.[skill].parts[detail.sections.find((s) => s.id === sectionId)?.groups.findIndex((g) => g.id === groupId) ?? 0];
    const type = (specPart?.types[0] as MockQuestionType | undefined) ?? defaultTypeFor(skill, p.questions);
    const auto = type !== "essay_task1" && type !== "essay_task2" && type !== "speaking_task";
    update((prev) => ({ ...prev, questions: [...prev.questions, { ...newQuestion(number, type, auto), points: specPart?.rawMax ?? (auto ? 1 : 9), ...(['short_answer','note_completion','sentence_completion','summary_completion'].includes(type) && specPart ? { wordLimit: 1 } : {}) }] }));
  }

  function handleDeleteGroup() {
    setConfirmDelete(true);
  }

  const serverAudio = `/api/backend/mock/groups/${group.id}/audio`;
  const serverImage = `/api/backend/mock/groups/${group.id}/image`;
  const specificationPart = detail.specification?.[skill].parts[detail.sections.find((s) => s.id === sectionId)?.groups.findIndex((g) => g.id === groupId) ?? 0];
  const allowedTypes = (specificationPart?.types as MockQuestionType[] | undefined) ?? TYPES_BY_SKILL[skill];
  // Unsaved visual draft for student preview (Task 9): same question mapping as
  // previewGroup, but passage/questions come from visual state. Constant id keeps
  // PreviewBody key stable (answers reset only on toggle). Explicit srcs point at
  // the real group / local blob URLs since the draft id has no server media.
  const visualDraft = {
    id: "visual-paste-draft",
    title: part.title,
    instructions: part.instructions,
    passageText: visualText,
    contentHtml: null,
    hasAudio: part.hasAudio || group.hasAudio,
    imageUrl: localImageUrl ?? group.imageUrl,
    questions: visualQuestions.map(toPreviewQuestion),
  };
  const visualAudioSrc = localAudioUrl ?? serverAudio;
  const visualImageSrc = localImageUrl ?? (group.imageUrl ? serverImage : null);

  return (
    <div className="min-w-0 space-y-4">
      {errors.length > 0 && (
        <div className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Material */}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle className="min-w-0 flex-1 truncate">
              {part.title.trim() || `${meta.unit} · ${tx(t, "material", "material")}`}
            </CardTitle>
            <Badge variant="info" className="shrink-0 capitalize">
              {skill}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={tx(t, "blockTitle", "Block title")} htmlFor="ge-title" className="sm:col-span-2">
              <Input
                id="ge-title"
                value={part.title}
                onChange={(e) => update((p) => ({ ...p, title: e.target.value }))}
                placeholder={tx(t, "blockTitleHint", "e.g. Questions 1–5 — Complete the notes")}
              />
            </Field>
            {skill === "listening" && (
              <Field label={tx(t, "partNo", "Part number")} htmlFor="ge-partno">
                <Input
                  id="ge-partno"
                  type="number"
                  min={1}
                  max={detail.type === 'multilevel' ? 6 : 4}
                  value={part.partNumber ?? ""}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      partNumber: e.target.value === "" ? undefined : Number(e.target.value),
                    }))
                  }
                />
              </Field>
            )}
          </div>

          <Field label={tx(t, "instructions", "Instructions")} htmlFor="ge-instr">
            <Textarea
              id="ge-instr"
              value={part.instructions}
              onChange={(e) => update((p) => ({ ...p, instructions: e.target.value }))}
              className="min-h-20"
              placeholder={tx(t, "instrHint", "e.g. Complete the notes below. Write ONE WORD AND/OR A NUMBER.")}
            />
          </Field>

          {skill === "reading" && (
            <Field
              label={tx(t, "passage", "Reading passage")}
              hint={tx(t, "passageHint", "The text students read. Questions below belong to it.")}
              htmlFor="ge-passage"
            >
              <Textarea
                id="ge-passage"
                value={part.passageText}
                onChange={(e) => update((p) => ({ ...p, passageText: e.target.value }))}
                className="min-h-40 font-serif"
                disabled={mode === "visual"}
              />
            </Field>
          )}
          {mode === "visual" && skill === "reading" && (
            <p className="text-xs text-fg-muted">
              {tx(
                t,
                "visualPassageNote",
                "Visual paste mode is on — edit the passage in the canvas below.",
              )}
            </p>
          )}
          {(skill === "writing" || skill === "speaking") && (
            <Field
              label={tx(t, "taskMaterial", "Task material (optional)")}
              hint={tx(t, "taskMaterialHint", "Extra chart description, bullet points or context.")}
              htmlFor="ge-passage"
            >
              <Textarea
                id="ge-passage"
                value={part.passageText}
                onChange={(e) => update((p) => ({ ...p, passageText: e.target.value }))}
                className="min-h-24"
                disabled={mode === "visual"}
              />
            </Field>
          )}
          {detail.type === 'multilevel' && skill === 'writing' && <p className="text-sm text-fg-muted">Use the same source stimulus in task material for the informal and formal email tasks.</p>}
          {mode === "visual" && (skill === "writing" || skill === "speaking") && (
            <p className="text-xs text-fg-muted">
              {tx(
                t,
                "visualPassageNote",
                "Visual paste mode is on — edit the task material in the canvas below.",
              )}
            </p>
          )}

          {/* Audio belongs to the block */}
          <div className="rounded-[8px] border border-border p-3">
            <p className="text-sm font-semibold text-fg">
              <Music className="mr-1.5 inline size-4" />
              {tx(t, "audio", "Audio")} {skill !== "listening" && <span className="font-normal text-fg-subtle">{tx(t, "optional", "(optional)")}</span>}
            </p>
            {(group.hasAudio || part.audioPendingFile) && !localAudioUrl && (
              <audio controls preload="none" src={serverAudio} className="mt-2 h-9 w-full" />
            )}
            {localAudioUrl && (
              <audio controls preload="metadata" src={localAudioUrl} className="mt-2 h-9 w-full" />
            )}
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                ref={audioRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
                  setLocalAudioUrl(URL.createObjectURL(f));
                  update((p) => ({ ...p, audioPendingFile: f, audioFileName: f.name, hasAudio: true }));
                }}
              />
              <Button size="sm" variant="outline" onClick={() => audioRef.current?.click()} className="min-h-9 w-full justify-center sm:w-auto">
                <Upload className="size-4 shrink-0" aria-hidden />
                <span className="truncate">
                  {group.hasAudio || part.audioPendingFile
                    ? tx(t, "replaceAudio", "Replace audio")
                    : tx(t, "uploadAudio", "Upload audio")}
                </span>
              </Button>
              {(part.audioFileName || part.audioDurationSec != null) && (
                <span className="min-w-0 break-all text-xs text-fg-muted">
                  {part.audioFileName}
                  {part.audioDurationSec != null && ` · ${fmtDuration(part.audioDurationSec)}`}
                </span>
              )}
              <div className="flex items-center gap-2 sm:ml-auto">
                <Field label={tx(t, "playLimit", "Plays")} htmlFor="ge-plays" className="w-full sm:w-20">
                  <Input
                    id="ge-plays"
                    type="number"
                    min={1}
                    max={10}
                    value={part.audioPlayLimit}
                    onChange={(e) => {
                      const n = Math.min(10, Math.max(1, Math.floor(Number(e.target.value) || 1)));
                      update((p) => ({ ...p, audioPlayLimit: n }));
                    }}
                  />
                </Field>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-fg-subtle">
              {tx(t, "audioHint", "One audio per block. In Full Mock timed mode each student hears it once.")}
            </p>
          </div>

          {/* Image / diagram */}
          <div className="rounded-[8px] border border-border p-3">
            <p className="text-sm font-semibold text-fg">
              <ImagePlus className="mr-1.5 inline size-4" />
              {tx(t, "image", "Diagram / image")} <span className="font-normal text-fg-subtle">{tx(t, "optional", "(optional)")}</span>
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
                <Upload className="size-4" />
                {group.imageUrl || imageFile ? tx(t, "replaceImage", "Replace image") : tx(t, "uploadImage", "Upload image")}
              </Button>
              {imageFile && <span className="ml-2 text-xs text-fg-muted">{imageFile.name}</span>}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button size="sm" loading={saving} onClick={() => void save()} className="min-h-9 justify-center sm:w-auto">
              <Save className="size-4 shrink-0" aria-hidden />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={delGroup.isPending}
              onClick={handleDeleteGroup}
              className="min-h-9 justify-center sm:ml-auto sm:w-auto"
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "deleteBlock", "Delete block")}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Questions */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-fg">
          {tx(t, "questionsTitle", "Questions")} ({mode === "visual" ? visualQuestions.length : part.questions.length})
        </h3>
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
          <div
            className="col-span-2 flex items-center gap-1 rounded-[8px] border border-border p-1 sm:col-span-1"
            role="tablist"
            aria-label={tx(t, "questionMode", "Question mode")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "form"}
              onClick={() => selectMode("form")}
              className={`min-h-8 flex-1 rounded-[6px] px-3 py-1.5 text-xs font-medium transition sm:flex-none ${mode === "form" ? "bg-surface-hover text-fg" : "text-fg-muted hover:text-fg"}`}
            >
              {tx(t, "formList", "Form list")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "visual"}
              onClick={() => selectMode("visual")}
              className={`min-h-8 flex-1 rounded-[6px] px-3 py-1.5 text-xs font-medium transition sm:flex-none ${mode === "visual" ? "bg-surface-hover text-fg" : "text-fg-muted hover:text-fg"}`}
            >
              {tx(t, "visualPaste", "Visual paste")}
            </button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)} className="min-h-9 justify-center">
            {showPreview ? <EyeOff className="size-4 shrink-0" aria-hidden /> : <Eye className="size-4 shrink-0" aria-hidden />}
            <span className="truncate">{tx(t, "preview", "Preview")}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)} className="min-h-9 justify-center">
            <Upload className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{tx(t, "import", "Import")}</span>
          </Button>
          {mode === "form" && (
            <Button size="sm" variant="outline" onClick={addQuestion} className="col-span-2 min-h-9 justify-center sm:col-span-1">
              <Plus className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "addQuestion", "Add question")}</span>
            </Button>
          )}
        </div>
      </div>

      {showPreview && <StudentPreview group={previewGroup(part, group)} skill={skill} />}

      {showImport && (
        <ImportPanel
          examId={examId}
          groupId={group.id}
          skill={skill}
          onDone={(added) => {
            setShowImport(false);
            if (!added || added.length === 0 || !group) return;
            const have = new Set(group.questions.map((q) => q.id));
            const merged = added
              .filter((q) => q && typeof q.id === "string" && !have.has(q.id))
              .map((q) => ({
                clientId: q.id,
                number: q.number,
                type: q.type as typeof part.questions[number]["type"],
                prompt: q.prompt ?? "",
                options: q.options ?? [],
                correctAnswers: q.correctAnswers ?? [],
                acceptedVariants: q.acceptedVariants ?? [],
                points: q.points ?? 1,
                wordLimit: q.wordLimit ?? undefined,
                savedQuestionId: q.id,
              }));
            if (merged.length === 0) return;
            update((prev) => ({ ...prev, questions: [...prev.questions, ...merged] }));
          }}
          groupLabel={`${skill.charAt(0).toUpperCase() + skill.slice(1)} → ${part.title.trim() || meta.unit}`}
          existingNumbers={detail.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.number)))}
        />
      )}

      {mode === "visual" ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setVisualPreview((v) => !v)}>
              {visualPreview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {visualPreview
                ? tx(t, "preview", "Preview")
                : tx(t, "visualPreview", "Preview as student")}
            </Button>
          </div>
          {visualPreview ? (
            <StudentPreview
              group={visualDraft}
              skill={skill}
              audioSrc={visualAudioSrc}
              imageSrc={visualImageSrc}
            />
          ) : null}
          <div className={visualPreview ? "hidden" : undefined}>
            <VisualQuestionCanvas
              skill={skill}
              initialText={visualText}
              initialQuestions={visualQuestions}
              baseNumber={baseNumber}
              onChange={(text, questions) => {
                setVisualText(text);
                setVisualQuestions(questions);
              }}
            />
          </div>
        </div>
      ) : part.questions.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">
              {part.title.trim() || meta.unit} {tx(t, "noQuestionsTitle", "has no questions yet.")}
            </p>
            <p className="text-sm text-fg-muted">
              {tx(
                t,
                "noQuestionsWhy",
                "Questions belong to this block and are numbered across the whole exam. Add one manually, or paste many at once with Import.",
              )}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={addQuestion}>
                <Plus className="size-4" />
                {tx(t, "addQuestion", "Add question")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="size-4" />
                {tx(t, "import", "Import")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {part.questions.map((q) => (
            <QuestionEditor
              key={q.clientId}
              question={q}
              skill={skill}
              allowedTypes={allowedTypes}
              onChange={(next) =>
                update((p) => ({
                  ...p,
                  questions: p.questions.map((x) => (x.clientId === q.clientId ? { ...next, ...(specificationPart ? { points: specificationPart.rawMax ?? 1 } : {}) } : x)),
                }))
              }
              onRemove={() =>
                update((p) => ({ ...p, questions: p.questions.filter((x) => x.clientId !== q.clientId) }))
              }
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`${tx(t, "deleteBlock", "Delete block")} — “${part.title.trim() || meta.unit}”?`}
        description={tx(
          t,
          "deleteBlockConfirm",
          `Delete this block and all its questions? This will remove ${part.questions.length} ${part.questions.length === 1 ? "question" : "questions"}.`,
        )}
        confirmLabel={tx(t, "deleteBlock", "Delete block")}
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

/** Shared question mapping for student preview (saved + visual draft). */
function toPreviewQuestion(q: BuilderQuestion) {
  return {
    id: q.clientId,
    number: q.number,
    type: q.type,
    prompt: q.prompt || "(empty question)",
    options: q.options,
    points: q.points,
    wordLimit: q.wordLimit ?? null,
  };
}

/** Server group shape for the read-only student preview (local edits applied). */
function previewGroup(
  part: BuilderPart,
  server: { id: string; hasAudio: boolean; imageUrl: string | null; contentHtml?: string | null },
) {
  return {
    id: server.id,
    title: part.title,
    instructions: part.instructions,
    passageText: part.passageText,
    contentHtml: server.contentHtml ?? null,
    hasAudio: part.hasAudio || server.hasAudio,
    imageUrl: server.imageUrl,
    questions: part.questions.map(toPreviewQuestion),
  };
}
