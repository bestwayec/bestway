"use client";

import * as React from "react";
import { CheckCircle2, Mic, Plus, Save, Trash2, XCircle } from "lucide-react";
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
import type { MockExamDetail } from "@/lib/types";
import { groupIssueCount } from "./checks";
import { ConfirmDialog } from "./ConfirmDialog";
import { tx, type Selection } from "./types";

/**
 * Speaking section view: a clean task list.
 *
 * Each task shows its number/context, a short prompt preview, configuration
 * status and validation state. No answer keys, no MC/completion UI — prompts
 * only, teacher-graded (students record audio).
 */
export function SpeakingSectionPanel({
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
  const [creating, setCreating] = React.useState(false);

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

  const tasks = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);

  async function handleAddTask() {
    if (!section || creating) return;
    setCreating(true);
    try {
      const n = section.groups.length + 1;
      const g = (await createGroup.mutateAsync({
        sectionId: section.id,
        input: { title: `Part ${n}`, sortOrder: section.groups.length },
      })) as { id: string };
      onSelect({ kind: "group", groupId: g.id });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("unknownError"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
          <Mic className="size-4 text-fg-muted" aria-hidden />
          Speaking · Tasks ({tasks.length})
        </h3>
        <Badge variant="info" className="ml-auto">
          Teacher graded
        </Badge>
      </div>
      <p className="text-xs text-fg-muted">
        Speaking prompts. Students record audio answers — teachers score 0–9.
      </p>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-semibold text-fg">No speaking tasks have been configured.</p>
            <p className="text-sm text-fg-muted">
              Add the first prompt — e.g. Part 1 introduction, Part 2 long turn, Part 3 discussion.
            </p>
            <Button size="sm" variant="outline" loading={creating} onClick={() => void handleAddTask()}>
              <Plus className="size-4" aria-hidden />
              Add Speaking Task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" loading={creating} onClick={() => void handleAddTask()}>
              <Plus className="size-4" aria-hidden />
              Add Speaking Task
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {tasks.map((g, gi) => {
              const issues = groupIssueCount(g, "speaking");
              const q = g.questions[0] ?? null;
              const prompt = q?.prompt?.trim() ?? "";
              const ready = issues === 0 && prompt !== "";
              const label = g.title?.trim() || `Part ${gi + 1}`;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelect({ kind: "group", groupId: g.id })}
                  aria-label={`${label} — ${ready ? "Ready" : "Needs attention"}`}
                  className="rounded-card border border-border bg-surface p-4 text-left transition hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <div className="flex items-center gap-2">
                    {ready ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
                    )}
                    <span className="truncate text-sm font-semibold text-fg">{label}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-fg-subtle">
                      {ready ? "Ready" : prompt ? "Needs attention" : "Prompt missing"}
                    </span>
                  </div>
                  {prompt ? (
                    <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[13px] text-fg">
                      {prompt}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[13px] text-danger">
                      Prompt missing — open the editor to add it.
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-fg-subtle">
                    {g.questions.length === 0
                      ? "Not configured"
                      : prompt
                        ? "Prompt configured"
                        : "Configuration incomplete"}{" "}
                    · Open editor →
                  </p>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Section settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Speaking settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx(t, "title", "Title")} htmlFor="ss-title">
              <Input
                id="ss-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Speaking"
              />
            </Field>
            <Field
              label={tx(t, "duration", "Duration (minutes)")}
              hint={tx(t, "durationHintSpeaking", "Not used for timing in Timed exam mode — Speaking has no overall time limit; students end this section by submitting manually.")}
              htmlFor="ss-dur"
            >
              <Input
                id="ss-dur"
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="—"
              />
            </Field>
          </div>
          <Field label={tx(t, "sectionInstructions", "Section instructions")} htmlFor="ss-instr">
            <Textarea
              id="ss-instr"
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
        title={`${tx(t, "deleteSection", "Delete section")} — Speaking?`}
        description={`Delete this section with all its content? This will remove its ${tasks.length} tasks.`}
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
