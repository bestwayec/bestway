"use client";

import * as React from "react";
import {
  BookOpen,
  FileText,
  Headphones,
  Info,
  ListChecks,
  Mic,
  PenLine,
  Type as TypeIcon,
  Upload,
  Eye,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAddQuestion, useUpdateQuestion, useUploadQuestionAudio } from "@/hooks/use-tests";
import { ApiError } from "@/lib/api-client";
import type { QuestionType, TestSection, TestQuestionFull } from "@/lib/types";

const SECTIONS: TestSection[] = ["listening", "reading", "writing", "speaking"];
const TYPES: QuestionType[] = ["multiple_choice", "short_answer", "essay", "speaking_prompt"];
const AUTO_SECTIONS = new Set<string>(["listening", "reading"]);

const SECTION_ICON: Record<TestSection, React.ElementType> = {
  listening: Headphones,
  reading: BookOpen,
  writing: PenLine,
  speaking: Mic,
};
const TYPE_ICON: Record<QuestionType, React.ElementType> = {
  multiple_choice: ListChecks,
  short_answer: TypeIcon,
  essay: FileText,
  speaking_prompt: Mic,
};

function tFallback(t: ReturnType<typeof useTranslations>, key: string, fallback: string): string {
  try {
    const v = t(key as never) as unknown;
    if (typeof v !== "string" || !v || v === key || v.endsWith(`.${key}`)) return fallback;
    return v;
  } catch {
    return fallback;
  }
}

