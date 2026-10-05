"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  ImagePlus,
  Plus,
  Save,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { QuestionEditor } from "@/components/mock/exam-builder/QuestionEditor";
import {
  QTYPE_LABEL,
  validateDraftPart,
  type BuilderPart,
  type BuilderQuestion,
} from "@/components/mock/exam-builder/types";
import {
  useDeleteMockGroup,
  useSetMockGroupMedia,
  useSaveMockGroupContent,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail, MockGroup, MockQuestionType } from "@/lib/types";
import { duplicateNumberErrors, isDuplicateNumber, questionIssues } from "./checks";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImportPanel, type ImportedServerQuestion } from "./ImportPanel";
import { ListeningAudioCard } from "./ListeningAudioCard";
import { StudentPreview } from "./StudentPreview";
import { QuestionGroupSettings } from "./QuestionGroupSettings";
import { newPresetQuestion, presetForPart, type QuestionFormatPreset } from "./question-format-model";
import { VisualQuestionCanvas, visualScratchKey } from "./visual-editor/VisualQuestionCanvas";
import { TYPES_BY_SKILL, nextQuestionNumber, tx, type Selection } from "./types";

const LISTENING_TYPES = TYPES_BY_SKILL["listening"];

function toBuilderPart(group: MockGroup): BuilderPart {
  return {
    clientId: group.id,
    title: group.title ?? "",
    instructions: group.instructions ?? "",
    passageText: group.passageText ?? "",
    contentHtml: group.contentHtml ?? "",
    contentLayout: (group.contentLayout ?? undefined) as BuilderPart["contentLayout"],
    optionsReusable: group.optionsReusable ?? null,
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
        answerRule: q.answerRule ?? null,
      savedQuestionId: q.id,
    })),
  };
}

export function partRangeLabel(numbers: number[]): string | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.length > 1 ? `${sorted[0]}–${sorted[sorted.length - 1]}` : `${sorted[0]}`;
}

export function partTypeSummary(types: MockQuestionType[]): string {
  const distinct = [...new Set(types)];
  if (distinct.length === 0) return "";
  const labels = distinct.map((t) => QTYPE_LABEL[t] ?? t);
  if (labels.length === 1) return labels[0];
  return `${labels[0]} + ${labels.length - 1} more`;
}

/**
 * Dedicated IELTS Listening part editor.
 *
 * Mental model: Part → audio → question group → questions. One backend
 * question group IS the part (it owns `partNumber` + the audio file), so the
 * part's whole question set is presented as its single question group —
 * no database concepts leak into the UI.
 */
