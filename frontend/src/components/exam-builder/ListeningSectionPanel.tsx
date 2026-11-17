"use client";

import * as React from "react";
import { CheckCircle2, Music, Plus, Save, Trash2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  useCreateMockGroup,
  useDeleteMockSection,
  useUpdateMockSection,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail } from "@/lib/types";
import { groupIssueCount } from "./checks";
import { ConfirmDialog } from "./ConfirmDialog";
import { partRangeLabel, partTypeSummary } from "./ListeningPartEditor";
import { tx, type Selection } from "./types";

/**
 * Listening section view: Parts 1–4 at a glance.
 *
 * Each part card shows audio state, question range/count and what is still
 * missing — the admin moves between parts without learning any storage model.
 * Creating a part never asks for partNumber/sortOrder/ids: the next free
 * part number is derived automatically.
 */
export function ListeningSectionPanel({
  examId,
  detail,
  sectionId,
  onSelect,
  registerSave,
  onDirty,
}: {
  examId: string;
  detail: MockExamDetail;
  sectionId: string;
  onSelect: (s: Selection) => void;
  registerSave: (fn: (() => Promise<boolean>) | null) => void;
  onDirty: (d: boolean) => void;
}) {
  const t = useTranslations("examBuilder");
  const tc = useTranslations("common");
  const section = detail.sections.find((s) => s.id === sectionId);
  const update = useUpdateMockSection(examId);
  const delSection = useDeleteMockSection(examId);
  const createGroup = useCreateMockGroup(examId);

  const [title, setTitle] = React.useState(section?.title ?? "");
  const [duration, setDuration] = React.useState(
    section?.durationMinutes != null ? String(section.durationMinutes) : "",
  );
  const [instructions, setInstructions] = React.useState(section?.instructions ?? "");
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const dirty = React.useMemo(() => {
    if (!section) return false;
    return (
      title !== (section.title ?? "") ||
      duration !== (section.durationMinutes != null ? String(section.durationMinutes) : "") ||
      instructions !== (section.instructions ?? "")
    );
  }, [title, duration, instructions, section]);
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = React.useCallback(async () => {
    if (!section) return false;
    const dur = duration === "" ? undefined : Number(duration);
    if (dur !== undefined && (!Number.isFinite(dur) || dur < 1 || dur > 300)) {
      toast.error(tx(t, "durationInvalid", "Duration must be 1–300 minutes."));
      return false;
    }
    setSaving(true);
    try {
      await update.mutateAsync({
        sectionId: section.id,
        input: {
          title: title.trim() || undefined,
          // Listening timing is audio-derived — never persist durationMinutes.
          durationMinutes: undefined,
          instructions: instructions.trim() || undefined,
        },
      });
      toast.success(tc("saved"));
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("unknownError"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [section, title, duration, instructions, update, t, tc]);

  React.useEffect(() => {
    registerSave(() => save());
    return () => registerSave(null);
  }, [registerSave, save]);

  if (!section) return null;

  const parts = [...section.groups].sort((a, b) => {
    const pa = a.partNumber ?? a.sortOrder + 1;
    const pb = b.partNumber ?? b.sortOrder + 1;
    return pa - pb || a.sortOrder - b.sortOrder;
  });
  const questionCount = section.groups.reduce((a, g) => a + g.questions.length, 0);
  const nextPartNo = parts.reduce((m, g) => Math.max(m, g.partNumber ?? 0), parts.length) + 1;
  const canAddPart = parts.length < 4 && nextPartNo <= 4;

  function handleAddPart() {
    if (!canAddPart) {
      toast.error(tx(t, "maxPartsReached", "Listening has 4 parts — all configured."));
      return;
    }
    createGroup.mutate(
      {
        sectionId: section!.id,
        input: {
          title: `Part ${nextPartNo}`,
          sortOrder: Math.max(-1, ...section!.groups.map((g) => g.sortOrder)) + 1,
          partNumber: nextPartNo,
          audioPlayLimit: 1,
        },
      },
      {
        onSuccess: (g) => onSelect({ kind: "group", groupId: (g as { id: string }).id }),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-fg">
          {tx(t, "parts", "Parts")} ({parts.length})
          <span className="ml-2 font-normal text-fg-muted">
            {questionCount} {tx(t, "questions", "questions")}
          </span>
        </h3>
        <div className="ml-auto">
          <Button
            size="sm"
            loading={createGroup.isPending}
            onClick={handleAddPart}
            disabled={!canAddPart}
            title={!canAddPart ? tx(t, "maxPartsReached", "Listening has 4 parts — all configured.") : undefined}
          >
            <Plus className="size-4" aria-hidden />
            {parts.length === 0
              ? tx(t, "createPart1", "Create Part 1")
              : canAddPart
                ? tx(t, "addPart", `Add Part ${nextPartNo}`)
                : tx(t, "partsComplete", "Parts complete")}
          </Button>
        </div>
      </div>

      {parts.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">
              {tx(t, "noPartsTitle", "Listening has no parts yet.")}
            </p>
            <p className="text-sm text-fg-muted">
              {tx(
                t,
                "noPartsHint",
                "IELTS Listening has 4 parts. Each part holds its own audio and question group — create Part 1 to begin, then upload its audio.",
              )}
            </p>
            <Button size="sm" loading={createGroup.isPending} onClick={handleAddPart}>
              <Plus className="size-4" aria-hidden />
              {tx(t, "createPart1", "Create Part 1")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {parts.map((g) => {
            const partNo = g.partNumber ?? parts.findIndex((x) => x.id === g.id) + 1;
            const issues = groupIssueCount(g, "listening");
            const n = g.questions.length;
            const range = partRangeLabel(g.questions.map((q) => q.number));
            const summary = partTypeSummary(g.questions.map((q) => q.type));
            const missing: string[] = [];
            if (!g.hasAudio && n > 0) missing.push(tx(t, "audioMissingShort", "Audio missing"));
            if (n === 0) missing.push(tx(t, "noQuestionsShort", "No questions yet"));
            if (issues > 0 && n > 0 && g.hasAudio)
              missing.push(
                issues === 1
                  ? tx(t, "oneIssue", "1 issue")
                  : `${issues} ${tx(t, "issues", "issues")}`,
              );
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelect({ kind: "group", groupId: g.id })}
                aria-label={`Part ${partNo}${g.title?.trim() ? ` — ${g.title.trim()}` : ""} — ${missing.length ? missing.join(", ") : tx(t, "ready", "Ready")}`}
                className="rounded-card border border-border bg-surface p-4 text-left transition hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="flex items-center gap-2">
                  {missing.length > 0 ? (
                    <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                  )}
                  <span className="truncate text-sm font-semibold text-fg">
                    Part {partNo}
                    {g.title?.trim() && g.title.trim() !== `Part ${partNo}` && (
                      <span className="font-normal text-fg-muted"> · {g.title.trim()}</span>
                    )}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-fg-muted">
                    {range ? `Q${range}` : "—"}
                    {" · "}
                    {n} {n === 1 ? tx(t, "questionOne", "question") : tx(t, "questions", "questions")}
                  </span>
                </div>
                {summary && <p className="mt-1 text-xs text-fg-muted">{summary}</p>}
                <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${missing.length ? "text-danger" : "text-success"}`}>
                  <Music className="size-3.5 shrink-0" aria-hidden />
                  {g.hasAudio
                    ? tx(t, "audioReady", "Audio ready")
                    : tx(t, "audioMissingShort", "Audio missing")}
                  {missing.length > 0 && (
                    <span className="text-fg-subtle">· {missing.join(" · ")}</span>
                  )}
                  <span className="ml-auto shrink-0 text-fg-subtle">
                    {tx(t, "openEditor", "Open editor →")}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Section settings — duration matters for Timed mode. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {tx(t, "listeningSettings", "Listening settings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx(t, "title", "Title")} htmlFor="ls-title">
              <Input
                id="ls-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Listening"
              />
            </Field>
            <Field
              label={tx(t, "duration", "Duration (minutes)")}
              hint={tx(t, "durationHintListening", "Not used for timing in Timed exam mode — Listening duration is calculated automatically from the audio length plus a 2-minute review period. This field is informational only.")}
              htmlFor="ls-dur"
            >
              <Input
                id="ls-dur"
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="—"
                disabled
              />
            </Field>
          </div>
          <Field label={tx(t, "sectionInstructions", "Section instructions")} htmlFor="ls-instr">
            <Textarea
              id="ls-instr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-20"
              placeholder={tx(t, "sectionInstrHint", "Shown once at the start of this section.")}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={saving} onClick={() => void save()}>
              <Save className="size-4" aria-hidden />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={delSection.isPending}
              onClick={() => setConfirmDelete(true)}
              className="ml-auto"
            >
              <Trash2 className="size-4" aria-hidden />
              {tx(t, "deleteSection", "Delete section")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title={`${tx(t, "deleteSection", "Delete section")} — Listening?`}
        description={tx(
          t,
          "deleteSectionConfirm",
          `Delete this section with all its content? This will remove its ${section.groups.length} parts and ${questionCount} questions.`,
        )}
        confirmLabel={tx(t, "deleteSection", "Delete section")}
        loading={delSection.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          delSection.mutate(section.id, {
            onSuccess: () => {
              toast.success(tx(t, "deletedGeneric", "Deleted"));
              onSelect({ kind: "overview" });
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
          })
        }
      />
    </div>
  );
}