export function QuestionFormDialog({
  open,
  onClose,
  testId,
  question,
}: {
  open: boolean;
  onClose: () => void;
  testId: string;
  question?: TestQuestionFull | null;
}) {
  const t = useTranslations("tests");
  const isEdit = !!question;
  const title = isEdit
    ? (tFallback(t, "editQuestion", "Edit question") as string)
    : (tFallback(t, "addQuestion", "Add question") as string);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <PenLine className="size-4 text-brand" /> : <ListChecks className="size-4 text-brand" />}
            {title}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <QuestionFormFields
            key={question?.id ?? testId}
            testId={testId}
            question={question ?? null}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuestionFormFields({
  testId,
  question,
  onClose,
}: {
  testId: string;
  question: TestQuestionFull | null;
  onClose: () => void;
}) {
  const t = useTranslations("tests");
  const tc = useTranslations("common");
  const add = useAddQuestion(testId);
  const upd = useUpdateQuestion(testId);
  const upload = useUploadQuestionAudio(testId);
  const isEdit = !!question;

  const [section, setSection] = React.useState<TestSection>((question?.section as TestSection) ?? "listening");
  const [type, setType] = React.useState<QuestionType>((question?.type as QuestionType) ?? "multiple_choice");
  const [prompt, setPrompt] = React.useState(question?.prompt ?? "");
  const [options, setOptions] = React.useState(() => (question?.options ? question.options.join("\n") : ""));
  const [correctAnswer, setCorrectAnswer] = React.useState(question?.correctAnswer ?? "");
  const [maxScore, setMaxScore] = React.useState(String(question?.maxScore ?? 1));
  const [passageText, setPassageText] = React.useState((question as unknown as { passageText?: string | null })?.passageText ?? "");
  const [instructions, setInstructions] = React.useState((question as unknown as { instructions?: string | null })?.instructions ?? "");
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [audioPreview, setAudioPreview] = React.useState<string | null>(null);
  const [showPreview, setShowPreview] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const isAuto = AUTO_SECTIONS.has(section);
  const isSurveyOneWord = section === "listening" || section === "reading";
  const pending = add.isPending || upd.isPending || upload.isPending;

  // existing audio url from question
  const existingAudioUrl = (question as unknown as { audioUrl?: string | null })?.audioUrl ?? null;

  function handleAudioChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    if (!f) {
      setAudioFile(null);
      setAudioPreview(null);
      return;
    }
    const url = URL.createObjectURL(f);
    setAudioFile(f);
    setAudioPreview(url);
  }
  function clearAudio() {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setAudioFile(null);
    setAudioPreview(null);
  }

  function validate(): boolean {
    const fe: Record<string, string> = {};
    if (prompt.trim().length < 3) fe.prompt = tFallback(t, "promptRequired", "Prompt must be at least 3 characters");
    if (prompt.trim().length > 10000) fe.prompt = "Too long";
    const opts = options.split("\n").map((s) => s.trim()).filter(Boolean);
    if (type === "multiple_choice" && opts.length < 2) fe.options = tFallback(t, "optionsRequired", "At least 2 options required");
    if (isAuto && !correctAnswer.trim()) fe.correctAnswer = tFallback(t, "correctAnswerHint", "Correct answer is required for auto-graded sections");
    const ms = Number(maxScore);
    if (!Number.isInteger(ms) || ms < 1 || ms > 100) fe.maxScore = "1 – 100";
    if (passageText && passageText.length > 10000) fe.passageText = "Max 10000 characters";
    if (instructions && instructions.length > 2000) fe.instructions = "Max 2000 characters";
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

    const opts = options.split("\n").map((s) => s.trim()).filter(Boolean);
    const payload = {
      section,
      type,
      prompt: prompt.trim(),
      ...(type === "multiple_choice" ? { options: opts } : { options: undefined }),
      ...(isAuto ? { correctAnswer: correctAnswer.trim() } : { correctAnswer: undefined }),
      maxScore: Number(maxScore) || 1,
      ...(passageText.trim() ? { passageText: passageText.trim() } : { passageText: undefined }),
      ...(instructions.trim() ? { instructions: instructions.trim() } : { instructions: undefined }),
    } as Record<string, unknown>;

    // For edit, patch; for create, post
    if (isEdit && question) {
      // Clean undefined to not send
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(payload)) {
        const v = payload[k];
        if (v !== undefined) patch[k] = v;
      }
      // if options cleared for non-multiple, send empty? backend expects options optional; send undefined handled
      upd.mutate(
        { questionId: question.id, input: patch as never },
        {
          onSuccess: async () => {
            // upload audio if selected
            if (audioFile) {
              try {
                await upload.mutateAsync({ questionId: question.id, file: audioFile });
                toast.success(tFallback(t, "questionUpdated", "Question updated + audio uploaded"));
              } catch {
                toast.error(tFallback(tc, "unknownError", "Question updated but audio upload failed"));
              }
            } else {
              toast.success(tFallback(t, "questionUpdated", "Question updated"));
            }
            onClose();
          },
          onError: (e) => setError(e instanceof ApiError ? e.message : (e as Error)?.message ?? tFallback(tc, "unknownError", "Error")),
        },
      );
    } else {
      add.mutate(payload as never, {
        onSuccess: async (created: unknown) => {
          const newId = (created as { id?: string })?.id;
          if (audioFile && newId) {
            try {
              await upload.mutateAsync({ questionId: newId, file: audioFile });
              toast.success(tFallback(t, "questionAddedAudio", "Question added + audio uploaded"));
            } catch {
              toast.error(tFallback(tc, "unknownError", "Question added but audio upload failed"));
            }
          } else {
            toast.success(tFallback(t, "questionAdded", "Question added"));
          }
          onClose();
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : (e as Error)?.message ?? tFallback(tc, "unknownError", "Error")),
      });
    }
  }

  const optsArr = options.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <DialogBody className="space-y-5 overflow-y-auto px-5 py-3 flex-1">
        {error && (
          <div className="rounded-field border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger flex gap-2">
            <Info className="size-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* Section & Type with icons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={tFallback(t, "section", "Section")} hint={tFallback(t, "sectionHint", "Skill group")}>
            <Select value={section} onValueChange={(v) => setSection(v as TestSection)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTIONS.map((s) => {
                  const Ic = SECTION_ICON[s];
                  return (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2">
                        <Ic className="size-3.5 text-fg-subtle" />
                        {tFallback(t, `sections.${s}`, s)}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
          <Field label={tFallback(t, "questionType", "Question type")} hint={tFallback(t, "typeHint", "How to answer")}>
            <Select value={type} onValueChange={(v) => setType(v as QuestionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((ty) => {
                  const Ic = TYPE_ICON[ty];
                  return (
                    <SelectItem key={ty} value={ty}>
                      <span className="flex items-center gap-2">
                        <Ic className="size-3.5 text-fg-subtle" />
                        {tFallback(t, `types.${ty}`, ty.replace("_", " "))}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={tFallback(t, "maxScore", "Max score")}
            htmlFor="qmax"
            error={fieldErrors.maxScore}
            hint={tFallback(t, "maxScoreHint", "Points for correct answer")}
          >
            <Input
              id="qmax"
              type="number"
              min={1}
              max={100}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              aria-invalid={!!fieldErrors.maxScore}
            />
          </Field>
        </div>

        {/* Instructions & Passage */}
        <div className="grid gap-3">
          <Field
            label={tFallback(t, "instructions", "Instructions")}
            htmlFor="qinstr"
            error={fieldErrors.instructions}
            hint={tFallback(t, "instructionsHint", 'Short instruction, e.g. "Write ONE WORD ONLY" or "Choose the correct answer"')}
          >
            <Input
              id="qinstr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={tFallback(t, "instructionsPlaceholder", "e.g. Complete the notes. Write ONE WORD for each answer.")}
            />
          </Field>
          <Field
            label={tFallback(t, "passageText", "Passage / Reading text")}
            htmlFor="qpassage"
            error={fieldErrors.passageText}
            hint={tFallback(t, "passageHint", "Long text for Reading/Survey — shown above the question to students")}
          >
            <Textarea
              id="qpassage"
              value={passageText}
              onChange={(e) => setPassageText(e.target.value)}
              className="min-h-24"
              placeholder={tFallback(t, "passagePlaceholder", "Paste the survey/reading passage here (optional)")}
            />
          </Field>
        </div>

        {/* Prompt */}
        <Field
          label={tFallback(t, "prompt", "Question prompt")}
          htmlFor="qprompt"
          error={fieldErrors.prompt}
          hint={
            isSurveyOneWord && type === "short_answer"
              ? tFallback(t, "oneWordHint", "Write ONE WORD ONLY — survey style")
              : tFallback(t, "promptHint", "Use ___ for blanks. For listening, audio will be shown above.")
          }
        >
          <Textarea
            id="qprompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-20"
            placeholder={
              type === "short_answer" && isSurveyOneWord
                ? tFallback(t, "promptPlaceholderOneWord", "The price is ___ dollars.")
                : tFallback(t, "promptPlaceholder", "Enter the question text")
            }
          />
          {type === "short_answer" && isSurveyOneWord && (
            <p className="text-xs text-brand mt-1 flex items-center gap-1">
              <Info className="size-3" /> {tFallback(t, "oneWordHint", "Write ONE WORD ONLY")} — {tFallback(t, "oneWordExplain", "Students will see a one-word hint")}
            </p>
          )}
        </Field>

        {type === "multiple_choice" && (
          <Field
            label={tFallback(t, "options", "Options (one per line)")}
            htmlFor="qopts"
            error={fieldErrors.options}
            hint={tFallback(t, "optionsHint", "One option per line. Students see as radio buttons.")}
          >
            <Textarea
              id="qopts"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              className="min-h-24 font-mono text-sm"
              placeholder={"Option A\nOption B\nOption C"}
            />
            {optsArr.length > 0 && (
              <p className="text-xs text-fg-muted mt-1">{optsArr.length} {tFallback(t, "optionsCount", "options")}</p>
            )}
          </Field>
        )}

        {isAuto && (
          <Field
            label={tFallback(t, "correctAnswer", "Correct answer")}
            hint={tFallback(t, "correctAnswerHint", "Separate multiple correct answers with |")}
            htmlFor="qcorrect"
            error={fieldErrors.correctAnswer}
          >
            <Input
              id="qcorrect"
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              placeholder={type === "multiple_choice" ? "A" : "correct word | alternative"}
            />
          </Field>
        )}

        {/* Audio upload */}
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              <Headphones className="size-3.5" /> {tFallback(t, "audio", "Audio")}
            </span> as unknown as string
          }
          hint={tFallback(t, "audioUploadHint", "Optional for listening. Upload mp3/m4a/wav/ogg (up to 50MB). Preview below.")}
        >
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-field border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-hover cursor-pointer">
              <Upload className="size-4" />
              {audioFile ? audioFile.name : tFallback(t, "chooseAudio", "Choose file")}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleAudioChange}
              />
            </label>
            {audioFile && (
              <Button variant="ghost" size="sm" onClick={clearAudio}>
                {tFallback(t, "clear", "Clear")}
              </Button>
            )}
            {existingAudioUrl && !audioFile && (
              <span className="text-xs text-fg-muted flex items-center gap-1">
                <Headphones className="size-3" /> {tFallback(t, "existingAudio", "Existing audio attached")}
              </span>
            )}
          </div>
          {(audioPreview || existingAudioUrl) && (
            <div className="mt-3">
              <audio controls src={audioPreview ?? (existingAudioUrl ? `/api/backend/tests/questions/${question?.id}/audio` : undefined) ?? undefined} className="w-full h-10" preload="none" />
            </div>
          )}
        </Field>

        {/* Preview as student will see */}
        <div className="rounded-control border border-dashed border-border bg-bg-subtle/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-fg-muted flex items-center gap-1.5">
              <Eye className="size-3.5" /> {tFallback(t, "preview", "Preview — as student will see")}
            </p>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? tFallback(t, "hidePreview", "Hide") : tFallback(t, "showPreview", "Show")}
            </Button>
          </div>
          {showPreview && (
            <Card className="p-4 space-y-3 bg-surface">
              {instructions.trim() && (
                <div className="rounded-field bg-info-bg border border-info/20 px-3 py-2 text-sm text-info">
                  <p className="font-medium">{tFallback(t, "instructions", "Instructions")}</p>
                  <p className="text-xs mt-0.5 text-info/80">{instructions}</p>
                </div>
              )}
              {passageText.trim() && (
                <div className="rounded-field bg-surface border border-border p-3 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted max-h-32 overflow-y-auto">
                  {passageText}
                </div>
              )}
              {(audioPreview || existingAudioUrl) && (
                <div className="rounded-field border border-border bg-bg-subtle p-3">
                  <p className="text-xs font-medium flex items-center gap-1 mb-2">
                    <Headphones className="size-3.5" /> {tFallback(t, "listening", "Listening")} audio
                  </p>
                  <audio controls src={audioPreview ?? (existingAudioUrl ? `/api/backend/tests/questions/${question?.id}/audio` : undefined) ?? undefined} className="w-full h-9" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="neutral" className="text-[11px]">
                    {tFallback(t, `sections.${section}`, section)} · {tFallback(t, `types.${type}`, type)}
                  </Badge>
                  <span className="text-xs text-fg-subtle">
                    {maxScore} {tFallback(t, "score", "points")}
                  </span>
                  {isSurveyOneWord && type === "short_answer" && (
                    <Badge variant="info" className="text-[10px]">ONE WORD</Badge>
                  )}
                </div>
                <p className="text-sm text-fg whitespace-pre-wrap">{prompt || <span className="text-fg-subtle italic">Prompt preview</span>}</p>
                {type === "multiple_choice" && optsArr.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {optsArr.map((o, i) => (
                      <label key={i} className="flex items-center gap-2 rounded-field border border-border px-3 py-2 text-sm bg-surface">
                        <input type="radio" disabled name="preview" className="size-3.5" /> <span>{o}</span>
                      </label>
                    ))}
                  </div>
                )}
                {type === "short_answer" && (
                  <div className="mt-3">
                    <Input disabled placeholder={tFallback(t, "yourAnswer", "Your answer")} />
                    {isSurveyOneWord && <p className="text-xs text-brand mt-1">{tFallback(t, "oneWordHint", "Write ONE WORD ONLY")}</p>}
                  </div>
                )}
                {type === "essay" && <Textarea disabled placeholder={tFallback(t, "yourAnswer", "Your answer")} className="min-h-24 mt-3" />}
                {type === "speaking_prompt" && (
                  <div className="mt-3 rounded-field border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted">
                    <Mic className="size-5 mx-auto mb-1 text-fg-subtle" /> Speaking — student records audio
                  </div>
                )}
                {isAuto && correctAnswer.trim() && (
                  <p className="mt-2 text-xs text-success">✓ {tFallback(t, "correctAnswer", "Correct answer")}: {correctAnswer}</p>
                )}
              </div>
            </Card>
          )}
        </div>
      </DialogBody>
      <DialogFooter className="px-5 py-4 border-t border-border bg-surface shrink-0">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {tc("cancel")}
        </Button>
        <Button onClick={submit} loading={pending}>
          {isEdit ? tc("save") : tc("add")}
        </Button>
      </DialogFooter>
    </>
  );
}
