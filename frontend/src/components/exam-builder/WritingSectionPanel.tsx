"use client";

import * as React from "react";
import { CheckCircle2, PenLine, Plus, Save, Trash2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  useCreateMockGroup,
  useDeleteMockSection,
  useUpdateMockSection,
} from "@/hooks/use-mock";
import { ApiError } from "@/lib/api-client";
import type { MockExamDetail, MockGroup } from "@/lib/types";
import { groupIssueCount } from "./checks";
import { ConfirmDialog } from "./ConfirmDialog";
import { tx, type Selection } from "./types";

function taskQuestion(g: MockGroup, type: "essay_task1" | "essay_task2") {
  return g.questions.find((q) => q.type === type) ?? g.questions[0] ?? null;
}

function TaskCard({
  taskLabel,
  recommended,
  timeHint,
  group,
  onOpen,
}: {
  taskLabel: string;
  recommended: number;
  timeHint: string;
  group: MockGroup | undefined;
  onOpen: (groupId: string) => void;
}) {
  if (!group) return null;
  const q = group.questions[0] ?? null;
  const prompt = q?.prompt?.trim() ?? "";
  const issues = groupIssueCount(group, "writing");
  const ready = issues === 0 && prompt !== "";
  return (
    <button
      type="button"
      onClick={() => onOpen(group.id)}
      aria-label={`${taskLabel} — ${ready ? "Ready" : "Needs attention"}`}
      className="rounded-card border border-border bg-surface p-4 text-left transition hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-brand"
    >
      <div className="flex items-center gap-2">
        {ready ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
        )}
        <span className="truncate text-sm font-semibold text-fg">{taskLabel}</span>
        <Badge variant="info" className="ml-auto shrink-0">
          Teacher graded
        </Badge>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {timeHint} · Recommended minimum: {recommended} words
      </p>
      {prompt ? (
        <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[13px] text-fg">{prompt}</p>
      ) : (
        <p className="mt-1.5 text-[13px] text-danger">Prompt missing — open the editor to add it.</p>
      )}
      <p className="mt-1.5 text-[11px] text-fg-subtle">
        {ready ? "Configured" : "Needs attention"} · Open editor →
      </p>
    </button>
  );
}

/**
 * Writing section view: exactly Task 1 + Task 2.
 *
 * Intentionally different from Listening/Reading: no question-group workflow,
 * no options/keys/points. One prompt per task, teacher-graded, with
 * human-readable word guidance (150 / 250) that mirrors the student runner
 * soft reminder — no backend validation is invented.
 */
export function WritingSectionPanel({
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
  const [creating, setCreating] = React.useState<"task1" | "task2" | null>(null);

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

  const groups = section.groups;
  const task1Group = groups.find((g) => g.questions.some((q) => q.type === "essay_task1") || (!g.questions.length && g.title?.toLowerCase() === "task 1"));
  const task2Group = groups.find((g) => g.questions.some((q) => q.type === "essay_task2") || (!g.questions.length && g.title?.toLowerCase() === "task 2"));
  const others = groups.filter((g) => g !== task1Group && g !== task2Group);

  async function handleAddTask(kind: "task1" | "task2") {
    if (!section || creating) return;
    setCreating(kind);
    const label = kind === "task1" ? "Task 1" : "Task 2";
    try {
      const g = (await createGroup.mutateAsync({
        sectionId: section.id,
        input: { title: label, sortOrder: section.groups.length },
      })) as { id: string };
      onSelect({ kind: "group", groupId: g.id });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("unknownError"));
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
          <PenLine className="size-4 text-fg-muted" aria-hidden />
          Writing · Task 1 + Task 2
        </h3>
        <Badge variant="info" className="ml-auto">
          Teacher graded
        </Badge>
      </div>
      <p className="text-xs text-fg-muted">
        Two prompts. Students write essays — teachers score 0–9. Task 2 counts double toward the
        Writing band.
      </p>

      {/* Task 1 slot */}
      {task1Group ? (
        <TaskCard
          taskLabel="Task 1"
          recommended={150}
          timeHint="About 20 minutes"
          group={task1Group}
          onOpen={(id) => onSelect({ kind: "group", groupId: id })}
        />
      ) : (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">Task 1 is not configured yet.</p>
            <p className="text-sm text-fg-muted">
              About 20 minutes · Recommended minimum: 150 words · Teacher graded.
            </p>
            <Button
              size="sm"
              variant="outline"
              loading={creating === "task1"}
              onClick={() => void handleAddTask("task1")}
            >
              <Plus className="size-4" aria-hidden />
              Add Task 1 content
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Task 2 slot */}
      {task2Group ? (
        <TaskCard
          taskLabel="Task 2"
          recommended={250}
          timeHint="About 40 minutes"
          group={task2Group}
          onOpen={(id) => onSelect({ kind: "group", groupId: id })}
        />
      ) : (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">Task 2 is not configured yet.</p>
            <p className="text-sm text-fg-muted">
              About 40 minutes · Recommended minimum: 250 words · Teacher graded. Task 2 counts
              double toward the Writing band.
            </p>
            <Button
              size="sm"
              variant="outline"
              loading={creating === "task2"}
              onClick={() => void handleAddTask("task2")}
            >
              <Plus className="size-4" aria-hidden />
              Add Task 2 content
            </Button>
          </CardContent>
        </Card>
      )}

      {others.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-fg-muted">
            Additional writing blocks ({others.length}) — IELTS needs only Task 1 + Task 2.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {others.map((g) => {
              const issues = groupIssueCount(g, "writing");
              const q = taskQuestion(g, "essay_task1");
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelect({ kind: "group", groupId: g.id })}
                  className="rounded-card border border-dashed border-border bg-surface p-4 text-left transition hover:border-fg-subtle"
                >
                  <div className="flex items-center gap-2">
                    {issues > 0 ? (
                      <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                    )}
                    <span className="truncate text-sm font-semibold text-fg">
                      {g.title?.trim() || "Writing block"}
                    </span>
                  </div>
                  {q?.prompt?.trim() ? (
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{q.prompt.trim()}</p>
                  ) : (
                    <p className="mt-1 text-xs text-danger">Prompt missing.</p>
                  )}
                  <p className="mt-1.5 text-[11px] text-fg-subtle">Open editor →</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Section settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Writing settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx(t, "title", "Title")} htmlFor="ws-title">
              <Input
                id="ws-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Writing"
              />
            </Field>
            <Field
              label={tx(t, "duration", "Duration (minutes)")}
              hint={tx(t, "durationHint", "Required for Timed mode. Empty = untimed.")}
              htmlFor="ws-dur"
            >
              <Input
                id="ws-dur"
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
              />
            </Field>
          </div>
          <Field label={tx(t, "sectionInstructions", "Section instructions")} htmlFor="ws-instr">
            <Textarea
              id="ws-instr"
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
        title={`${tx(t, "deleteSection", "Delete section")} — Writing?`}
        description={`Delete this section with all its content? This will remove its ${groups.length} tasks.`}
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
