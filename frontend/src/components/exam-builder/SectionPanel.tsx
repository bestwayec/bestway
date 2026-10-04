"use client";

import * as React from "react";
import { CheckCircle2, Plus, Save, Trash2, XCircle } from "lucide-react";
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
import { SKILL_META, defaultUnitTitle, tx, type Selection } from "./types";

/** Section settings + its parts/passages/tasks + add/delete. */
export function SectionPanel({
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

  // Unsaved-changes tracking for the topbar Save Draft.
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
          durationMinutes: section.skill === "listening" ? undefined : dur,
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
  const meta = SKILL_META[section.skill];
  const skillName = section.skill.charAt(0).toUpperCase() + section.skill.slice(1);
  const questionCount = section.groups.reduce((a, g) => a + g.questions.length, 0);
  // Generic fallback panel (only reached for unknown skills) — still guard
  // listening: its timing is audio-derived, never durationMinutes (backend
  // computeSkillTiming; keep in sync).
  const isListening = section.skill === "listening";

  function handleAddGroup() {
    createGroup.mutate(
      {
        sectionId: section!.id,
        input: {
          title: defaultUnitTitle(section!.skill, section!.groups.length),
          sortOrder: section!.groups.length,
          ...(section!.skill === "listening"
            ? { partNumber: section!.groups.length + 1, audioPlayLimit: detail.type === 'multilevel' ? 2 : 1 }
            : {}),
        },
      },
      {
        onSuccess: (g) => onSelect({ kind: "group", groupId: (g as { id: string }).id }),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  function handleDeleteSection() {
    setConfirmDelete(true);
  }

  return (
    <div className="space-y-4">
      {detail.specification && <Card className="space-y-2 p-4"><p className="font-semibold">{detail.specificationVersion}</p>
        {detail.specification[section.skill].parts.map((part) => <p key={part.key} className="text-sm">{part.key}: {part.count} questions/responses · {part.types.join(', ')}{part.rawMax ? ` · holistic raw maximum ${part.rawMax}` : ''}{part.wordMin ? ` · ${part.wordMin}–${part.wordMax} words` : ''}</p>)}
      </Card>}
      <Card>
        <CardHeader>
          <CardTitle>
            {skillName} <span className="font-normal text-fg-muted">· {tx(t, "settings", "settings")}</span>
          </CardTitle>
          <p className="text-xs text-fg-muted">
            {section.groups.length} {meta.units.toLowerCase()} · {questionCount}{" "}
            {tx(t, "questions", "questions")}
            {!isListening && section.durationMinutes != null && ` · ${section.durationMinutes} min`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx(t, "title", "Title")} htmlFor="sec-title">
              <Input
                id="sec-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={section.skill.charAt(0).toUpperCase() + section.skill.slice(1)}
              />
            </Field>
            <Field
              label={tx(t, "duration", "Duration (minutes)")}
              hint={
                isListening
                  ? tx(
                      t,
                      "durationHintListening",
                      "Not used for timing in Timed exam mode — Listening duration is calculated automatically from the audio length plus a 2-minute review period. This field is informational only.",
                    )
                  : tx(t, "durationHint", "Required for Timed mode. Empty = untimed.")
              }
              htmlFor="sec-dur"
            >
              <Input
                id="sec-dur"
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="—"
                disabled={isListening}
              />
            </Field>
          </div>
          <Field label={tx(t, "sectionInstructions", "Section instructions")} htmlFor="sec-instr">
            <Textarea
              id="sec-instr"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-20"
              placeholder={tx(t, "sectionInstrHint", "Shown once at the start of this section.")}
            />
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button size="sm" loading={saving} onClick={() => void save()} className="min-h-9 justify-center sm:w-auto">
              <Save className="size-4 shrink-0" aria-hidden />
              {tc("save")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={delSection.isPending}
              onClick={handleDeleteSection}
              className="min-h-9 justify-center sm:ml-auto sm:w-auto"
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{tx(t, "deleteSection", "Delete section")}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-fg">
          {meta.units} ({section.groups.length})
        </h3>
        <Button size="sm" variant="outline" loading={createGroup.isPending} onClick={handleAddGroup} className="min-h-9 shrink-0 max-sm:flex-1 max-sm:justify-center">
          <Plus className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{meta.addUnit}</span>
        </Button>
      </div>

      {section.groups.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">
              {skillName} {tx(t, "noUnitsTitle", "has no blocks yet.")}
            </p>
            <p className="text-sm text-fg-muted">
              {tx(
                t,
                "noUnitsHint",
                "Each block holds its material and question set. Add the first one to start building this section.",
              )}
            </p>
            <Button
              size="sm"
              variant="outline"
              loading={createGroup.isPending}
              onClick={handleAddGroup}
            >
              <Plus className="size-4" />
              {meta.addUnit}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {section.groups.map((g, gi) => {
            const issues = groupIssueCount(g, section.skill);
            const n = g.questions.length;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelect({ kind: "group", groupId: g.id })}
                className="min-w-0 rounded-[12px] border border-border bg-surface p-3 text-left transition hover:border-fg-subtle sm:p-4"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {issues > 0 ? (
                    <XCircle className="size-4 shrink-0 text-danger" />
                  ) : n > 0 ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                  ) : (
                    <span className="size-4 shrink-0 rounded-full border border-border" />
                  )}
                  <span className="truncate text-sm font-semibold text-fg">
                    {g.title?.trim() || `${meta.unit} ${gi + 1}`}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-fg-muted">
                    {n} {tx(t, "questions", "questions")}
                  </span>
                </div>
                {g.instructions?.trim() && (
                  <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{g.instructions}</p>
                )}
                <p className="mt-1.5 text-[11px] text-fg-subtle">
                  {section.skill === "listening" && (g.hasAudio ? "♪ audio · " : "✕ no audio · ")}
                  {section.skill === "reading" && (g.passageText?.trim() ? "▤ passage · " : "✕ no passage · ")}
                  {tx(t, "openEditor", "Open editor →")}
                </p>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-fg-subtle">{meta.hint}</p>

      <ConfirmDialog
        open={confirmDelete}
        title={`${tx(t, "deleteSection", "Delete section")} — ${skillName}?`}
        description={tx(
          t,
          "deleteSectionConfirm",
          `Delete this section with all its content? This will remove its ${section.groups.length} ${meta.units.toLowerCase()} and ${questionCount} questions.`,
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
