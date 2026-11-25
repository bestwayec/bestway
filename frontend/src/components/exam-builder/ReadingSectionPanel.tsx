"use client";

import { UnitGroupActions } from "./unit-group-actions";
import * as React from "react";
import { CheckCircle2, FileText, Plus, Save, Trash2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  useCreateMockGroup,
  useUpdateMockGroup,
  useDeleteMockSection,
  useUpdateMockSection,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import { objectivePositionCount } from "@/lib/objective-question";
import type { MockExamDetail } from "@/lib/types";
import { groupIssueCount } from "./checks";
import { ConfirmDialog } from "./ConfirmDialog";
import { partRangeLabel } from "./ReadingPassageEditor";
import { QTYPE_LABEL } from "@/components/mock/exam-builder/types";
import { clusterReadingPassages } from "./reading-passage-clusters";
import { tx, type Selection } from "./types";

function wordCount(text: string): number {
  const t = (text ?? "").trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/**
 * Reading section view: Passages at a glance.
 *
 * Each passage card shows text presence, question range/count, type mix and
 * what is still missing — the admin moves between passages without learning
 * any storage model. Creating a passage never asks for ids or sort orders.
 */
export function ReadingSectionPanel({
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
  const updateGroup = useUpdateMockGroup(examId);

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
          durationMinutes: dur,
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

  const passages = clusterReadingPassages(
    [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const questionCount = section.groups.reduce((a, g) => a + g.questions.length, 0);
  const nextNo = passages.length + 1;

  function handleAddPassage() {
    createGroup.mutate(
      {
        sectionId: section!.id,
        input: {
          title: `Passage ${nextNo}`,
          sortOrder: section!.groups.length,
        },
      },
      {
        onSuccess: (g) => onSelect({ kind: "group", groupId: (g as { id: string }).id }),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
      },
    );
  }

  const moveTaskGroup = (groupId: string, parentGroupId: string) => updateGroup.mutate(
    { groupId, input: { parentGroupId } },
    { onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")) },
  );
  const reorderTaskGroup = (groupId: string, siblingId: string, before: boolean) => updateGroup.mutate(
    { groupId, input: { groupPlacement: { siblingId, before } } },
    { onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")) },
  );
  const selectGroup = (groupId: string) => onSelect({ kind: "group", groupId });
  const duplicateTaskGroup = (copyFromGroupId: string) => createGroup.mutate(
    { sectionId: section.id, input: { copyFromGroupId } },
    {
      onSuccess: (g) => selectGroup((g as { id: string }).id),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
    },
  );
  const addTaskGroup = (parentGroupId: string) => createGroup.mutate(
    { sectionId: section.id, input: { parentGroupId, title: t("newUnitTaskGroup") } },
    {
      onSuccess: (g) => selectGroup((g as { id: string }).id),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : tc("unknownError")),
    },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-fg">
          {tx(t, "passages", "Passages")} ({passages.length})
          <span className="ml-2 font-normal text-fg-muted">
            {questionCount} {tx(t, "questions", "questions")}
          </span>
        </h3>
        <div className="ml-auto">
          <Button size="sm" loading={createGroup.isPending} onClick={handleAddPassage}>
            <Plus className="size-4" aria-hidden />
            {passages.length === 0
              ? tx(t, "createPassage1", "Create Passage 1")
              : tx(t, "addPassage", `Add Passage ${nextNo}`)}
          </Button>
        </div>
      </div>

      {passages.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">
              {tx(t, "noPassagesTitle", "Reading has no passages yet.")}
            </p>
            <p className="text-sm text-fg-muted">
              {tx(
                t,
                "noPassagesHint",
                "IELTS Reading has 3 passages. Each passage holds its text plus its question groups — create Passage 1 to begin, then paste its text.",
              )}
            </p>
            <Button size="sm" loading={createGroup.isPending} onClick={handleAddPassage}>
              <Plus className="size-4" aria-hidden />
              {tx(t, "createPassage1", "Create Passage 1")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {passages.map((passage) => {
            const passageNo = passage.ordinal;
            const firstGroup = passage.groups.find((g) => g.passageText?.trim()) ?? passage.groups[0];
            const issues = passage.groups.reduce(
              (total, group) => total + groupIssueCount(group, "reading"),
              0,
            );
            const n = passage.questions.length;
            const hasText = !!passage.passageText?.trim();
            const range = partRangeLabel(passage.questions.flatMap((q) => [
              q.displayNumber ?? q.number, q.displayNumberEnd ?? q.displayNumber ?? q.number,
            ]));
            const scoringPositions = passage.questions.reduce((total, q) => total + objectivePositionCount(q), 0);
            const types = [
              ...new Set(
                passage.groups.flatMap((group) => group.questions.map((q) => q.type)),
              ),
            ];
            const typeText =
              types.length === 0
                ? ""
                : types.length === 1
                  ? (QTYPE_LABEL[types[0]] ?? types[0])
                  : `${QTYPE_LABEL[types[0]]} + ${types.length - 1} more`;
            const missing: string[] = [];
            if (!hasText) missing.push(tx(t, "passageTextMissingShort", "Passage text missing"));
            if (n === 0) missing.push(tx(t, "noQuestionsShort", "No questions yet"));
            if (issues > 0 && hasText && n > 0)
              missing.push(
                issues === 1
                  ? tx(t, "oneIssue", "1 issue")
                  : `${issues} ${tx(t, "issues", "issues")}`,
              );
            return (
              <div key={firstGroup.id} className="min-w-0 rounded-card border border-border">
              <button
                type="button"
                onClick={() => onSelect({ kind: "group", groupId: firstGroup.id })}
                aria-label={`Passage ${passageNo}${passage.title?.trim() ? ` — ${passage.title.trim()}` : ""} — ${missing.length ? missing.join(", ") : tx(t, "ready", "Ready")}`}
                className="w-full rounded-card bg-surface p-4 text-left transition hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="flex items-center gap-2">
                  {missing.length > 0 ? (
                    <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
                  ) : (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                  )}
                  <span className="truncate text-sm font-semibold text-fg">
                    Passage {passageNo}
                    {passage.title?.trim() && passage.title.trim() !== `Passage ${passageNo}` && (
                      <span className="font-normal text-fg-muted"> · {passage.title.trim()}</span>
                    )}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-fg-muted">
                    {range ? `Q${range}` : "—"}
                    {" · "}
                    {n} {n === 1 ? tx(t, "questionOne", "question") : tx(t, "questions", "questions")}
                    {scoringPositions !== n && ` · ${t("scoringPositions", { count: scoringPositions })}`}
                  </span>
                </div>
                {typeText && (
                  <p className="mt-1 text-xs text-fg-muted">
                    {typeText} · {passage.groups.length}{" "}
                    {tx(t, "questionSets", "question sets")}
                  </p>
                )}
                <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${missing.length ? "text-danger" : "text-success"}`}>
                  <FileText className="size-3.5 shrink-0" aria-hidden />
                  {hasText
                    ? `${tx(t, "passageTextReady", "Passage text")} · ${wordCount(passage.passageText ?? "")} ${tx(t, "words", "words")}`
                    : tx(t, "passageTextMissingShort", "Passage text missing")}
                  {missing.length > 0 && (
                    <span className="text-fg-subtle">· {missing.join(" · ")}</span>
                  )}
                  <span className="ml-auto shrink-0 text-fg-subtle">
                    {tx(t, "openEditor", "Open editor →")}
                  </span>
                </p>
              </button>
              <UnitGroupActions groups={passage.groups} select={selectGroup} add={() => addTaskGroup(firstGroup.id)}
                duplicate={duplicateTaskGroup} move={moveTaskGroup} reorder={reorderTaskGroup}
                busy={createGroup.isPending || updateGroup.isPending}
                targets={passages.filter((other) => other !== passage).map((other) => ({
                  id: other.groups[0].id, label: other.title ?? `${t("passage")} ${other.ordinal}`,
                }))} />
              </div>
            );
          })}
        </div>
      )}

      {/* Section settings — duration matters for Timed mode. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {tx(t, "readingSettings", "Reading settings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx(t, "title", "Title")} htmlFor="rs-title">
              <Input
                id="rs-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Reading"
              />
            </Field>
            <Field
              label={tx(t, "duration", "Duration (minutes)")}
              hint={tx(t, "durationHint", "Required for Timed mode. Empty = untimed.")}
              htmlFor="rs-dur"
            >
              <Input
                id="rs-dur"
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="—"
              />
            </Field>
          </div>
          <Field label={tx(t, "sectionInstructions", "Section instructions")} htmlFor="rs-instr">
            <Textarea
              id="rs-instr"
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
        title={`${tx(t, "deleteSection", "Delete section")} — Reading?`}
        description={tx(
          t,
          "deleteSectionConfirm",
          `Delete this section with all its content? This will remove its ${passages.length} passages and ${questionCount} questions.`,
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