export function ListeningPartEditor({
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

  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [showImport, setShowImport] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [visualPreview, setVisualPreview] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadErrorDetail, setUploadErrorDetail] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = React.useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = React.useState<string | null>(null);

  // Fresh server snapshot per part (parent keys by groupId).
  const [snapshot, setSnapshot] = React.useState<BuilderPart | null>(() => (group ? toBuilderPart(group) : null));
  const [part, setPart] = React.useState<BuilderPart | null>(() => snapshot);
  const draftVersion = React.useRef(detail.contentVersion);
  const [formatPreset, setFormatPreset] = React.useState<QuestionFormatPreset | undefined>(() => snapshot ? presetForPart(snapshot) : undefined);
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
    const errs = [...validateDraftPart(p), ...duplicateErrors(detail, g.id, p.questions)];
    if (p.passageText.length > 20000) {
      errs.push(tx(t, "passageTooLong", "Passage text must be 20000 characters or fewer."));
    }
    setErrors(errs);
    if (errs.length > 0) {
      // Open every row that needs attention so nothing hides below the fold.
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const q of p.questions) {
          if (
            questionIssues(
              {
                id: q.clientId,
                number: q.number,
                sortOrder: 0,
                type: q.type,
                prompt: q.prompt,
                options: q.options,
                points: q.points,
                wordLimit: q.wordLimit ?? null,
    answerRule: q.answerRule ?? null,
                correctAnswers: q.correctAnswers,
              },
              "listening",
            ).length > 0 ||
            isDuplicate(detail, g.id, p.questions, q)
          ) {
            next.add(q.clientId);
          }
        }
        return next;
      });
      toast.error(tx(t, "fixErrors", "Fix the errors above first."));
      return false;
    }
    setSaving(true);
    setUploadError(null);
    setUploadErrorDetail(null);
    try {
      const saved = await saveContent.mutateAsync({
        groupId: g.id,
        expectedContentVersion: draftVersion.current,
        input: {
          title: p.title.trim() || undefined,
          instructions: p.instructions.trim(),
          passageText: p.passageText.trim(),
          contentHtml: p.contentHtml,
          contentLayout: p.contentLayout,
          optionsReusable: p.optionsReusable,
          partNumber: p.partNumber,
          audioDurationSec: p.audioDurationSec,
          audioPlayLimit: p.audioPlayLimit,
        },
        questions: p.questions.map((q) => ({ id: q.savedQuestionId, number: q.number, type: q.type, prompt: q.prompt,
          options: q.options, correctAnswers: q.correctAnswers, acceptedVariants: q.acceptedVariants,
          points: q.points, wordLimit: q.wordLimit, answerRule: q.answerRule })),
        deletedQuestionIds: persistedQuestionIds.current.filter((id) => !p.questions.some((local) => local.savedQuestionId === id)),
      });
      persistedQuestionIds.current = saved.questions.map((q) => q.id);
      draftVersion.current = saved.version;
      const savedQuestions = p.questions.map((q, index) => ({ ...q, savedQuestionId: saved.questions[index].id }));
      p = { ...p, questions: savedQuestions };
      setPart(p);
      if (mode === "visual") setVisualQuestions(savedQuestions);
      if (p.audioPendingFile || imageFile) {
        const form = new FormData();
        if (p.audioPendingFile) form.append("audio", p.audioPendingFile);
        if (imageFile) form.append("image", imageFile);
        try {
          const media = await setMedia.mutateAsync({ groupId: g.id, form });
          draftVersion.current = media.version;
        } catch (e) {
          // Text edits above already persisted; keep the local file selection
          // intact so the admin can retry without losing anything.
          const raw = e instanceof ApiError ? e.message : tc("unknownError");
          setUploadError(tx(t, "uploadFailed", "Media upload failed — text changes were saved."));
          setUploadErrorDetail(raw);
          toast.error(tx(t, "uploadFailed", "Media upload failed — text changes were saved."));
          return false;
        }
      }
      toast.success(tc("saved"));
      setErrors([]);
      // Keep dirty in sync: baseline now matches the saved state and pending media is consumed.
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
  }, [part, group, detail, imageFile, mode, visualText, visualQuestions, saveContent, setMedia, localAudioUrl, localImageUrl, t, tc]);

  React.useEffect(() => {
    registerSave(() => save());
    return () => registerSave(null);
  }, [registerSave, save]);

  if (!section || !group || !part) return null;

  const partNo = group.partNumber ?? section.groups.findIndex((x) => x.id === group.id) + 1;
  const partName = `Part ${partNo}`;
  const numbers = part.questions.map((q) => q.number);
  const range = partRangeLabel(numbers);
  const summary = partTypeSummary(part.questions.map((q) => q.type));
  const nextNumber = Math.max(nextQuestionNumber(detail.sections) - 1, numbers.reduce((m, n) => Math.max(m, n), 0)) + 1;

  // Live checklist from the existing validation helpers (client) — the
  // server readiness endpoint stays authoritative at publish time.
  const audioMissing = !part.hasAudio && !part.audioPendingFile;
  const rowsWithIssues = part.questions.filter(
    (q) =>
      questionIssues(
        {
          id: q.clientId,
          number: q.number,
          sortOrder: 0,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          points: q.points,
          wordLimit: q.wordLimit ?? null,
    answerRule: q.answerRule ?? null,
          correctAnswers: q.correctAnswers,
        },
        "listening",
      ).length > 0 || isDuplicate(detail, group.id, part.questions, q),
  ).length;
  const isReady = !audioMissing && part.questions.length > 0 && rowsWithIssues === 0;

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

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addQuestion() {
    const number = nextNumber;
    const q = newPresetQuestion(part!, number, "multiple_choice", formatPreset);
    update((prev) => ({ ...prev, questions: [...prev.questions, q] }));
    setExpanded((prev) => new Set(prev).add(q.clientId));
  }

  function pickAudioFile(f: File) {
    if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    setLocalAudioUrl(URL.createObjectURL(f));
    setUploadError(null);
    setUploadErrorDetail(null);
    update((p) => ({ ...p, audioPendingFile: f, audioFileName: f.name, hasAudio: true }));
  }

  function clearPendingAudio() {
    if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    setLocalAudioUrl(null);
    setUploadError(null);
    setUploadErrorDetail(null);
    update((p) => ({ ...p, audioPendingFile: null, audioFileName: undefined, hasAudio: group?.hasAudio ?? false }));
  }

  function handleImportDone(added?: ImportedServerQuestion[]) {
    setShowImport(false);
    if (!added || added.length === 0 || !group) return;
    const have = new Set(group.questions.map((q) => q.id));
    const merged: BuilderQuestion[] = added
      .filter((q) => q && typeof q.id === "string" && !have.has(q.id))
      .map((q) => ({
        clientId: q.id,
        number: q.number,
        type: (q.type as MockQuestionType) ?? "multiple_choice",
        prompt: q.prompt ?? "",
        options: q.options ?? [],
        correctAnswers: q.correctAnswers ?? [],
        acceptedVariants: q.acceptedVariants ?? [],
        points: q.points ?? 1,
        wordLimit: q.wordLimit ?? undefined,
      answerRule: q.answerRule ?? null,
        savedQuestionId: q.id,
      }));
    if (merged.length === 0) return;
    update((prev) => ({ ...prev, questions: [...prev.questions, ...merged] }));
  }

  const serverImage = `/api/backend/mock/groups/${group.id}/image`;
  const serverAudio = `/api/backend/mock/groups/${group.id}/audio`;
  // Unsaved visual draft for student preview (Task 9): same question mapping as
  // previewGroup, but questions come from visual state. Listening prose is a
  // scratchpad (passageText ""), consistent with persisted omission. Constant id
  // keeps PreviewBody key stable (answers reset only on toggle).
  const visualDraft = part
    ? {
        id: "visual-paste-draft",
        title: part.title,
        instructions: part.instructions,
        passageText: visualText,
        contentHtml: part.contentHtml ?? null,
        contentLayout: part.contentLayout,
        optionsReusable: part.optionsReusable,
        // Only stored audio is playable in preview — matches previewGroup ruling.
        hasAudio: group.hasAudio,
        imageUrl: localImageUrl ?? group.imageUrl,
        questions: visualQuestions.map(toPreviewQuestion),
      }
    : null;
  const visualImageSrc = localImageUrl ?? (group.imageUrl ? serverImage : null);

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Part checklist — what remains incomplete, in plain words. */}
      <Card>
        <CardContent className="space-y-1.5 p-3">
          {isReady ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              {partName} {tx(t, "partReady", "is ready — audio uploaded, every question has its answer key.")}
            </p>
          ) : (
            <>
              {audioMissing && (
                <p className="flex items-center gap-2 text-sm text-danger">
                  <XCircle className="size-4 shrink-0" aria-hidden />
                  {tx(t, "checklistAudio", "Audio missing — upload the listening audio below.")}
                </p>
              )}
              {part.questions.length === 0 && (
                <p className="flex items-center gap-2 text-sm text-danger">
                  <XCircle className="size-4 shrink-0" aria-hidden />
                  {tx(t, "checklistQuestions", "No questions yet — add questions or import a batch.")}
                </p>
              )}
              {rowsWithIssues > 0 && (
                <p className="flex items-center gap-2 text-sm text-danger">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  {rowsWithIssues === 1
                    ? tx(t, "checklistOneRow", "1 question needs attention — see below.")
                    : `${rowsWithIssues} ${tx(t, "checklistRows", "questions need attention — see below.")}`}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Part details — only relevant properties, no database fields. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>
              {part.title.trim() || partName}
            </CardTitle>
            <Badge variant="info">{partName}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label={tx(t, "partTitle", "Part title")} htmlFor="lp-title">
            <Input
              id="lp-title"
              value={part.title}
              onChange={(e) => update((p) => ({ ...p, title: e.target.value }))}
              placeholder={tx(t, "partTitleHint", "e.g. Questions 1–10 — Complete the form")}
            />
          </Field>
          <Field label={tx(t, "instructions", "Instructions")} htmlFor="lp-instr">
            <Textarea
              id="lp-instr"
              value={part.instructions}
              onChange={(e) => update((p) => ({ ...p, instructions: e.target.value }))}
              className="min-h-20"
              placeholder={tx(t, "instrHint", "e.g. Complete the notes below. Write ONE WORD AND/OR A NUMBER.")}
            />
          </Field>

          <ListeningAudioCard
            groupId={group.id}
            partLabel={partName}
            hasAudio={group.hasAudio || part.audioPendingFile != null}
            durationSec={group.audioDurationSec}
            playLimit={part.audioPlayLimit}
            pendingFile={part.audioPendingFile ?? null}
            pendingUrl={localAudioUrl}
            uploading={saving && part.audioPendingFile != null}
            uploadError={uploadError}
            uploadErrorDetail={uploadErrorDetail}
            onPickFile={pickAudioFile}
            onClearPending={clearPendingAudio}
            onPlayLimitChange={(n) => update((p) => ({ ...p, audioPlayLimit: n }))}
          />

          {/* Diagram / image (e.g. map labelling) — optional. */}
          <div className="rounded-[8px] border border-border p-3">
            <p className="text-sm font-semibold text-fg">
              <ImagePlus className="mr-1.5 inline size-4" aria-hidden />
              {tx(t, "image", "Diagram / image")}{" "}
              <span className="font-normal text-fg-subtle">{tx(t, "optional", "(optional)")}</span>
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
                aria-label={tx(t, "uploadImage", "Upload image")}
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
                {group.imageUrl || imageFile ? tx(t, "replaceImage", "Replace image") : tx(t, "uploadImage", "Upload image")}
              </Button>
              {imageFile && <span className="ml-2 text-xs text-fg-muted">{imageFile.name}</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={saving} onClick={() => void save()}>
              <Save className="size-4" aria-hidden />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={delGroup.isPending}
              onClick={() => setConfirmDelete(true)}
              className="ml-auto"
            >
              <Trash2 className="size-4" aria-hidden />
              {tx(t, "deletePart", "Delete part")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Question group — the part's question set owns its questions. */}
      <section aria-label={tx(t, "questionGroup", "Question group")} className="rounded-[12px] border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              {tx(t, "questionGroup", "Question group")}
            </p>
            <h3 className="truncate text-sm font-bold text-fg">
              {range
                ? `${tx(t, "questionsTitle", "Questions")} ${range}`
                : tx(t, "noQuestionsYet", "No questions yet")}
              {summary && <span className="font-normal text-fg-muted"> · {summary}</span>}
              <span className="font-normal text-fg-muted">
                {" "}· {part.questions.length}{" "}
                {part.questions.length === 1 ? tx(t, "questionOne", "question") : tx(t, "questions", "questions")}
              </span>
            </h3>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1 rounded-[8px] border border-border p-0.5"
              role="tablist"
              aria-label={tx(t, "questionMode", "Question mode")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "form"}
                onClick={() => selectMode("form")}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${mode === "form" ? "bg-surface-hover text-fg" : "text-fg-muted hover:text-fg"}`}
              >
                {tx(t, "formList", "Form list")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "visual"}
                onClick={() => selectMode("visual")}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition ${mode === "visual" ? "bg-surface-hover text-fg" : "text-fg-muted hover:text-fg"}`}
              >
                {tx(t, "visualPaste", "Visual paste")}
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)} aria-expanded={showPreview}>
              {showPreview ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              {tx(t, "preview", "Preview")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)} aria-expanded={showImport}>
              <Upload className="size-4" aria-hidden />
              {tx(t, "import", "Import")}
            </Button>
            {mode === "form" && (
              <Button size="sm" variant="outline" onClick={addQuestion}>
                <Plus className="size-4" aria-hidden />
                {tx(t, "addQuestionNumbered", `Add question (Q${nextNumber})`)}
              </Button>
            )}
          </div>
        </div>

        {mode === "form" && <QuestionGroupSettings part={part} skill="listening" allowedTypes={TYPES_BY_SKILL.listening}
          selectedPreset={formatPreset} onPreset={setFormatPreset} onChange={setPart} />}

        {showPreview && (
          <div className="mt-3">
            <StudentPreview group={previewGroup(part, group)} skill="listening" />
          </div>
        )}

        {showImport && (
          <div className="mt-3">
            <ImportPanel
              examId={examId}
              groupId={group.id}
              skill="listening"
              onDone={handleImportDone}
              groupLabel={`Listening → ${partName}`}
              existingNumbers={detail.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.number)))}
            />
          </div>
        )}

        {mode === "visual" ? (
          <div className="mt-3 space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setVisualPreview((v) => !v)}>
                {visualPreview ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
                {visualPreview
                  ? tx(t, "preview", "Preview")
                  : tx(t, "visualPreview", "Preview as student")}
              </Button>
            </div>
            {visualPreview ? (
              visualDraft ? (
                <StudentPreview
                  group={visualDraft}
                  skill="listening"
                  audioSrc={serverAudio}
                  imageSrc={visualImageSrc}
                />
              ) : null
            ) : null}
            <div className={visualPreview ? "hidden" : undefined}>
              <>
                <p className="text-[11px] text-fg-subtle">
                  {tx(
                    t,
                    "listeningScratchHint",
                    "Pasted text is a placement scratchpad in listening parts — only the questions are saved.",
                  )}
                </p>
                <VisualQuestionCanvas
                  skill="listening"
                  initialText={visualText}
                  initialQuestions={visualQuestions}
                  baseNumber={baseNumber}
                  scratchKey={visualScratchKey(group.id)}
                  onChange={(text, questions) => {
                    setVisualText(text);
                    setVisualQuestions(questions);
                  }}
                />
              </>
            </div>
          </div>
        ) : part.questions.length === 0 ? (
          <div className="mt-3 rounded-[8px] border border-dashed border-border-strong p-4">
            <p className="text-sm font-semibold text-fg">
              {tx(t, "emptyGroupTitle", "This question group is empty.")}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {tx(
                t,
                "emptyGroupHint",
                "Questions belong to this part and are numbered across the whole exam. Add them one by one, or paste a whole batch with Import — numbering continues automatically.",
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={addQuestion}>
                <Plus className="size-4" aria-hidden />
                {tx(t, "addQuestionNumbered", `Add question (Q${nextNumber})`)}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="size-4" aria-hidden />
                {tx(t, "import", "Import")}
              </Button>
            </div>
          </div>
        ) : (
          <ol className="mt-3 space-y-2">
            {part.questions.map((q) => {
              const open = expanded.has(q.clientId);
              const issues = questionIssues(
                {
                  id: q.clientId,
                  number: q.number,
                  sortOrder: 0,
                  type: q.type,
                  prompt: q.prompt,
                  options: q.options,
                  points: q.points,
                  wordLimit: q.wordLimit ?? null,
    answerRule: q.answerRule ?? null,
                  correctAnswers: q.correctAnswers,
                },
                "listening",
              );
              const dup = isDuplicate(detail, group.id, part.questions, q);
              const bad = issues.length > 0 || dup;
              const answerOk = q.correctAnswers.some((a) => a.trim() !== "");
              const excerpt = q.prompt.trim() ? q.prompt.trim().split("\n")[0].slice(0, 90) : "";
              return (
                <li key={q.clientId} className={`rounded-[8px] border bg-surface ${bad ? "border-danger-border" : "border-border"}`}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(q.clientId)}
                    aria-expanded={open}
                    aria-label={`${tx(t, "question", "Question")} ${q.number} — ${QTYPE_LABEL[q.type]} — ${open ? tx(t, "collapse", "Collapse") : tx(t, "expand", "Expand")}`}
                    className="flex w-full items-start gap-2.5 rounded-[8px] px-3 py-2 text-left transition hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-border bg-surface-hover text-sm font-bold text-fg tabular-nums" aria-hidden>
                      {q.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {excerpt || <span className="text-danger">{tx(t, "emptyPrompt", "Empty — add the question text.")}</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-muted">
                        <span>{QTYPE_LABEL[q.type]}</span>
                        {answerOk ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="size-3" aria-hidden />
                            {tx(t, "answerSet", "Answer configured")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <XCircle className="size-3" aria-hidden />
                            {tx(t, "answerMissing", "Answer key missing")}
                          </span>
                        )}
                        {dup && (
                          <span className="inline-flex items-center gap-1 font-medium text-danger">
                            <AlertTriangle className="size-3" aria-hidden />
                            {tx(t, "duplicateNumber", "Duplicate number")}
                          </span>
                        )}
                        {!dup && issues.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <AlertTriangle className="size-3" aria-hidden />
                            {issues.length === 1
                              ? tx(t, "oneIssue", "1 issue")
                              : `${issues.length} ${tx(t, "issues", "issues")}`}
                          </span>
                        )}
                      </span>
                    </span>
                    <ChevronDown className={`mt-1 size-4 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {open && (
                    <div className="border-t border-border p-3">
                      <QuestionEditor
                        question={q}
                        skill="listening"
                        allowedTypes={LISTENING_TYPES}
                        onChange={(next) =>
                          update((p) => ({
                            ...p,
                            questions: p.questions.map((x) => (x.clientId === q.clientId ? next : x)),
                          }))
                        }
                        onRemove={() =>
                          update((p) => ({ ...p, questions: p.questions.filter((x) => x.clientId !== q.clientId) }))
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-2 text-[11px] text-fg-subtle">
          {tx(
            t,
            "numberingNote",
            "Question numbers run across the whole exam without repeats — new questions continue automatically.",
          )}
        </p>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={`${tx(t, "deletePart", "Delete part")} — ${partName}?`}
        description={tx(
          t,
          "deletePartConfirm",
          `Delete this part and everything in it? This will remove its audio and ${group.questions.length} ${group.questions.length === 1 ? "question" : "questions"}.`,
        )}
        confirmLabel={tx(t, "deletePart", "Delete part")}
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

/** Exam-wide duplicate-number errors for the local (possibly unsaved) set. */
function duplicateErrors(
  detail: MockExamDetail,
  groupId: string,
  questions: BuilderQuestion[],
): string[] {
  return duplicateNumberErrors(
    detail.sections,
    groupId,
    questions.map((q) => q.number),
  );
}

function isDuplicate(
  detail: MockExamDetail,
  groupId: string,
  questions: BuilderQuestion[],
  q: BuilderQuestion,
): boolean {
  return isDuplicateNumber(
    detail.sections,
    groupId,
    questions.map((x) => x.number),
    q.number,
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
    answerRule: q.answerRule ?? null,
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
    passageText: "",
    contentHtml: part.contentHtml ?? server.contentHtml ?? null,
    contentLayout: part.contentLayout,
    optionsReusable: part.optionsReusable,
    // Only stored audio is playable in preview — a pending selection uploads on save.
    hasAudio: server.hasAudio,
    imageUrl: server.imageUrl,
    questions: part.questions.map(toPreviewQuestion),
  };
}
