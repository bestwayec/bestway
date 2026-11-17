"use client";

import * as React from "react";
import { BookOpen, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const GRAMMAR_29_LESSONS = [
  { order: 1, title: "Future Continuous" },
  { order: 2, title: "Future Perfect Continuous" },
  { order: 3, title: "Future Perfect" },
  { order: 4, title: "Future Simple" },
  { order: 5, title: "Gerund va Infinitive" },
  { order: 6, title: "If Conditionals" },
  { order: 7, title: "Indirect Speech" },
  { order: 8, title: "Modal verbs" },
  { order: 9, title: "Numerals part 2" },
  { order: 10, title: "Passive Voice" },
  { order: 11, title: "Past Continuous" },
  { order: 12, title: "Past Perfect Continuous" },
  { order: 13, title: "Past Perfect" },
  { order: 14, title: "Past Simple" },
  { order: 15, title: "Personal and Possessive Pronouns" },
  { order: 16, title: "Possessive Case" },
  { order: 17, title: "Prefixes" },
  { order: 18, title: "Prepositions part 2" },
  { order: 19, title: "Present Continuous" },
  { order: 20, title: "Present Perfect Continuous" },
  { order: 21, title: "Present Perfect" },
  { order: 22, title: "Present Simple" },
  { order: 23, title: "Pronouns part 2" },
  { order: 24, title: "Question Words" },
  { order: 25, title: "Reflexive Pronouns" },
  { order: 26, title: "Relative Clause" },
  { order: 27, title: "Some, Any, No" },
  { order: 28, title: "State Verbs" },
  { order: 29, title: "Used to and Would" },
];

/** Exams a group can be given as homework (ids of the seeded exams; titles are their product names). */
const ASSIGNABLE_EXAMS = [
  { id: "multilevel-test-01-gym-vegetarian", title: "Multi-Level CEFR Mock Test 1 (Gym & Diet)" },
  { id: "ielts-academic-mock-01", title: "IELTS Academic Mock Test (Full 4-skills)" },
];

interface CreateAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cohortId: string;
  cohortName: string;
  onCreated: () => void;
}

export function CreateAssignmentModal({ open, onOpenChange, cohortId, cohortName, onCreated }: CreateAssignmentModalProps) {
  const t = useTranslations("teacherWorkspace");
  const tc = useTranslations("common");
  const [type, setType] = React.useState<"lesson" | "exam">("lesson");
  const [title, setTitle] = React.useState("");
  const [titleError, setTitleError] = React.useState<string | undefined>();
  const [selectedLessonOrder, setSelectedLessonOrder] = React.useState<number>(1);
  const [selectedExamId, setSelectedExamId] = React.useState(ASSIGNABLE_EXAMS[0].id);
  const [deadline, setDeadline] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    d.setHours(23, 59, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [minPassPercent, setMinPassPercent] = React.useState(80);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // A default title for the chosen lesson or exam; the teacher can change it.
  React.useEffect(() => {
    if (type === "lesson") {
      const lesson = GRAMMAR_29_LESSONS.find((l) => l.order === selectedLessonOrder);
      if (lesson) setTitle(t("lessonTaskTitle", { n: lesson.order, title: lesson.title }));
    } else {
      setTitle(ASSIGNABLE_EXAMS.find((e) => e.id === selectedExamId)?.title ?? "");
    }
  }, [type, selectedLessonOrder, selectedExamId, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t("assignmentTitleRequired"));
      return;
    }
    setTitleError(undefined);
    try {
      setIsSubmitting(true);
      const payload: Record<string, unknown> = {
        cohort_id: cohortId,
        title: title.trim(),
        deadline: new Date(deadline).toISOString(),
        min_pass_percent: minPassPercent,
      };
      if (type === "lesson") payload.lesson_id = `lesson-grammar-${selectedLessonOrder}`;
      else payload.exam_id = selectedExamId;
      await apiClient.post("/teacher/assignments", payload);
      toast.success(t("assignmentCreated"));
      onCreated();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tc("unknownError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const select = "h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-fg sm:text-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25";
  const typeButton = (value: "lesson" | "exam", Icon: typeof BookOpen, label: string) => (
    <button
      type="button"
      aria-pressed={type === value}
      onClick={() => setType(value)}
      className={cn(
        "flex min-h-10 items-center justify-center gap-2 rounded-field text-sm font-semibold transition-colors duration-fast",
        type === value ? "bg-surface text-fg shadow-e1" : "text-fg-muted hover:text-fg",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{t("newAssignmentTitle")}</DialogTitle>
            <DialogDescription>{t("forGroup", { name: cohortName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-2">
            <div className="grid grid-cols-2 gap-1 rounded-control border border-border bg-bg-subtle p-1" role="group" aria-label={t("assignmentType")}>
              {typeButton("lesson", BookOpen, t("typeLesson"))}
              {typeButton("exam", Target, t("typeExam"))}
            </div>

            {type === "lesson" ? (
              <Field label={t("chooseLesson")} htmlFor="assignment-lesson">
                <select id="assignment-lesson" value={selectedLessonOrder} onChange={(e) => setSelectedLessonOrder(Number(e.target.value))} className={select}>
                  {GRAMMAR_29_LESSONS.map((l) => (
                    <option key={l.order} value={l.order}>{t("lessonOption", { n: l.order, title: l.title })}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={t("chooseExam")} htmlFor="assignment-exam">
                <select id="assignment-exam" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)} className={select}>
                  {ASSIGNABLE_EXAMS.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
                </select>
              </Field>
            )}

            <Field label={t("assignmentTitle")} htmlFor="assignment-title" error={titleError}>
              <Input id="assignment-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("deadline")} htmlFor="assignment-deadline">
                <Input id="assignment-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
              </Field>
              <Field label={t("passMark", { percent: minPassPercent })} htmlFor="assignment-pass">
                <input id="assignment-pass" type="range" min="50" max="100" step="5" value={minPassPercent} onChange={(e) => setMinPassPercent(Number(e.target.value))} className="h-11 w-full accent-brand" />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{tc("cancel")}</Button>
            <Button type="submit" loading={isSubmitting}>{t("assign")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
