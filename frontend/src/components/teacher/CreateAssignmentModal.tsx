"use client";

import * as React from "react";
import { BookOpen, Calendar, CheckCircle2, Clock, FileText, Loader2, Target, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";

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

interface CreateAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cohortId: string;
  cohortName: string;
  onCreated: () => void;
}

export function CreateAssignmentModal({
  open,
  onOpenChange,
  cohortId,
  cohortName,
  onCreated,
}: CreateAssignmentModalProps) {
  const [type, setType] = React.useState<"lesson" | "exam">("lesson");
  const [title, setTitle] = React.useState("");
  const [selectedLessonOrder, setSelectedLessonOrder] = React.useState<number>(1);
  const [selectedExamId, setSelectedExamId] = React.useState("multilevel-test-01-gym-vegetarian");
  const [deadline, setDeadline] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    d.setHours(23, 59, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [minPassPercent, setMinPassPercent] = React.useState(80);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Auto-fill default title when selecting lesson
  React.useEffect(() => {
    if (type === "lesson") {
      const lesson = GRAMMAR_29_LESSONS.find((l) => l.order === selectedLessonOrder);
      if (lesson) {
        setTitle(`${lesson.order}-dars: ${lesson.title} video va test vazifasi`);
      }
    } else {
      setTitle("Multi-Level Mock Test 1 (Writing & Speaking)");
    }
  }, [type, selectedLessonOrder]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Vazifa sarlavhasini kiriting");
      return;
    }

    try {
      setIsSubmitting(true);
      const payload: Record<string, unknown> = {
        cohort_id: cohortId,
        title: title.trim(),
        deadline: new Date(deadline).toISOString(),
        min_pass_percent: minPassPercent,
      };

      if (type === "lesson") {
        payload.lesson_id = `lesson-grammar-${selectedLessonOrder}`;
      } else {
        payload.exam_id = selectedExamId;
      }

      await apiClient.post("/teacher/assignments", payload);
      toast.success("Uyga vazifa muvaffaqiyatli biriktirildi!");
      onCreated();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Xatolik yuz berdi";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border border-border/80 bg-surface-elevated/95 p-6 backdrop-blur-xl sm:rounded-2xl">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-xl font-bold text-fg">
            Yangi Uyga Vazifa Biriktirish
          </DialogTitle>
          <DialogDescription className="text-sm text-fg-muted">
            Guruh: <span className="font-semibold text-emerald-400">{cohortName}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Type Toggle */}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted/50 p-1 border border-border/50">
            <button
              type="button"
              onClick={() => setType("lesson")}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all ${
                type === "lesson"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-fg-muted hover:text-fg hover:bg-surface-elevated"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              29 ta Darslik
            </button>
            <button
              type="button"
              onClick={() => setType("exam")}
              className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all ${
                type === "exam"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-fg-muted hover:text-fg hover:bg-surface-elevated"
              }`}
            >
              <Target className="h-4 w-4" />
              IELTS / CEFR Mock
            </button>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-fg-muted">Vazifa Nomi</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="Masalan: 5-dars testini topshirish"
              required
            />
          </div>

          {/* Content Selector */}
          {type === "lesson" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Grammatika Darsini Tanlang</label>
              <select
                value={selectedLessonOrder}
                onChange={(e) => setSelectedLessonOrder(Number(e.target.value))}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-fg focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {GRAMMAR_29_LESSONS.map((l) => (
                  <option key={l.order} value={l.order}>
                    {l.order}-dars: {l.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted">Imtihonni Tanlang</label>
              <select
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-fg focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="multilevel-test-01-gym-vegetarian">
                  Multi-Level CEFR Mock Test 1 (Gym & Diet)
                </option>
                <option value="ielts-academic-mock-01">
                  IELTS Academic Mock Test (Full 4-skills)
                </option>
              </select>
            </div>
          )}

          {/* Deadline & Min Score */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-emerald-400" />
                Muddati (Deadline)
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-xs text-fg focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-fg-muted flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                O'tish Balli ({minPassPercent}%)
              </label>
              <input
                type="range"
                min="50"
                max="100"
                step="5"
                value={minPassPercent}
                onChange={(e) => setMinPassPercent(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Bekor qilish
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Biriktirilmoqda...
                </>
              ) : (
                "Vazifani Biriktirish"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
