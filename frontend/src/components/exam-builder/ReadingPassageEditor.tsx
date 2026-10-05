"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
  newQuestion,
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
import { questionIssues } from "./checks";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImportPanel, type ImportedServerQuestion } from "./ImportPanel";
import { StudentPreview } from "./StudentPreview";
import { QuestionGroupSettings } from "./QuestionGroupSettings";
import { presetForPart, type QuestionFormatPreset } from "./question-format-model";
import { VisualQuestionCanvas } from "./visual-editor/VisualQuestionCanvas";
import { TYPES_BY_SKILL, nextQuestionNumber, tx, type Selection } from "./types";

const READING_TYPES = TYPES_BY_SKILL["reading"];

const MAPPING_TYPES: ReadonlySet<MockQuestionType> = new Set([
  "matching",
  "matching_headings",
  "map_labelling",
]);

const COMPLETION_TYPES: ReadonlySet<MockQuestionType> = new Set([
  "sentence_completion",
  "note_completion",
  "summary_completion",
  "table_completion",
  "short_answer",
]);

function toBuilderPart(group: MockGroup): BuilderPart {
  return {
    clientId: group.id,
    title: group.title ?? "",
    instructions: group.instructions ?? "",
    passageText: group.passageText ?? "",
    contentHtml: group.contentHtml ?? "",
    contentLayout: (group.contentLayout ?? undefined) as BuilderPart["contentLayout"],
    optionsReusable: group.optionsReusable ?? null,
    partNumber: undefined,
    audioFileName: undefined,
    audioPendingFile: null,
    audioDurationSec: undefined,
    audioPlayLimit: 1,
    hasAudio: false,
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

function asCheckable(q: BuilderQuestion) {
  return {
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
  };
}

export function partRangeLabel(numbers: number[]): string | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.length > 1 ? `${sorted[0]}–${sorted[sorted.length - 1]}` : `${sorted[0]}`;
}

function wordCount(text: string): number {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  return text.trim() === "" ? 0 : n;
}

/** Human-readable answer limit — mirrors the backend "NO MORE THAN X" rule. */
function wordLimitLabel(n: number): string {
  if (n === 1) return "ONE WORD ONLY";
  if (n === 2) return "NO MORE THAN TWO WORDS";
  if (n === 3) return "NO MORE THAN THREE WORDS";
  return `UP TO ${n} WORDS`;
}

/**
 * Local duplicate-number helpers — fully inline loops (same shape as
 * ListeningPartEditor) so the compiler can prove the save memoization pure.
 * Messages stay identical to the shared checks for consistent Review output.
 */
function duplicateErrors(
  detail: MockExamDetail,
  groupId: string,
  questions: BuilderQuestion[],
): string[] {
  const seen = new Map<number, number>();
  for (const s of detail.sections)
    for (const g of s.groups) {
      if (g.id === groupId) continue;
      for (const q of g.questions) {
        if (!seen.has(q.number)) seen.set(q.number, 1);
      }
    }
  const errs: string[] = [];
  const local = new Map<number, number>();
  for (const q of questions) {
    local.set(q.number, (local.get(q.number) ?? 0) + 1);
    if (seen.has(q.number)) {
      errs.push(`Question ${q.number}: this number is already used in another part — numbers must not repeat.`);
    }
  }
  for (const [n, c] of local) {
    if (c > 1) errs.push(`Question ${n}: used ${c} times in this part — each number must be unique.`);
  }
  return errs;
}

function isDuplicate(
  detail: MockExamDetail,
  groupId: string,
  questions: BuilderQuestion[],
  q: BuilderQuestion,
): boolean {
  for (const s of detail.sections)
    for (const g of s.groups) {
      if (g.id === groupId) continue;
      if (g.questions.some((x) => x.number === q.number)) return true;
    }
  return questions.filter((x) => x.number === q.number).length > 1;
}

interface Run {
  key: string;
  type: MockQuestionType;
  items: BuilderQuestion[];
  min: number;
  max: number;
}

/** Contiguous same-type runs — the passage's visible question groups. */
function runsOf(questions: BuilderQuestion[]): Run[] {
  const runs: Run[] = [];
  for (const q of questions) {
    const last = runs[runs.length - 1];
    if (last && last.type === q.type) {
      last.items.push(q);
      last.min = Math.min(last.min, q.number);
      last.max = Math.max(last.max, q.number);
    } else {
      runs.push({ key: q.clientId, type: q.type, items: [q], min: q.number, max: q.number });
    }
  }
  return runs;
}

function mergeImported(group: MockGroup, list: ImportedServerQuestion[]): BuilderQuestion[] {
  const have = new Set(group.questions.map((q) => q.id));
  return list
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
}

/**
 * Dedicated IELTS Reading passage editor.
 *
 * Mental model: Passage → question groups → questions. One backend question
 * group IS the passage (it owns `passageText`); its question set is shown as
 * visual question groups — contiguous same-type runs with range, type, count
 * and validation — so questions never feel disconnected from their passage.
 * The passage column stays sticky while question groups scroll beside it.
 */
export function ReadingPassageEditor({
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
  const [showTypeChooser, setShowTypeChooser] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const imageRef = React.useRef<HTMLInputElement | null>(null);
  const [localImageUrl, setLocalImageUrl] = React.useState<string | null>(null);

  // Fresh server snapshot per passage (parent keys by groupId).
  const [snapshot, setSnapshot] = React.useState<BuilderPart | null>(() => (group ? toBuilderPart(group) : null));
  const [part, setPart] = React.useState<BuilderPart | null>(() => snapshot);
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
      if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    },
    [localImageUrl],
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
      const bad = p.questions.find(
        (q) =>
          questionIssues(asCheckable(q), "reading").length > 0 ||
          isDuplicate(detail, g.id, p.questions, q),
      );
      setExpandedId(bad ? bad.clientId : null);
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
          contentHtml: p.contentHtml,
          contentLayout: p.contentLayout,
          optionsReusable: p.optionsReusable,
          passageText: p.passageText.trim(),
        },
        questions: p.questions.map((q) => ({ id: q.savedQuestionId, number: q.number, type: q.type, prompt: q.prompt,
          options: q.options, correctAnswers: q.correctAnswers, acceptedVariants: q.acceptedVariants,
          points: q.points, wordLimit: q.wordLimit, answerRule: q.answerRule })),
        deletedQuestionIds: persistedQuestionIds.current.filter((id) => !p.questions.some((local) => local.savedQuestionId === id)),
      });
      persistedQuestionIds.current = saved.questions.map((q) => q.id);
      const savedQuestions = p.questions.map((q, index) => ({ ...q, savedQuestionId: saved.questions[index].id }));
      p = { ...p, questions: savedQuestions };
      setPart(p);
      if (mode === "visual") setVisualQuestions(savedQuestions);
      if (imageFile) {
        const form = new FormData();
        form.append("image", imageFile);
        await setMedia.mutateAsync({ groupId: g.id, form });
      }
      toast.success(tc("saved"));
      setErrors([]);
      setSnapshot(JSON.parse(JSON.stringify(p)));
      if (mode === "visual") {
        setVisualText(p.passageText);
        setVisualQuestions(p.questions);
      }
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
  }, [part, group, detail, imageFile, mode, visualText, visualQuestions, saveContent, setMedia, localImageUrl, t, tc]);

  React.useEffect(() => {
    registerSave(() => save());
    return () => registerSave(null);
  }, [registerSave, save]);

  const runs = React.useMemo(() => runsOf(part?.questions ?? []), [part]);

  if (!section || !group || !part) return null;

  const ordered = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const passageNo = ordered.findIndex((x) => x.id === group.id) + 1;
  const passageName = `Passage ${passageNo}`;
  const displayTitle = part.title.trim() || passageName;
  const numbers = part.questions.map((q) => q.number);
  const nextNumber = Math.max(nextQuestionNumber(detail.sections) - 1, numbers.reduce((m, n) => Math.max(m, n), 0)) + 1;
  const words = wordCount(part.passageText);

  const passageEmpty = part.passageText.trim() === "";
  const rowsWithIssues = part.questions.filter(
    (q) =>
      questionIssues(asCheckable(q), "reading").length > 0 ||
      isDuplicate(detail, group.id, part.questions, q),
  ).length;
  const isReady = !passageEmpty && part.questions.length > 0 && rowsWithIssues === 0;

  const expandedQ = expandedId ? (part.questions.find((q) => q.clientId === expandedId) ?? null) : null;
  const expandedRun = expandedQ ? runs.find((r) => r.items.some((x) => x.clientId === expandedQ.clientId)) ?? null : null;

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

  function addQuestion(type: MockQuestionType) {
    const q = newQuestion(nextNumber, type, true);
    update((prev) => ({ ...prev, questions: [...prev.questions, q] }));
    setExpandedId(q.clientId);
    setShowTypeChooser(false);
  }

  function moveQuestion(clientId: string, dir: -1 | 1) {
    update((prev) => {
      const idx = prev.questions.findIndex((q) => q.clientId === clientId);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.questions.length) return prev;
      const moving = prev.questions[idx];
      const rest = prev.questions.filter((q) => q.clientId !== clientId);
      return { ...prev, questions: [...rest.slice(0, j), moving, ...rest.slice(j)] };
    });
  }

  function handleImportDone(added?: ImportedServerQuestion[]) {
    setShowImport(false);
    const g = group;
    if (!added || added.length === 0 || !g) return;
    const merged = mergeImported(g, added);
    if (merged.length === 0) return;
    update((prev) => ({ ...prev, questions: [...prev.questions, ...merged] }));
  }

  const serverImage = `/api/backend/mock/groups/${group.id}/image`;
  // Unsaved visual draft for student preview (Task 9): same question mapping as
  // previewGroup, but passage/questions come from visual state. Constant id keeps
  // PreviewBody key stable (answers reset only on toggle).
  const visualDraft = part
    ? {
        id: "visual-paste-draft",
        title: part.title,
        instructions: part.instructions,
        passageText: visualText,
        contentHtml: part.contentHtml ?? null,
        contentLayout: part.contentLayout,
        optionsReusable: part.optionsReusable,
        hasAudio: false,
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

      {/* Passage checklist — what remains incomplete, in plain words. */}
      <Card>
        <CardContent className="space-y-1.5 p-3">
          {isReady ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              {passageName} {tx(t, "passageReady", "is ready — passage text present, every question has its answer key.")}
            </p>
          ) : (
            <>
              {passageEmpty && (
                <p className="flex items-center gap-2 text-sm text-danger">
                  <XCircle className="size-4 shrink-0" aria-hidden />
                  {tx(t, "checklistPassage", "Passage has no text — questions have no context. Paste it on the left.")}
                </p>
              )}
              {part.questions.length === 0 && (
                <p className="flex items-center gap-2 text-sm text-danger">
                  <XCircle className="size-4 shrink-0" aria-hidden />
                  {tx(t, "checklistQuestions", "No questions yet — add a question group or import a batch.")}
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,11fr)_minmax(0,13fr)]">
        {/* PASSAGE — sticky content context while questions scroll beside it. */}
        <Card className="xl:sticky xl:top-36 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="min-w-0 truncate">{displayTitle}</CardTitle>
              <Badge variant="info" className="shrink-0">{passageName}</Badge>
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              {tx(t, "passage", "Passage")}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label={tx(t, "passageTitle", "Passage title")} htmlFor="rp-title">
              <Input
                id="rp-title"
                value={part.title}
                maxLength={200}
                onChange={(e) => update((p) => ({ ...p, title: e.target.value }))}
                placeholder={tx(t, "passageTitleHint", "e.g. The History of Glass")}
              />
            </Field>
            <div>
              <Field
                label={tx(t, "passageText", "Passage text")}
                hint={tx(t, "passageTextHint", "The text students read. Every question below belongs to it.")}
                htmlFor="rp-passage"
              >
                <Textarea
                  id="rp-passage"
                  value={part.passageText}
                  maxLength={20000}
                  onChange={(e) => update((p) => ({ ...p, passageText: e.target.value }))}
                  className="min-h-[22rem] font-serif text-[15px] leading-8"
                  placeholder={tx(t, "passageTextPlaceholder", "Paste the full reading passage here — paragraphs preserved.")}
                  disabled={mode === "visual"}
                />
              </Field>
              {mode === "visual" && (
                <p className="mt-1 text-xs text-fg-muted">
                  {tx(
                    t,
                    "visualPassageNote",
                    "Visual paste mode is on — edit the passage in the canvas on the right.",
                  )}
                </p>
              )}
              <p className="mt-1 text-right text-[11px] text-fg-subtle tabular-nums">
                {words} {tx(t, "words", "words")}
              </p>
            </div>
            <Field label={tx(t, "instructions", "Instructions")} htmlFor="rp-instr">
              <Textarea
                id="rp-instr"
                value={part.instructions}
                maxLength={2000}
                onChange={(e) => update((p) => ({ ...p, instructions: e.target.value }))}
                className="min-h-20"
                placeholder={tx(t, "readingInstrHint", "General rubric shown with this passage, e.g. time advice.")}
              />
            </Field>

            {/* Figure / diagram (e.g. map labelling) — optional. */}
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
                {tx(t, "deletePassage", "Delete passage")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* QUESTION GROUPS */}
        <div className="min-w-0 space-y-3">
          {/* Breadcrumb keeps passage/group/question context visible. */}
          <p className="truncate text-xs text-fg-muted" aria-live="polite">
            <span className="capitalize">Reading</span>
            <span aria-hidden> → </span>
            <span className="font-medium text-fg">{displayTitle}</span>
            {expandedRun && (
              <>
                <span aria-hidden> → </span>
                <span>
                  {tx(t, "questionsTitle", "Questions")} {expandedRun.min}–{expandedRun.max}
                </span>
              </>
            )}
            {expandedQ && (
              <>
                <span aria-hidden> → </span>
                <span className="font-medium text-fg">
                  {tx(t, "question", "Question")} {expandedQ.number}
                </span>
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-fg">
              {tx(t, "questionGroups", "Question groups")} ({mode === "visual" ? visualQuestions.length : runs.length})
              <span className="ml-2 font-normal text-fg-muted">
                {mode === "visual" ? visualQuestions.length : part.questions.length}{" "}
                {(mode === "visual" ? visualQuestions.length : part.questions.length) === 1 ? tx(t, "questionOne", "question") : tx(t, "questions", "questions")}
              </span>
            </h3>
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
                <Button size="sm" variant="outline" onClick={() => setShowTypeChooser((v) => !v)} aria-expanded={showTypeChooser}>
                  <Plus className="size-4" aria-hidden />
                  {tx(t, "addQuestionGroup", "Add question group")}
                </Button>
              )}
            </div>
          </div>

          {mode === "visual" && (
            <div className="space-y-3">
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
                  <StudentPreview group={visualDraft} skill="reading" imageSrc={visualImageSrc} />
                ) : null
              ) : null}
              <div className={visualPreview ? "hidden" : undefined}>
                <VisualQuestionCanvas
                  skill="reading"
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
          )}

          {mode === "form" && showTypeChooser && (
            <div className="rounded-[8px] border border-brand/30 bg-surface p-3">
              <p className="text-sm font-semibold text-fg">
                {tx(t, "chooseGroupType", "What kind of questions will this group hold?")}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {tx(t, "chooseGroupTypeHint", "Starts a new group with its first question, numbered Q{next} — the type can be changed per question later.").replace("{next}", String(nextNumber))}
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {READING_TYPES.map((ty) => (
                  <button
                    key={ty}
                    type="button"
                    onClick={() => addQuestion(ty)}
                    className="rounded-[8px] border border-border px-2.5 py-2 text-left text-[13px] text-fg transition hover:border-brand hover:bg-brand-subtle/40 focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {QTYPE_LABEL[ty]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showPreview && <StudentPreview group={previewGroup(part, group)} skill="reading" />}

          {showImport && (
            <ImportPanel
              examId={examId}
              groupId={group.id}
              skill="reading"
              onDone={handleImportDone}
              groupLabel={`Reading → ${passageName}`}
              existingNumbers={detail.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.number)))}
            />
          )}

          {/* Sticky group navigator for long passages. */}
          {mode === "form" && runs.length > 1 && (
            <nav
              aria-label={tx(t, "questionGroups", "Question groups")}
              className="sticky top-36 z-[5] flex flex-wrap gap-1.5 rounded-[8px] border border-border bg-bg/95 py-1.5 backdrop-blur"
            >
              {runs.map((r) => (
                <a
                  key={r.key}
                  href={`#rg-${r.key}`}
                  className="rounded-[6px] border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition hover:border-fg-subtle hover:text-fg"
                >
                  Q{r.min}–{r.max} · {QTYPE_LABEL[r.type]}
                </a>
              ))}
            </nav>
          )}

          {mode === "form" && (runs.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-border-strong p-4">
              <p className="text-sm font-semibold text-fg">
                {tx(t, "emptyGroupsTitle", "No question groups yet.")}
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                {tx(
                  t,
                  "emptyGroupsHint",
                  "Typical passages mix several groups — e.g. matching headings, then True / False / Not Given, then sentence completion. Add the first group or paste a whole batch with Import; numbering continues automatically.",
                )}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowTypeChooser(true)}>
                  <Plus className="size-4" aria-hidden />
                  {tx(t, "addQuestionGroup", "Add question group")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
                  <Upload className="size-4" aria-hidden />
                  {tx(t, "import", "Import")}
                </Button>
              </div>
            </div>
          ) : (
            runs.map((r, ri) => {
              const range = r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
              const bad = r.items.filter(
                (q) =>
                  questionIssues(asCheckable(q), "reading").length > 0 ||
                  isDuplicate(detail, group.id, part.questions, q),
              ).length;
              return (
                <section
                  key={r.key}
                  id={`rg-${r.key}`}
                  aria-label={`${tx(t, "questionsTitle", "Questions")} ${range} — ${QTYPE_LABEL[r.type]}`}
                  className="scroll-mt-44 rounded-[12px] border border-border bg-surface p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {bad > 0 ? (
                      <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-bold text-fg">
                        {tx(t, "questionsTitle", "Questions")} {range}
                        <span className="font-normal text-fg-muted"> · {QTYPE_LABEL[r.type]}</span>
                      </h4>
                      <p className="text-[11px] text-fg-muted">
                        {r.items.length}{" "}
                        {r.items.length === 1 ? tx(t, "questionOne", "question") : tx(t, "questions", "questions")}
                        {bad > 0 && (
                          <span className="font-medium text-danger">
                            {" "}· {bad === 1 ? tx(t, "oneIssue", "1 issue") : `${bad} ${tx(t, "issues", "issues")}`}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="ml-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => addQuestion(r.type)}
                        aria-label={`${tx(t, "addQuestion", "Add question")} — ${QTYPE_LABEL[r.type]} (Q${nextNumber})`}
                      >
                        <Plus className="size-4" aria-hidden />
                        {`Q${nextNumber}`}
                      </Button>
                    </div>
                  </div>

                  <ol className="mt-2 space-y-1.5">
                    {r.items.map((q) => {
                      const open = expandedId === q.clientId;
                      const issues = questionIssues(asCheckable(q), "reading");
                      const dup = isDuplicate(detail, group.id, part.questions, q);
                      const badRow = issues.length > 0 || dup;
                      const answerOk = q.correctAnswers.some((a) => a.trim() !== "");
                      const mapping = MAPPING_TYPES.has(q.type);
                      const excerpt = q.prompt.trim() ? q.prompt.trim().split("\n")[0].slice(0, 90) : "";
                      const idx = part.questions.findIndex((x) => x.clientId === q.clientId);
                      return (
                        <li key={q.clientId} className={`rounded-[8px] border ${badRow ? "border-danger-border" : "border-border"}`}>
                          <div className="flex items-start gap-1 p-1.5">
                            <button
                              type="button"
                              onClick={() => setExpandedId(open ? null : q.clientId)}
                              aria-expanded={open}
                              aria-label={`${tx(t, "question", "Question")} ${q.number} — ${QTYPE_LABEL[q.type]} — ${open ? tx(t, "collapse", "Collapse") : tx(t, "expand", "Expand")}`}
                              className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[6px] px-1.5 py-1 text-left transition hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand"
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
                                      {mapping ? tx(t, "mappingSet", "Answer mapping set") : tx(t, "answerSet", "Answer configured")}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-danger">
                                      <XCircle className="size-3" aria-hidden />
                                      {mapping ? tx(t, "mappingMissing", "Answer mapping missing") : tx(t, "answerMissing", "Answer key missing")}
                                    </span>
                                  )}
                                  {COMPLETION_TYPES.has(q.type) && q.wordLimit != null && (
                                    <span className="tabular-nums">{wordLimitLabel(q.wordLimit)}</span>
                                  )}
                                  {COMPLETION_TYPES.has(q.type) && q.acceptedVariants.some((a) => a.trim() !== "") && (
                                    <span className="tabular-nums">
                                      +{q.acceptedVariants.filter((a) => a.trim() !== "").length} {tx(t, "variants", "accepted")}
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
                                      {issues.length === 1 ? tx(t, "oneIssue", "1 issue") : `${issues.length} ${tx(t, "issues", "issues")}`}
                                    </span>
                                  )}
                                </span>
                              </span>
                              <ChevronDown className={`mt-1 size-4 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                            </button>
                            <div className="flex shrink-0 flex-col" role="group" aria-label={`${tx(t, "reorder", "Reorder")} — ${tx(t, "question", "Question")} ${q.number}`}>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={idx <= 0}
                                onClick={() => moveQuestion(q.clientId, -1)}
                                aria-label={`${tx(t, "moveUp", "Move question")} ${q.number} ${tx(t, "up", "up")}`}
                                title={tx(t, "moveUpHint", "Moves within this passage; order is saved with the passage.")}
                              >
                                <ArrowUp className="size-4" aria-hidden />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                disabled={idx < 0 || idx >= part.questions.length - 1}
                                onClick={() => moveQuestion(q.clientId, 1)}
                                aria-label={`${tx(t, "moveDown", "Move question")} ${q.number} ${tx(t, "down", "down")}`}
                                title={tx(t, "moveDownHint", "Moves within this passage; order is saved with the passage.")}
                              >
                                <ArrowDown className="size-4" aria-hidden />
                              </Button>
                            </div>
                          </div>
                          {open && (
                            <div className="border-t border-border p-3">
                              <QuestionEditor
                                question={q}
                                skill="reading"
                                allowedTypes={READING_TYPES}
                                onChange={(next) =>
                                  update((p) => ({
                                    ...p,
                                    questions: p.questions.map((x) => (x.clientId === q.clientId ? next : x)),
                                  }))
                                }
                                onRemove={() => {
                                  if (expandedId === q.clientId) setExpandedId(null);
                                  update((p) => ({ ...p, questions: p.questions.filter((x) => x.clientId !== q.clientId) }));
                                }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {ri === runs.length - 1 && (
                    <p className="mt-2 text-[11px] text-fg-subtle">
                      {tx(
                        t,
                        "numberingNote",
                        "Question numbers run across the whole exam without repeats — new questions continue automatically.",
                      )}
                    </p>
                  )}
                </section>
              );
            })
          )
        )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`${tx(t, "deletePassage", "Delete passage")} — ${passageName}?`}
        description={tx(
          t,
          "deletePassageConfirm",
          `Delete this passage and everything in it? This will remove the passage text and ${group.questions.length} ${group.questions.length === 1 ? "question" : "questions"}.`,
        )}
        confirmLabel={tx(t, "deletePassage", "Delete passage")}
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
    passageText: part.passageText,
    contentHtml: part.contentHtml ?? server.contentHtml ?? null,
    contentLayout: part.contentLayout,
    optionsReusable: part.optionsReusable,
    hasAudio: false,
    imageUrl: server.imageUrl,
    questions: part.questions.map(toPreviewQuestion),
  };
}
