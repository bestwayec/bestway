"use client";

import * as React from "react";
import {
  BookOpenText,
  Check,
  Clipboard,
  Download,
  FileJson,
  FileUp,
  Headphones,
  Layers,
  Loader2,
  Mic,
  PenLine,
  Plug,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCommitExamImport,
  useImportStatus,
  useMockExams,
  useStageImportMedia,
  useValidateExamImport,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MockImportCommit, MockImportIssue, MockImportReport } from "@/lib/types";
import { tx } from "./types";
import {
  IMPORT_PACKAGE_MAX_BYTES,
  checkDraftDestination,
  describeIssuePath,
  downloadJsonText,
  extractMediaDeclarations,
  findDuplicateKeys,
  formatJson,
  groupImportIssues,
  parsePackageWithLocation,
  summarizePackage,
  type JsonErrorLocation,
  type PackageSummary,
} from "./import-json";
import {
  EXAM_IMPORT_TEMPLATES,
  serializeExamImportTemplate,
  type ExamImportTemplateFamily,
  type ExamImportTemplateId,
  type ExamImportTemplateSkill,
} from "./import-templates";

type Phase = "edit" | "report" | "importing" | "imported";

const EXAM_TYPE_LABEL: Record<string, string> = {
  ielts_academic: "IELTS Academic",
  ielts_general: "IELTS General Training",
  multilevel: "CEFR Multilevel",
};

const SKILL_ICON = {
  full: Layers,
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
} as const;

function errText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? `${e.message} (${e.code})` : fallback;
}

/**
 * Schema-1.0 JSON package → validated draft import, in three visible steps:
 * 1. Source (template, file or paste) · 2. Check & preview (server validation,
 * parsed structure, destination) · 3. Import (one atomic server transaction).
 *
 * The browser session (HttpOnly cookie) is attached by the `/api/backend/*`
 * proxy — this component never reads, displays or logs any credential.
 * Pasted JSON stays in memory only.
 */
