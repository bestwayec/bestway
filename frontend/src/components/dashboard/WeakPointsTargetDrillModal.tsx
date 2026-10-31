"use client";

import * as React from "react";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronRight,
  Flame,
  HelpCircle,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface PracticeQuestion {
  id: string;
  questionNumber: number;
  context?: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

interface TargetedPracticeData {
  practiceId: string;
  categoryId: string;
  categoryTitle: string;
  questionCount: number;
  questions: PracticeQuestion[];
}

interface WeakPointsTargetDrillModalProps {
  isOpen: boolean;
  onClose: () => void;
  moduleTitle: string;
  categoryId: string;
  onCompleted?: (result: { correctCount: number; pointsAwarded: number }) => void;
}

export function WeakPointsTargetDrillModal({
  isOpen,
  onClose,
  moduleTitle,
  categoryId,
  onCompleted,
}: WeakPointsTargetDrillModalProps) {
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<TargetedPracticeData | null>(null);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [selectedAnswer, setSelectedAnswer] = React.useState<string | null>(null);
  const [isChecked, setIsChecked] = React.useState(false);
  const [answersLog, setAnswersLog] = React.useState<
    Array<{ questionId: string; selectedAnswer: string; isCorrect: boolean }>
  >([]);
  const [isFinished, setIsFinished] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // Fetch drill questions when modal opens
  React.useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setIsChecked(false);
    setAnswersLog([]);
    setIsFinished(false);

    apiClient
      .get<TargetedPracticeData>(`/api/v1/study-plan/targeted-practice?category=${encodeURIComponent(categoryId)}`)
      .then((res) => {
        if (!isMounted) return;
        setData(res);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load targeted practice:", err);
        toast.error("Mashq savollarini yuklashda xatolik yuz berdi");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, categoryId]);

  const questions = data?.questions || [];
  const currentQ = questions[currentIndex];

  const handleSelectOption = (opt: string) => {
    if (isChecked) return;
    setSelectedAnswer(opt);
  };

  const handleCheckAnswer = () => {
    if (!selectedAnswer || !currentQ) return;
    setIsChecked(true);

    const isCorrect =
      selectedAnswer.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase() ||
      (currentQ.correctAnswer.length > 2 &&
        selectedAnswer.trim().toLowerCase().startsWith(currentQ.correctAnswer.trim().toLowerCase().slice(0, 2)));

    setAnswersLog((prev) => [
      ...prev,
      {
        questionId: currentQ.id,
        selectedAnswer,
        isCorrect,
      },
    ]);

    if (isCorrect) {
      toast.success("To'g'ri javob! Barakalla!", { duration: 1500 });
    } else {
      toast.error("Noto'g'ri. Tushuntirishga e'tibor bering.", { duration: 2000 });
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setIsChecked(false);
    } else {
      finishDrill();
    }
  };

  const finishDrill = async () => {
    setIsFinished(true);
    setSubmitting(true);

    const correctCount = answersLog.filter((a) => a.isCorrect).length + (
      // Include current question if just checked
      isChecked && selectedAnswer && currentQ && (
        selectedAnswer.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase() ||
        (currentQ.correctAnswer.length > 2 &&
          selectedAnswer.trim().toLowerCase().startsWith(currentQ.correctAnswer.trim().toLowerCase().slice(0, 2)))
      ) && !answersLog.some((a) => a.questionId === currentQ.id)
        ? 1
        : 0
    );

    try {
      await apiClient.post("/api/v1/study-plan/targeted-practice/submit", {
        categoryId,
        answers: answersLog,
      });
      toast.success("⚡️ +50 XP hisobingizga muvaffaqiyatli qo'shildi!");
      onCompleted?.({ correctCount, pointsAwarded: 50 });
    } catch (err) {
      console.error("Failed to submit drill:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const totalQuestions = questions.length || 10;
  const correctCount = answersLog.filter((a) => a.isCorrect).length;
  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl overflow-hidden border border-emerald-500/30 bg-[#0B0F17] p-0 text-slate-100 shadow-2xl backdrop-blur-xl sm:rounded-2xl">
        {/* Header Bar */}
        <div className="relative border-b border-slate-800 bg-slate-900/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-10 place-items-center rounded-xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 shadow-xs">
                <Zap className="size-5 fill-emerald-400" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-100 sm:text-lg">
                  {moduleTitle}
                </DialogTitle>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <span className="font-semibold text-emerald-400">Target Drill</span>
                  <span>·</span>
                  <span>10 ta chuqurlashtirilgan mashq topshirig&apos;i</span>
                  <span>·</span>
                  <span className="text-amber-400 font-bold">+50 XP</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Progress Indicator */}
          {!loading && !isFinished && questions.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-medium">
                  Savol: <strong className="text-emerald-400">{currentIndex + 1}</strong> / {totalQuestions}
                </span>
                <span className="text-emerald-400 font-mono font-bold">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6">
          {loading ? (
            <div className="space-y-4 py-8">
              <Skeleton className="h-6 w-3/4 bg-slate-800" />
              <Skeleton className="h-24 w-full bg-slate-800" />
              <div className="space-y-2 pt-2">
                <Skeleton className="h-12 w-full bg-slate-800" />
                <Skeleton className="h-12 w-full bg-slate-800" />
                <Skeleton className="h-12 w-full bg-slate-800" />
              </div>
            </div>
          ) : isFinished ? (
            /* Finished Summary View */
            <div className="py-6 text-center space-y-5">
              <div className="mx-auto grid size-20 place-items-center rounded-2xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-500/10">
                <Award className="size-10" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-black text-slate-100">
                  Mashq Muvaffaqiyatli Yakunlandi!
                </h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                  Siz ushbu zaif mavzu bo&apos;yicha 10 ta diagnostik savolni tahlil qilib chiqdingiz va mustahkamlab oldingiz.
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-400">To&apos;g&apos;ri</p>
                  <p className="mt-1 text-2xl font-black text-emerald-400">{correctCount}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Aniqlik</p>
                  <p className="mt-1 text-2xl font-black text-teal-400">
                    {Math.round((correctCount / totalQuestions) * 100)}%
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Mukofot</p>
                  <p className="mt-1 text-2xl font-black text-amber-400">+50 XP</p>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-center gap-3">
                <Button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl bg-emerald-500 px-6 font-bold text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20"
                >
                  Zaif Nuqtalar Xaritasiga Qaytish
                </Button>
              </div>
            </div>
          ) : currentQ ? (
            /* Active Question View */
            <div className="space-y-5">
              {/* Context Callout if present */}
              {currentQ.context && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-300">
                  <span className="font-semibold text-emerald-400 uppercase tracking-wide text-[10px] block mb-1">
                    Kontekst Matni:
                  </span>
                  {currentQ.context}
                </div>
              )}

              {/* Prompt */}
              <div>
                <h4 className="text-sm sm:text-base font-bold text-slate-100 leading-snug">
                  {currentQ.prompt}
                </h4>
              </div>

              {/* Options */}
              <div className="space-y-2.5 pt-1">
                {currentQ.options.map((opt, oIdx) => {
                  const isSelected = selectedAnswer === opt;
                  const isCorrectAnswer =
                    opt.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase() ||
                    (currentQ.correctAnswer.length > 2 &&
                      opt.trim().toLowerCase().startsWith(currentQ.correctAnswer.trim().toLowerCase().slice(0, 2)));

                  let optClasses =
                    "relative flex w-full items-center justify-between rounded-xl border p-3.5 text-left text-xs sm:text-sm transition-all ";

                  if (isChecked) {
                    if (isCorrectAnswer) {
                      optClasses += "border-emerald-500/80 bg-emerald-500/20 text-emerald-300 font-bold";
                    } else if (isSelected && !isCorrectAnswer) {
                      optClasses += "border-rose-500/80 bg-rose-500/20 text-rose-300 line-through";
                    } else {
                      optClasses += "border-slate-800 bg-slate-900/30 text-slate-500 opacity-60";
                    }
                  } else {
                    if (isSelected) {
                      optClasses +=
                        "border-emerald-500 bg-emerald-500/15 text-emerald-300 font-semibold shadow-xs ring-1 ring-emerald-500/30";
                    } else {
                      optClasses += "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60";
                    }
                  }

                  return (
                    <button
                      key={oIdx}
                      type="button"
                      disabled={isChecked}
                      onClick={() => handleSelectOption(opt)}
                      className={optClasses}
                    >
                      <span className="pr-3">{opt}</span>
                      {isChecked && isCorrectAnswer && (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                      )}
                      {isChecked && isSelected && !isCorrectAnswer && (
                        <XCircle className="size-4 shrink-0 text-rose-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Explanation Callout after checking */}
              {isChecked && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-xs leading-relaxed text-slate-200 animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-400 mb-1">
                    <Sparkles className="size-3.5" />
                    <span>Tushuntirish & Ekspert Tahlili:</span>
                  </div>
                  <p className="text-slate-300">{currentQ.explanation}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
                {!isChecked ? (
                  <Button
                    type="button"
                    disabled={!selectedAnswer}
                    onClick={handleCheckAnswer}
                    className="rounded-xl bg-emerald-500 px-6 font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
                  >
                    Tekshirish
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="rounded-xl bg-emerald-500 px-6 font-bold text-slate-950 hover:bg-emerald-400 flex items-center gap-1.5"
                  >
                    <span>{currentIndex < totalQuestions - 1 ? "Keyingi Savol" : "Natijani Ko'rish"}</span>
                    <ChevronRight className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400">
              <p>Savollar topilmadi.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
