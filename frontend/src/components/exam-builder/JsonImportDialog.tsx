"use client";

import * as React from "react";
import { BookOpenText, Clipboard, Download, FileJson, FileUp, Headphones, Loader2, Mic, PenLine, Plug, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { MockImportCommit, MockImportReport } from "@/lib/types";
import { tx } from "./types";
import {
  extractMediaDeclarations,
  findDuplicateKeys,
  groupImportIssues,
  parsePackageInput,
} from "./import-json";
import {
  EXAM_IMPORT_TEMPLATES,
  serializeExamImportTemplate,
  type ExamImportTemplateId,
  type ExamImportTemplateSkill,
} from "./import-templates";

type Phase = "edit" | "report" | "importing" | "imported";

function errText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? `${e.message} (${e.code})` : fallback;
}

/**
 * AI-prepared JSON → validated draft import. The browser session (HttpOnly
 * cookie) is attached by the `/api/backend/*` proxy — this component never
 * reads, displays or logs any credential. Pasted JSON stays in memory only.
 */
export function JsonImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  const [templateSkill, setTemplateSkill] = React.useState<ExamImportTemplateSkill>("reading");
  const [templateId, setTemplateId] = React.useState<ExamImportTemplateId>("academic-reading-full");
  const [targetExamId, setTargetExamId] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const validate = useValidateExamImport();
  const stage = useStageImportMedia();
  const commit = useCommitExamImport();
  const exams = useMockExams();

  const pkgId =
    typeof parsedPkg === "object" && parsedPkg !== null
      ? String((parsedPkg as Record<string, unknown>).packageId ?? "")
      : "";
  const pkgRev =
    typeof parsedPkg === "object" && parsedPkg !== null
      ? Number((parsedPkg as Record<string, unknown>).revision ?? 0)
      : 0;
  const statusQ = useImportStatus(pkgId, pkgRev, lookupOn && !!pkgId && !!pkgRev);
  const visibleTemplates = React.useMemo(
    () => EXAM_IMPORT_TEMPLATES.filter((option) => option.skill === templateSkill),
    [templateSkill],
  );
  const editableExams = React.useMemo(
    () => (exams.data ?? []).filter((exam) => !exam.isPublished && exam.canEdit),
    [exams.data],
  );

  function changeTemplateSkill(value: string) {
    const skill = value as ExamImportTemplateSkill;
    const first = EXAM_IMPORT_TEMPLATES.find((option) => option.skill === skill);
    if (!first) return;
    setTemplateSkill(skill);
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
    setTargetExamId("");
  }

  function close() {
    if (validate.isPending || stage.isPending || commit.isPending) return;
    reset();
    onClose();
  }

  function failSession() {
    setSessionExpired(true);
  }

  function handleValidate() {
    setSessionExpired(false);
    setCommitError(null);
    const parsed = parsePackageInput(text);
    if (!parsed.ok) {
      toast.error(
        parsed.error === "too-large"
          ? tx(t, "jsonTooLarge", "JSON exceeds the 2 MiB limit.")
          : tx(t, "jsonInvalid", "This is not valid JSON — fix the syntax and try again."),
      );
      return;
    }
    const dups = findDuplicateKeys(text);
    if (dups.length > 0) {
      toast.error(tx(t, "jsonDuplicateKeys", "Duplicate keys found — keep only one of each."));
      setReport({
        checksum: "",
        issues: dups.map((p) => ({ code: "DUPLICATE_KEY", path: p, message: "Duplicate key", blocks: ["import"] })),
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
          if (e instanceof ApiError && e.status === 401) failSession();
          else toast.error(errText(e, tc("unknownError")));
        },
      },
    );
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function templateText() {
    return serializeExamImportTemplate(templateId);
  }

  function useTemplate() {
    setText(templateText());
    setReport(null);
    setParsedPkg(null);
    setBindings({});
    setStagedNames({});
    setPhase("edit");
    toast.success(tx(t, "jsonTemplateLoaded", "Template loaded — replace every placeholder before checking it."));
  }

  async function copyTemplate() {
    const value = templateText();
    try {
      await navigator.clipboard.writeText(value);
      toast.success(tx(t, "jsonTemplateCopied", "JSON template copied."));
    } catch {
      setText(value);
      toast.error(tx(t, "jsonTemplateCopyFailed", "Copy was blocked — the template was loaded into the editor instead."));
    }
  }

  function downloadTemplate() {
    const option = EXAM_IMPORT_TEMPLATES.find((item) => item.id === templateId);
    const url = URL.createObjectURL(new Blob([templateText()], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = option?.fileName ?? "exam-import-template.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function handleStage(sourceKey: string, file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    stage.mutate(form, {
      onSuccess: (s) => {
        setBindings((b) => ({ ...b, [sourceKey]: s.uploadId }));
        setStagedNames((n) => ({ ...n, [sourceKey]: s.fileName }));
        // Re-validate with the new binding so the report reflects it.
        if (parsedPkg) {
          const next = { ...bindings, [sourceKey]: s.uploadId };
          validate.mutate(
            { package: parsedPkg, mediaBindings: next },
            { onSuccess: (r) => setReport(r) },
          );
        }
        toast.success(tx(t, "mediaStaged", "File attached — server will verify it on import."));
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 401) failSession();
        else toast.error(errText(e, tc("unknownError")));
      },
    });
  }

  function handleCommit() {
    if (!parsedPkg || !report) return;
    setCommitError(null);
    setSessionExpired(false);
    setPhase("importing");
    commit.mutate(
      {
        package: parsedPkg,
        mediaBindings: bindings,
        validatedChecksum: report.checksum,
        ...(targetExamId ? { targetExamId } : {}),
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
          if (e instanceof ApiError && e.status === 401) failSession();
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

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tx(t, "jsonImportTitle", "Import JSON")}</DialogTitle>
          <DialogDescription>
            {tx(
              t,
              "jsonImportHint",
              "Paste AI-prepared JSON, validate it, bind media files, then create a draft. Nothing publishes automatically.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!sessionExpired && (phase === "edit" || phase === "report") && (
            <section className="mb-4 space-y-2 rounded-[10px] border border-border bg-bg-subtle p-3">
              <div>
                <p className="text-sm font-semibold text-fg">
                  {tx(t, "importDestination", "Import destination")}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {tx(
                    t,
                    "importDestinationHint",
                    "Create a separate exam or add these sections to an existing editable draft.",
                  )}
                </p>
              </div>
              <Select
                value={targetExamId || "__new__"}
                onValueChange={(value) => setTargetExamId(value === "__new__" ? "" : value)}
              >
                <SelectTrigger aria-label={tx(t, "importDestination", "Import destination")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new__">
                    {tx(t, "newExam", "Create a new exam")}
                  </SelectItem>
                  {editableExams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.title} · {exam.skills.join(", ") || tx(t, "emptyExam", "Empty")} · {exam.questionCount} {tx(t, "questions", "questions")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!exams.isLoading && editableExams.length === 0 && (
                <p className="text-xs text-fg-subtle">
                  {tx(t, "noEditableExams", "No editable drafts are available.")}
                </p>
              )}
            </section>
          )}
          {sessionExpired ? (
            <div className="rounded-[8px] border border-danger/40 bg-danger/5 px-3 py-3 text-sm" role="alert">
              <p className="font-medium">
                {tx(t, "sessionExpired", "Your session expired — sign in again to continue.")}
              </p>
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
                  ? tx(
                      t,
                      "importReplayHint",
                      "This package was already imported — your edits were kept. Open the existing draft to continue.",
                    )
                  : imported.addedToExisting
                    ? tx(
                        t,
                        "importAddedHint",
                        "The existing exam was kept and the imported sections were added to it. Review the combined draft before publishing.",
                      )
                    : tx(
                      t,
                      "importSuccessHint",
                      "Nothing is published yet. Open the draft in Exam Builder to edit, preview and publish.",
                    )}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  router.push(imported.editorUrl);
                  close();
                }}
                className="min-h-10 justify-center"
              >
                {tx(t, "openInBuilder", "Open in Exam Builder")}
              </Button>
            </div>
          ) : phase === "edit" ? (
            <div className="space-y-4">
              <section className="space-y-2 rounded-[10px] border border-border bg-bg-subtle p-3" aria-labelledby="json-template-title">
                <div>
                  <p id="json-template-title" className="text-sm font-semibold text-fg">
                    {tx(t, "jsonTemplateTitle", "Start from a template")}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {tx(t, "jsonTemplateHint", "Choose a section template, then load, copy or download the JSON. Replace all placeholders and answer keys before importing.")}
                  </p>
                </div>
                <Tabs value={templateSkill} onValueChange={changeTemplateSkill}>
                  <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-5" aria-label={tx(t, "jsonTemplateSkill", "Template skill")}>
                    <TabsTrigger value="multilevel" className="flex items-center justify-center gap-1.5 text-xs">
                      <Sparkles className="size-3.5 text-brand" aria-hidden />
                      Full CBT
                    </TabsTrigger>
                    <TabsTrigger value="listening" className="flex items-center justify-center gap-1.5 text-xs">
                      <Headphones className="size-3.5" aria-hidden />
                      {tx(t, "templateListening", "Listening")}
                    </TabsTrigger>
                    <TabsTrigger value="reading" className="flex items-center justify-center gap-1.5 text-xs">
                      <BookOpenText className="size-3.5" aria-hidden />
                      {tx(t, "templateReading", "Reading")}
                    </TabsTrigger>
                    <TabsTrigger value="writing" className="flex items-center justify-center gap-1.5 text-xs">
                      <PenLine className="size-3.5" aria-hidden />
                      Writing
                    </TabsTrigger>
                    <TabsTrigger value="speaking" className="flex items-center justify-center gap-1.5 text-xs">
                      <Mic className="size-3.5" aria-hidden />
                      Speaking
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
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
                <p className="text-xs text-fg-subtle">
                  {EXAM_IMPORT_TEMPLATES.find((option) => option.id === templateId)?.description}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={useTemplate} className="min-h-9">
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
              <div className="space-y-2">
              <label htmlFor="json-input" className="text-sm font-medium">
                {tx(t, "jsonPasteLabel", "JSON package")}
              </label>
              <textarea
                id="json-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder='{"schemaVersion": "1.0", "packageId": "…"}'
                className="w-full min-w-0 rounded-[8px] border border-border bg-bg px-3 py-2 font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="min-h-9"
                >
                  <FileUp className="size-4 shrink-0" aria-hidden />
                  {tx(t, "jsonChooseFile", "Choose file")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleValidate}
                  loading={validate.isPending}
                  disabled={!text.trim()}
                  className="min-h-9"
                >
                  {tx(t, "checkImport", "Check import")}
                </Button>
              </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {report && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={report.canImport ? "success" : "danger"}>
                    {report.canImport
                      ? tx(t, "jsonReady", "Ready to import")
                      : tx(t, "jsonBlocked", "Needs corrections")}
                  </Badge>
                  <span className="text-xs text-fg-muted tabular-nums">
                    {report.counts.sections} {tx(t, "sections", "sections")} · {report.counts.questions}{" "}
                    {tx(t, "questions", "questions")} · {report.counts.media}{" "}
                    {tx(t, "jsonMedia", "media")}
                  </span>
                  {report.sanitizerNotes.some((n) => n.changed) && (
                    <span className="text-xs text-warning">
                      {tx(t, "jsonSanitized", "Some HTML was sanitized — review before publishing.")}
                    </span>
                  )}
                </div>
              )}
              {grouped && grouped.importBlocking.length > 0 && (
                <IssueList
                  title={tx(t, "jsonImportBlockers", "Must fix before import")}
                  issues={grouped.importBlocking}
                />
              )}
              {grouped && grouped.publishBlocking.length > 0 && (
                <IssueList
                  title={tx(t, "jsonPublishBlockers", "Draft allowed — blocks publish")}
                  issues={grouped.publishBlocking}
                />
              )}
              {grouped && report?.canImport && decls.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{tx(t, "jsonBindMedia", "Bind media files")}</p>
                  {decls.map((d) => (
                    <div
                      key={d.key}
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-sm"
                    >
                      <Plug className="size-4 shrink-0 text-fg-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d.fileName}>
                        {d.key} · {d.fileName}
                        {d.requiredForPublish && (
                          <span className="text-warning"> · {tx(t, "required", "required")}</span>
                        )}
                      </span>
                      {stagedNames[d.key] ? (
                        <Badge variant="success">{stagedNames[d.key]}</Badge>
                      ) : (
                        <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-xs font-medium hover:bg-surface-hover">
                          {stage.isPending
                            ? tx(t, "uploading", "Uploading…")
                            : tx(t, "chooseMediaFile", "Choose file")}
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
                <div className="rounded-[8px] border border-danger/40 bg-danger/5 px-3 py-2 text-sm" role="alert">
                  <p className="flex items-center gap-1.5 font-medium text-danger">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    {commitError}
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
        <DialogFooter>
          <Button variant="outline" onClick={close} className="min-h-10 justify-center">
            {tc("close")}
          </Button>
          {phase === "report" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPhase("edit")}
                className="min-h-10 justify-center"
              >
                {tx(t, "editJson", "Edit JSON")}
              </Button>
              {report?.canImport && (
                <Button
                  size="sm"
                  onClick={handleCommit}
                  loading={importing}
                  disabled={importing}
                  className="min-h-10 justify-center"
                >
                  {targetExamId
                    ? tx(t, "addToExam", "Add to selected exam")
                    : tx(t, "createDraft", "Create draft")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueList({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ code: string; path: string; message: string }>;
}) {
  const shown = issues.slice(0, 50);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {title} ({issues.length})
      </p>
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[8px] border border-border p-2 text-xs">
        {shown.map((i, idx) => (
          <li key={`${i.code}-${i.path}-${idx}`} className="break-words">
            <span className="font-mono font-semibold">{i.code}</span>{" "}
            <span className="font-mono text-fg-muted">{i.path}</span>
            <span className="text-fg-muted"> — {i.message}</span>
          </li>
        ))}
        {issues.length > shown.length && (
          <li className="text-fg-muted">… +{issues.length - shown.length}</li>
        )}
      </ul>
    </div>
  );
}