export function JsonImportDialog({
  open,
  onClose,
  initialTargetExamId,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-select an existing draft as the destination (e.g. from the editor). */
  initialTargetExamId?: string;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const router = useRouter();

  const [text, setText] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("edit");
  const [report, setReport] = React.useState<MockImportReport | null>(null);
  const [parsedPkg, setParsedPkg] = React.useState<unknown>(null);
  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [stagedNames, setStagedNames] = React.useState<Record<string, string>>({});
  const [sessionExpired, setSessionExpired] = React.useState(false);
  const [commitError, setCommitError] = React.useState<string | null>(null);
  const [lookupOn, setLookupOn] = React.useState(false);
  const [imported, setImported] = React.useState<MockImportCommit | null>(null);
  const [family, setFamily] = React.useState<ExamImportTemplateFamily>("ielts");
  const [templateSkill, setTemplateSkill] = React.useState<ExamImportTemplateSkill>("full");
  const [templateId, setTemplateId] = React.useState<ExamImportTemplateId>("ielts-academic-full");
  const [targetExamId, setTargetExamId] = React.useState(initialTargetExamId ?? "");
  const [syntaxError, setSyntaxError] = React.useState<JsonErrorLocation | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [replaceExisting, setReplaceExisting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const editorRef = React.useRef<HTMLTextAreaElement | null>(null);

  const validate = useValidateExamImport();
  const stage = useStageImportMedia();
  const commit = useCommitExamImport();
  const exams = useMockExams();

  const summary: PackageSummary | null = React.useMemo(
    () => (parsedPkg ? summarizePackage(parsedPkg) : null),
    [parsedPkg],
  );
  const pkgId = summary?.packageId ?? "";
  const pkgRev = summary?.revision ?? 0;
  const statusQ = useImportStatus(pkgId, pkgRev, lookupOn && !!pkgId && !!pkgRev);
  const visibleTemplates = React.useMemo(
    () => EXAM_IMPORT_TEMPLATES.filter((o) => o.family === family && o.skill === templateSkill),
    [family, templateSkill],
  );
  const selectedTemplate = EXAM_IMPORT_TEMPLATES.find((o) => o.id === templateId);
  const editableExams = React.useMemo(
    () => (exams.data ?? []).filter((exam) => !exam.isPublished && exam.canEdit),
    [exams.data],
  );
  const target = editableExams.find((exam) => exam.id === targetExamId) ?? null;
  const targetCheck = summary && target ? checkDraftDestination(summary, target) : null;
  const replacing = replaceExisting && targetCheck?.reason === "appends-to-existing";
  // A destination chosen by id (e.g. from the editor) resolves only once the drafts list has
  // loaded. Until then — or if it is no longer editable — importing must not silently fall back
  // to "create a new exam".
  const targetUnresolved = !!targetExamId && !target;
  const byteSize = React.useMemo(() => new TextEncoder().encode(text).length, [text]);
  const lineCount = React.useMemo(() => (text ? text.split("\n").length : 0), [text]);

  function pickTemplate(nextFamily: ExamImportTemplateFamily, nextSkill: ExamImportTemplateSkill) {
    const first = EXAM_IMPORT_TEMPLATES.find((o) => o.family === nextFamily && o.skill === nextSkill);
    if (!first) return;
    setFamily(nextFamily);
    setTemplateSkill(nextSkill);
    setTemplateId(first.id);
  }

  function reset() {
    setText("");
    setPhase("edit");
    setReport(null);
    setParsedPkg(null);
    setBindings({});
    setStagedNames({});
    setSessionExpired(false);
    setCommitError(null);
    setLookupOn(false);
    setImported(null);
    setTargetExamId(initialTargetExamId ?? "");
    setSyntaxError(null);
    setReplaceExisting(false);
  }

  function close() {
    if (validate.isPending || stage.isPending || commit.isPending) return;
    reset();
    onClose();
  }

  function updateText(value: string) {
    setText(value);
    if (syntaxError) setSyntaxError(null);
  }

  function showErrorInEditor(location: JsonErrorLocation) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(location.offset, Math.min(location.offset + 1, editor.value.length));
    // Scroll the caret line into view (textarea has no native API for it).
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 16;
    editor.scrollTop = Math.max(0, (location.line - 3) * lineHeight);
  }

  function handleValidate() {
    setSessionExpired(false);
    setCommitError(null);
    const parsed = parsePackageWithLocation(text);
    if (!parsed.ok) {
      if (parsed.error === "too-large") {
        toast.error(tx(t, "jsonTooLarge", "JSON exceeds the 2 MiB limit."));
      } else {
        setSyntaxError(parsed.location);
        showErrorInEditor(parsed.location);
      }
      return;
    }
    setSyntaxError(null);
    const dups = findDuplicateKeys(text);
    if (dups.length > 0) {
      toast.error(tx(t, "jsonDuplicateKeys", "Duplicate keys found — keep only one of each."));
      setReport({
        checksum: "",
        issues: dups.map((p) => ({ code: "DUPLICATE_KEY", path: p, message: "Duplicate key — JSON keeps only the last value", blocks: ["import"] })),
        counts: { sections: 0, skills: 0, groups: 0, questions: 0, media: 0 },
        canImport: false,
        canPublish: false,
        sanitizerNotes: [],
        truncated: false,
        totalIssues: dups.length,
      });
      setParsedPkg(parsed.value);
      setPhase("report");
      return;
    }
    validate.mutate(
      { package: parsed.value, mediaBindings: bindings },
      {
        onSuccess: (r) => {
          setReport(r);
          setParsedPkg(parsed.value);
          setPhase("report");
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 401) setSessionExpired(true);
          else toast.error(errText(e, tc("unknownError")));
        },
      },
    );
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > IMPORT_PACKAGE_MAX_BYTES) {
      toast.error(tx(t, "jsonTooLarge", "JSON exceeds the 2 MiB limit."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateText(String(reader.result ?? ""));
      toast.success(tx(t, "jsonFileLoaded", "File loaded: {name}", { name: file.name }));
    };
    reader.onerror = () => toast.error(tx(t, "jsonFileReadFailed", "The file could not be read."));
    reader.readAsText(file);
  }

  function loadTemplate() {
    updateText(serializeExamImportTemplate(templateId));
    setReport(null);
    setParsedPkg(null);
    setBindings({});
    setStagedNames({});
    setPhase("edit");
    toast.success(tx(t, "jsonTemplateLoaded", "Template loaded — replace every placeholder before checking it."));
  }

  async function copyTemplate() {
    const value = serializeExamImportTemplate(templateId);
    try {
      await navigator.clipboard.writeText(value);
      toast.success(tx(t, "jsonTemplateCopied", "JSON template copied."));
    } catch {
      updateText(value);
      toast.error(tx(t, "jsonTemplateCopyFailed", "Copy was blocked — the template was loaded into the editor instead."));
    }
  }

  function downloadTemplate() {
    downloadJsonText(selectedTemplate?.fileName ?? "exam-import-template.json", serializeExamImportTemplate(templateId));
  }

  function formatEditor() {
    const formatted = formatJson(text);
    if (formatted === null) {
      handleValidate(); // reports the syntax error location
      return;
    }
    updateText(formatted);
  }

  function handleStage(sourceKey: string, file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    stage.mutate(form, {
      onSuccess: (s) => {
        setBindings((b) => ({ ...b, [sourceKey]: s.uploadId }));
        setStagedNames((n) => ({ ...n, [sourceKey]: s.fileName }));
        if (parsedPkg) {
          const next = { ...bindings, [sourceKey]: s.uploadId };
          validate.mutate({ package: parsedPkg, mediaBindings: next }, { onSuccess: (r) => setReport(r) });
        }
        toast.success(tx(t, "mediaStaged", "File attached — server will verify it on import."));
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 401) setSessionExpired(true);
        else toast.error(errText(e, tc("unknownError")));
      },
    });
  }

  function handleCommit() {
    if (!parsedPkg || !report || targetUnresolved || (targetCheck && !targetCheck.ok)) return;
    setCommitError(null);
    setSessionExpired(false);
    setPhase("importing");
    commit.mutate(
      {
        package: parsedPkg,
        mediaBindings: bindings,
        validatedChecksum: report.checksum,
        ...(target ? { targetExamId: target.id } : {}),
        ...(replacing ? { replaceExisting: true } : {}),
      },
      {
        onSuccess: (r) => {
          setImported(r);
          setPhase("imported");
          toast.success(
            r.replay
              ? tx(t, "importReplay", "This package was already imported — opening the existing draft.")
              : r.addedToExisting
                ? tx(t, "importAdded", "Content added to the selected exam.")
                : tx(t, "importDone", "Draft created — review it before publishing."),
          );
        },
        onError: (e) => {
          setPhase("report");
          if (e instanceof ApiError && e.status === 401) setSessionExpired(true);
          else {
            // Keep the JSON in memory; offer retry + status lookup after timeouts.
            setCommitError(errText(e, tc("unknownError")));
            setLookupOn(true);
          }
        },
      },
    );
  }

  if (!open) return null;

  const grouped = report ? groupImportIssues(report.issues) : null;
  const decls = parsedPkg ? extractMediaDeclarations(parsedPkg) : [];
  const importing = phase === "importing" || commit.isPending;
  const stepIndex = phase === "edit" ? 0 : phase === "imported" ? 2 : 1;
  const steps = [
    tx(t, "importStepSource", "Source"),
    tx(t, "importStepCheck", "Check & preview"),
    tx(t, "importStepImport", "Import"),
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="flex max-h-[min(94dvh,900px)] max-w-4xl flex-col overflow-hidden max-sm:max-h-[94dvh]"
        data-testid="json-import-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-border pb-3">
          <DialogTitle>{tx(t, "jsonImportTitle", "Import JSON")}</DialogTitle>
          <DialogDescription>
            {tx(
              t,
              "jsonImportHint",
              "Paste AI-prepared JSON, validate it, bind media files, then create a draft. Nothing publishes automatically.",
            )}
          </DialogDescription>
          <ol className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label={tx(t, "importSteps", "Import steps")}>
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={index === stepIndex ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5",
                  index === stepIndex ? "font-semibold text-fg" : index < stepIndex ? "text-success" : "text-fg-subtle",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums",
                    index === stepIndex ? "border-brand bg-brand text-white" : index < stepIndex ? "border-success" : "border-border",
                  )}
                  aria-hidden
                >
                  {index < stepIndex ? <Check className="size-3" /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </DialogHeader>

        {/* The only scroll region: header and footer stay visible on every screen size. */}
        <DialogBody className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4">
          {sessionExpired ? (
            <div className="rounded-field border border-danger/40 bg-danger/5 px-3 py-3 text-sm" role="alert">
              <p className="font-medium">{tx(t, "sessionExpired", "Your session expired — sign in again to continue.")}</p>
              <Link href="/login" className="mt-2 inline-block underline underline-offset-2">
                {tx(t, "signIn", "Sign in")}
              </Link>
            </div>
          ) : phase === "imported" && imported ? (
            <div className="space-y-3" role="status">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="success">
                  {imported.replay
                    ? tx(t, "importReplayTitle", "Already imported")
                    : imported.addedToExisting
                      ? tx(t, "importAddedTitle", "Added to exam")
                      : tx(t, "importSuccessTitle", "Draft created")}
                </Badge>
                <span className="text-xs text-fg-muted tabular-nums">
                  {tx(t, "provenanceRevision", "Revision")} {imported.revision}
                </span>
              </div>
              <p className="text-sm text-fg-muted">
                {imported.replay
                  ? tx(t, "importReplayHint", "This package was already imported — your edits were kept. Open the existing draft to continue.")
                  : imported.addedToExisting
                    ? tx(t, "importAddedHint", "The existing exam was kept and the imported sections were added to it. Review the combined draft before publishing.")
                    : tx(t, "importSuccessHint", "Nothing is published yet. Open the draft in Exam Builder to edit, preview and publish.")}
              </p>
              {summary && <PackageSummaryCard summary={summary} />}
            </div>
          ) : phase === "edit" ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <section className="space-y-3 rounded-control border border-border bg-bg-subtle p-3" aria-labelledby="json-template-title">
                <div>
                  <p id="json-template-title" className="text-sm font-semibold text-fg">
                    {tx(t, "jsonTemplateTitle", "Start from a template")}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {tx(t, "jsonTemplateHint", "Choose a section template, then load, copy or download the JSON. Replace all placeholders and answer keys before importing.")}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-control border border-border bg-bg p-1" role="radiogroup" aria-label={tx(t, "jsonTemplateFamily", "Exam family")}>
                  {(["ielts", "multilevel"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={family === value}
                      onClick={() => pickTemplate(value, templateSkill)}
                      className={cn(
                        "min-h-9 rounded-[calc(var(--radius-control)-2px)] px-2 text-xs font-medium transition-colors",
                        family === value ? "bg-brand text-white shadow-e1" : "text-fg-muted hover:bg-surface-hover",
                      )}
                    >
                      {value === "ielts" ? "IELTS" : "CEFR Multilevel"}
                    </button>
                  ))}
                </div>
                <div
                  role="radiogroup"
                  aria-label={tx(t, "jsonTemplateSkill", "Template skill")}
                  className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-3"
                >
                  {(["full", "listening", "reading", "writing", "speaking"] as const).map((skill) => {
                    const Icon = SKILL_ICON[skill];
                    const active = templateSkill === skill;
                    return (
                      <button
                        key={skill}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => pickTemplate(family, skill)}
                        className={cn(
                          "inline-flex min-h-9 min-w-0 items-center justify-center gap-1 rounded-control border px-1.5 text-xs font-medium transition-colors",
                          active ? "border-brand bg-brand/10 text-fg" : "border-border text-fg-muted hover:bg-surface-hover",
                        )}
                      >
                        <Icon className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          {skill === "full"
                            ? tx(t, "templateFull", "Full mock")
                            : tx(t, `template${skill[0].toUpperCase()}${skill.slice(1)}`, skill[0].toUpperCase() + skill.slice(1))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Select value={templateId} onValueChange={(value) => setTemplateId(value as ExamImportTemplateId)}>
                  <SelectTrigger aria-label={tx(t, "jsonTemplateSelect", "Select JSON template")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleTemplates.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTemplate && (
                  <p className="text-xs text-fg-subtle">
                    <Badge variant="neutral" className="mr-1.5 align-middle">{EXAM_TYPE_LABEL[selectedTemplate.examType]}</Badge>
                    {selectedTemplate.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={loadTemplate} className="min-h-9">
                    <FileJson className="size-4" aria-hidden />
                    {tx(t, "jsonUseTemplate", "Load template")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void copyTemplate()} className="min-h-9">
                    <Clipboard className="size-4" aria-hidden />
                    {tx(t, "copy", "Copy")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadTemplate} className="min-h-9">
                    <Download className="size-4" aria-hidden />
                    {tx(t, "downloadJson", "Download JSON")}
                  </Button>
                </div>
              </section>

              <section className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="json-input" className="text-sm font-medium">
                    {tx(t, "jsonPasteLabel", "JSON package")}
                  </label>
                  <span className="text-xs text-fg-subtle tabular-nums" aria-live="polite">
                    {lineCount} {tx(t, "jsonLines", "lines")} · {(byteSize / 1024).toFixed(1)} / 2048 KiB
                  </span>
                </div>
                <textarea
                  id="json-input"
                  ref={editorRef}
                  value={text}
                  onChange={(e) => updateText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && text.trim()) {
                      e.preventDefault();
                      handleValidate();
                    }
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("Files")) {
                      e.preventDefault();
                      setDragOver(true);
                    }
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      e.preventDefault();
                      handleFile(file);
                    }
                    setDragOver(false);
                  }}
                  rows={18}
                  spellCheck={false}
                  aria-invalid={syntaxError ? true : undefined}
                  aria-describedby={syntaxError ? "json-syntax-error" : "json-input-hint"}
                  placeholder={tx(t, "jsonPastePlaceholder", 'Paste a schema 1.0 package, drop a .json file here, or load a template. {"schemaVersion": "1.0", …}')}
                  className={cn(
                    "min-h-[16rem] w-full min-w-0 resize-y rounded-field border bg-bg px-3 py-2 font-mono text-xs leading-5",
                    syntaxError ? "border-danger" : dragOver ? "border-brand ring-2 ring-brand/30" : "border-border",
                  )}
                />
                {syntaxError ? (
                  <div id="json-syntax-error" role="alert" className="rounded-field border border-danger/40 bg-danger/5 px-3 py-2 text-sm">
                    <p className="flex items-center gap-1.5 font-medium text-danger">
                      <TriangleAlert className="size-4 shrink-0" aria-hidden />
                      {tx(t, "jsonSyntaxAt", "JSON syntax error at line {line}, column {column}", {
                        line: syntaxError.line,
                        column: syntaxError.column,
                      })}
                    </p>
                    <p className="mt-0.5 break-words font-mono text-xs text-fg-muted">{syntaxError.message}</p>
                    <Button size="sm" variant="outline" className="mt-2 min-h-8" onClick={() => showErrorInEditor(syntaxError)}>
                      {tx(t, "jsonShowError", "Show in editor")}
                    </Button>
                  </div>
                ) : (
                  <p id="json-input-hint" className="text-xs text-fg-subtle">
                    {tx(t, "jsonEditorHint", "Ctrl/⌘ + Enter checks the package. Files over 2 MiB are refused before upload.")}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      handleFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="min-h-9">
                    <FileUp className="size-4 shrink-0" aria-hidden />
                    {tx(t, "jsonChooseFile", "Choose file")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={formatEditor} disabled={!text.trim()} className="min-h-9">
                    <WandSparkles className="size-4 shrink-0" aria-hidden />
                    {tx(t, "jsonFormat", "Format JSON")}
                  </Button>
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              {report && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={report.canImport ? "success" : "danger"}>
                    {report.canImport ? tx(t, "jsonReady", "Ready to import") : tx(t, "jsonBlocked", "Needs corrections")}
                  </Badge>
                  {report.canImport && !report.canPublish && (
                    <Badge variant="warning">{tx(t, "jsonDraftOnly", "Imports as a draft — publishing is blocked until fixed")}</Badge>
                  )}
                  <span className="text-xs text-fg-muted tabular-nums">
                    {report.counts.sections} {tx(t, "sections", "sections")} · {report.counts.questions} {tx(t, "questions", "questions")} · {report.counts.media}{" "}
                    {tx(t, "jsonMedia", "media")}
                  </span>
                  {report.sanitizerNotes.some((n) => n.changed) && (
                    <span className="text-xs text-warning">{tx(t, "jsonSanitized", "Some HTML was sanitized — review before publishing.")}</span>
                  )}
                </div>
              )}
              {summary && <PackageSummaryCard summary={summary} />}

              {grouped && grouped.importBlocking.length > 0 && (
                <IssueList title={tx(t, "jsonImportBlockers", "Must fix before import")} issues={grouped.importBlocking} pkg={parsedPkg} tone="danger" />
              )}

              {report?.canImport && summary && (
                <section className="space-y-2 rounded-control border border-border bg-bg-subtle p-3" aria-labelledby="import-destination-title">
                  <div>
                    <p id="import-destination-title" className="text-sm font-semibold text-fg">
                      {tx(t, "importDestination", "Import destination")}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {tx(t, "importDestinationHint", "Create a separate exam or add these sections to an existing editable draft.")}
                    </p>
                  </div>
                  <Select
                    value={targetExamId || "__new__"}
                    onValueChange={(value) => {
                      setTargetExamId(value === "__new__" ? "" : value);
                      setReplaceExisting(false);
                    }}
                  >
                    <SelectTrigger aria-label={tx(t, "importDestination", "Import destination")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">{tx(t, "newExam", "Create a new exam")}</SelectItem>
                      {editableExams.map((exam) => {
                        const check = checkDraftDestination(summary, exam);
                        return (
                          <SelectItem key={exam.id} value={exam.id} disabled={!check.ok}>
                            {exam.title} · {EXAM_TYPE_LABEL[exam.type] ?? exam.type} · {exam.skills.join(", ") || tx(t, "emptyExam", "Empty")} · {exam.questionCount}{" "}
                            {tx(t, "questions", "questions")}
                            {!check.ok ? ` — ${tx(t, "importTypeMismatchShort", "different exam type")}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {targetUnresolved && (
                    <p className={cn("text-xs", exams.isLoading ? "text-fg-muted" : "text-danger")} role={exams.isLoading ? "status" : "alert"}>
                      {exams.isLoading
                        ? tx(t, "importTargetLoading", "Loading the selected draft…")
                        : tx(t, "importTargetGone", "The selected exam is no longer an editable draft. Choose another destination.")}
                    </p>
                  )}
                  {!exams.isLoading && editableExams.length === 0 && (
                    <p className="text-xs text-fg-subtle">{tx(t, "noEditableExams", "No editable drafts are available.")}</p>
                  )}
                  {target && targetCheck && (
                    <p className={cn("text-xs", targetCheck.ok ? "text-fg-muted" : "text-danger")} role={targetCheck.ok ? undefined : "alert"}>
                      {targetCheck.reason === "type-mismatch"
                        ? tx(t, "importTypeMismatch", "This package is {pkg}, but the selected exam is {exam}. Choose a matching draft or create a new exam.", {
                            pkg: EXAM_TYPE_LABEL[summary.examType ?? ""] ?? summary.examType ?? "?",
                            exam: EXAM_TYPE_LABEL[target.type] ?? target.type,
                          })
                        : targetCheck.reason === "appends-to-existing"
                          ? tx(t, "importAppends", "Questions will be appended to the existing {skills} section(s). Existing questions and answer keys are kept; duplicate question numbers are refused.", {
                              skills: targetCheck.sharedSkills.join(", "),
                            })
                          : tx(t, "importAddsSections", "New sections will be added; existing sections are not changed.")}
                    </p>
                  )}
                  {targetCheck?.reason === "appends-to-existing" && (
                    <label className="flex items-start gap-2 rounded-field border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-[var(--warning)]"
                        checked={replaceExisting}
                        onChange={(e) => setReplaceExisting(e.target.checked)}
                        data-testid="import-replace-existing"
                      />
                      <span>
                        <span className="font-semibold text-fg">
                          {tx(t, "importReplaceLabel", "Replace the existing {skills} section(s) instead", { skills: targetCheck.sharedSkills.join(", ") })}
                        </span>
                        <span className="block text-fg-muted">
                          {tx(
                            t,
                            "importReplaceHint",
                            "Every question, passage, answer key and attached audio/image in those sections is deleted and replaced by this package. Other sections are kept. Only possible for an unpublished draft no student has started.",
                          )}
                        </span>
                      </span>
                    </label>
                  )}
                </section>
              )}

              {grouped && grouped.publishBlocking.length > 0 && (
                <IssueList title={tx(t, "jsonPublishBlockers", "Draft allowed — blocks publish")} issues={grouped.publishBlocking} pkg={parsedPkg} tone="warning" />
              )}

              {grouped && report?.canImport && decls.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{tx(t, "jsonBindMedia", "Bind media files")}</p>
                  <p className="text-xs text-fg-muted">
                    {tx(t, "jsonBindMediaHint", "Optional now: unbound files can be attached later in the editor, but a required file blocks publishing.")}
                  </p>
                  {decls.map((d) => (
                    <div key={d.key} className="flex min-w-0 flex-wrap items-center gap-2 rounded-field border border-border px-3 py-2 text-sm">
                      <Plug className="size-4 shrink-0 text-fg-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d.fileName}>
                        {d.key} · {d.fileName}
                        {d.requiredForPublish && <span className="text-warning"> · {tx(t, "required", "required")}</span>}
                      </span>
                      {stagedNames[d.key] ? (
                        <Badge variant="success">{stagedNames[d.key]}</Badge>
                      ) : (
                        <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-field border border-border px-2.5 text-xs font-medium hover:bg-surface-hover">
                          {stage.isPending ? tx(t, "uploading", "Uploading…") : tx(t, "chooseMediaFile", "Choose file")}
                          <input
                            type="file"
                            accept={d.kind === "audio" ? "audio/*" : "image/*"}
                            className="hidden"
                            disabled={stage.isPending}
                            onChange={(e) => handleStage(d.key, e.target.files?.[0] ?? undefined)}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {commitError && (
                <div className="rounded-field border border-danger/40 bg-danger/5 px-3 py-2 text-sm" role="alert">
                  <p className="flex items-center gap-1.5 font-medium text-danger">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    {commitError}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {tx(t, "importNothingSaved", "Nothing was saved — the import runs as one transaction. Fix the problem and try again.")}
                  </p>
                  {statusQ.data && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        router.push(statusQ.data.editorUrl);
                        close();
                      }}
                    >
                      {tx(t, "openRecoveredDraft", "Open recovered draft")}
                    </Button>
                  )}
                </div>
              )}
              {importing && (
                <p className="inline-flex items-center gap-2 text-sm text-fg-muted" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {tx(t, "importing", "Creating draft…")}
                </p>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="shrink-0 border-t border-border bg-surface pt-3">
          <Button variant="outline" onClick={close} className="min-h-10 justify-center">
            {tc("close")}
          </Button>
          {phase === "edit" && !sessionExpired && (
            <Button onClick={handleValidate} loading={validate.isPending} disabled={!text.trim()} className="min-h-10 justify-center">
              {tx(t, "checkImport", "Check import")}
            </Button>
          )}
          {(phase === "report" || phase === "importing") && !sessionExpired && (
            <>
              <Button variant="outline" onClick={() => setPhase("edit")} disabled={importing} className="min-h-10 justify-center">
                {tx(t, "editJson", "Edit JSON")}
              </Button>
              {report?.canImport && (
                <Button
                  onClick={handleCommit}
                  loading={importing}
                  disabled={importing || targetUnresolved || (targetCheck !== null && !targetCheck.ok)}
                  className="min-h-10 justify-center"
                >
                  {replacing
                    ? tx(t, "replaceInExam", "Replace sections in selected exam")
                    : target || targetUnresolved
                      ? tx(t, "addToExam", "Add to selected exam")
                      : tx(t, "createDraft", "Create draft")}
                </Button>
              )}
            </>
          )}
          {phase === "imported" && imported && (
            <Button
              onClick={() => {
                router.push(imported.editorUrl);
                close();
              }}
              className="min-h-10 justify-center"
            >
              {tx(t, "openInBuilder", "Open in Exam Builder")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackageSummaryCard({ summary }: { summary: PackageSummary }) {
  const t = useTranslations("examBuilder");
  const kind =
    summary.kind === "full_exam"
      ? tx(t, "pkgKindFull", "Full exam (4 skills)")
      : summary.kind === "single_skill"
        ? tx(t, "pkgKindSingle", "Single skill")
        : summary.kind === "multi_skill"
          ? tx(t, "pkgKindMulti", "Several skills")
          : tx(t, "pkgKindUnknown", "No sections");
  return (
    <section className="rounded-control border border-border p-3" aria-label={tx(t, "pkgPreview", "Package preview")}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" title={summary.title ?? undefined}>
          {summary.title || tx(t, "pkgUntitled", "Untitled package")}
        </p>
        <Badge variant="neutral">{EXAM_TYPE_LABEL[summary.examType ?? ""] ?? summary.examType ?? "?"}</Badge>
        <Badge variant="neutral">{kind}</Badge>
        {summary.profile && <Badge variant="neutral">{summary.profile === "full_mock" ? "full mock" : summary.profile}</Badge>}
      </div>
      <p className="mt-1 text-xs text-fg-subtle tabular-nums">
        schema {summary.schemaVersion ?? "?"} · {summary.packageId ?? "?"} · rev {summary.revision ?? "?"}
        {summary.durationMinutes !== null && ` · ${summary.durationMinutes} min`}
      </p>
      {summary.sections.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-fg-subtle">
              <tr>
                <th className="py-1 pr-2 font-medium">{tx(t, "pkgSkill", "Skill")}</th>
                <th className="hidden py-1 pr-2 font-medium sm:table-cell">{tx(t, "pkgTitle", "Title")}</th>
                <th className="hidden py-1 pr-2 text-right font-medium sm:table-cell">{tx(t, "pkgGroups", "Groups")}</th>
                <th className="py-1 pr-2 text-right font-medium">{tx(t, "questions", "questions")}</th>
                <th className="py-1 pr-2 text-right font-medium">{tx(t, "pkgNumbers", "Numbers")}</th>
                <th className="py-1 text-right font-medium">{tx(t, "pkgMinutes", "Min")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {summary.sections.map((s) => (
                <tr key={s.index} className="border-t border-border">
                  <td className="py-1 pr-2 capitalize">{s.skill}</td>
                  <td className="hidden max-w-[14rem] truncate py-1 pr-2 sm:table-cell" title={s.title}>{s.title}</td>
                  <td className="hidden py-1 pr-2 text-right sm:table-cell">{s.groups}</td>
                  <td className="py-1 pr-2 text-right">{s.questions}</td>
                  <td className="py-1 pr-2 text-right">{s.firstNumber !== null ? `${s.firstNumber}–${s.lastNumber}` : "—"}</td>
                  <td className="py-1 text-right">{s.durationMinutes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function IssueList({
  title,
  issues,
  pkg,
  tone,
}: {
  title: string;
  issues: MockImportIssue[];
  pkg: unknown;
  tone: "danger" | "warning";
}) {
  const t = useTranslations("examBuilder");
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? issues : issues.slice(0, 25);
  return (
    <section className="space-y-1">
      <p className={cn("text-sm font-medium", tone === "danger" ? "text-danger" : "text-warning")}>
        {title} ({issues.length})
      </p>
      {/* No inner max-height: the dialog body is the single scroll container. */}
      <ul className="divide-y divide-border rounded-field border border-border text-xs">
        {shown.map((i, idx) => (
          <li key={`${i.code}-${i.path}-${idx}`} className="break-words px-2.5 py-1.5">
            <p className="font-medium text-fg">{describeIssuePath(i.path, pkg)}</p>
            <p className="text-fg-muted">{i.message}</p>
            <p className="font-mono text-[11px] text-fg-subtle">
              {i.code} · {i.path || "/"}
            </p>
          </li>
        ))}
      </ul>
      {issues.length > shown.length && (
        <Button size="sm" variant="ghost" onClick={() => setShowAll(true)} className="min-h-8">
          {tx(t, "showAllIssues", "Show all {count}", { count: issues.length })}
        </Button>
      )}
    </section>
  );
}
