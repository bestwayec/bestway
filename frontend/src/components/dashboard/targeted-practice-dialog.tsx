"use client";

import * as React from "react";
import {
  AlertCircle,
  Award,
  CheckCircle2,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";
import { useTargetedPractice } from "@/hooks/use-mock";
import { cn } from "@/lib/utils";

interface TargetedPracticeDialogProps {
  categoryId: string | null;
  categoryName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function TargetedPracticeDialog({
  categoryId,
  categoryName,
  open,
  onOpenChange,
  onComplete,
}: TargetedPracticeDialogProps) {
  const { data: practice, isLoading, refetch } = useTargetedPractice(categoryId ?? undefined, open);

  const [currentIndex, setCurrentIndex] = React.useState<number>(0);
  const [selectedAnswer, setSelectedAnswer] = React.useState<string | null>(null);
  const [isAnswerChecked, setIsAnswerChecked] = React.useState<boolean>(false);
  const [score, setScore] = React.useState<number>(0);
  const [isFinished, setIsFinished] = React.useState<boolean>(false);

  // Reset state when modal opens with new category
  React.useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setSelectedAnswer(null);
      setIsAnswerChecked(false);
      setScore(0);
      setIsFinished(false);
    }
  }, [open, categoryId]);

  const questions = practice?.questions ?? [];
  const currentQ = questions[currentIndex];
  const totalQuestions = questions.length;

  const handleSelectOption = (opt: string) => {
    if (isAnswerChecked) return;
    setSelectedAnswer(opt);
  };

  const handleCheckAnswer = () => {
    if (!selectedAnswer || !currentQ) return;
    const isCorrect = selectedAnswer.trim().toUpperCase() === currentQ.correctAnswer.trim().toUpperCase();
    if (isCorrect) {
      setScore((prev) => prev + 1);
    }
    setIsAnswerChecked(true);
  };

  const handleNext = () => {
    if (currentIndex + 1 < totalQuestions) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setIsAnswerChecked(false);
    } else {
      setIsFinished(true);
      toast.success("Bo'shliqlarni yopish mashqi yakunlandi!", {
        description: `Natijangiz: ${score + (selectedAnswer?.trim().toUpperCase() === currentQ?.correctAnswer.trim().toUpperCase() && !isAnswerChecked ? 1 : 0)} / ${totalQuestions} to'g'ri.`,
      });
      if (onComplete) onComplete();
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setIsAnswerChecked(false);
    setScore(0);
    setIsFinished(false);
    refetch();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-emerald-500/30 bg-[#0B0F17] text-slate-100 p-0 overflow-hidden">
        <DialogHeader className="p-5 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="text-base font-bold flex items-center gap-2 text-white">
                <Target className="size-4 text-emerald-400" />
                Targeted Practice: {categoryName ?? practice?.categoryName ?? "Mini-mashq"}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Aynan zaif nuqtalaringiz bo&apos;yicha 10 ta tasodifiy savoldan iborat mustahkamlash mashqi
              </DialogDescription>
            </div>
            {!isFinished && totalQuestions > 0 && (
              <Badge variant="neutral" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs px-2.5 py-1 font-mono">
                {currentIndex + 1} / {totalQuestions}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-6 w-3/4 bg-slate-800" />
              <Skeleton className="h-20 w-full bg-slate-800/60 rounded-xl" />
              <div className="grid gap-2">
                <Skeleton className="h-10 w-full bg-slate-800/40" />
                <Skeleton className="h-10 w-full bg-slate-800/40" />
                <Skeleton className="h-10 w-full bg-slate-800/40" />
              </div>
            </div>
          ) : isFinished ? (
            /* Yakuniy Natija Kartasi */
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40">
                <Award className="size-8 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white">Mashq Muvaffaqiyatli Yakunlandi!</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Siz ushbu zaif nuqta bo&apos;yicha 10 ta savolni tahlil qilib chiqdingiz.
                </p>
              </div>

              <div className="mx-auto max-w-xs rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-3xl font-black text-emerald-400 font-mono">
                  {score} / {totalQuestions}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Aniqlik darajasi: {Math.round((score / Math.max(1, totalQuestions)) * 100)}%
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={handleRestart}
                  className="border-slate-700 bg-slate-900 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <RotateCcw className="mr-1.5 size-3.5" />
                  Qayta topshirish
                </Button>
                <Button
                  onClick={() => onOpenChange(false)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-5"
                >
                  Tushunarli, yopish
                </Button>
              </div>
            </div>
          ) : currentQ ? (
            /* Savol Tanasi va Variantlar */
            <div className="space-y-4">
              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
                />
              </div>

              {/* Matn / Kontekst (agar mavjud bo'lsa) */}
              {currentQ.context && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 text-xs text-slate-300 leading-relaxed font-serif">
                  <div className="text-[10px] font-sans font-bold text-emerald-400 mb-1 flex items-center gap-1">
                    <Sparkles className="size-3" />
                    Kontekstual matn parchasi:
                  </div>
                  {currentQ.context}
                </div>
              )}

              {/* Savol Matni */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
                <div className="text-xs text-slate-400 mb-1 font-mono">Savol {currentIndex + 1}:</div>
                <p className="text-sm font-semibold text-white leading-snug">{currentQ.question}</p>
              </div>

              {/* Variantlar */}
              <div className="space-y-2">
                {currentQ.options?.map((opt, idx) => {
                  const isSelected = selectedAnswer === opt;
                  const isCorrectAnswer = opt.trim().toUpperCase() === currentQ.correctAnswer.trim().toUpperCase();

                  let optClass = "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900";
                  if (isSelected && !isAnswerChecked) {
                    optClass = "border-emerald-500 bg-emerald-950/30 text-white shadow-sm";
                  } else if (isAnswerChecked) {
                    if (isCorrectAnswer) {
                      optClass = "border-emerald-500 bg-emerald-950/40 text-emerald-200 font-medium";
                    } else if (isSelected && !isCorrectAnswer) {
                      optClass = "border-rose-500 bg-rose-950/40 text-rose-200";
                    } else {
                      optClass = "border-slate-850 bg-slate-900/20 text-slate-500";
                    }
                  }

                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={isAnswerChecked}
                      onClick={() => handleSelectOption(opt)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left text-xs transition-all flex items-center justify-between",
                        optClass
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-[10px] font-bold">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span>{opt}</span>
                      </div>
                      {isAnswerChecked && isCorrectAnswer && (
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                      )}
                      {isAnswerChecked && isSelected && !isCorrectAnswer && (
                        <XCircle className="size-4 text-rose-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tekshirishdan keyin chiqadigan tushuntirish */}
              {isAnswerChecked && (
                <div
                  className={cn(
                    "rounded-xl border p-3.5 text-xs space-y-1 transition-all",
                    selectedAnswer?.trim().toUpperCase() === currentQ.correctAnswer.trim().toUpperCase()
                      ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
                      : "border-rose-500/40 bg-rose-950/30 text-rose-200"
                  )}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {selectedAnswer?.trim().toUpperCase() === currentQ.correctAnswer.trim().toUpperCase() ? (
                      <>
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                        To&apos;g&apos;ri javob!
                      </>
                    ) : (
                      <>
                        <AlertCircle className="size-3.5 text-rose-400" />
                        Xato! To&apos;g&apos;ri javob: <span className="underline font-bold">{currentQ.correctAnswer}</span>
                      </>
                    )}
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed pt-1">
                    <span className="font-semibold text-slate-200">Tushuntirish:</span> {currentQ.explanation}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Ushbu toifa uchun mashq savollari topilmadi.
            </div>
          )}
        </div>

        {!isFinished && currentQ && (
          <DialogFooter className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Bekor qilish
            </Button>

            <div className="flex items-center gap-2">
              {!isAnswerChecked ? (
                <Button
                  size="sm"
                  disabled={!selectedAnswer}
                  onClick={handleCheckAnswer}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4"
                >
                  Javobni tekshirish
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 flex items-center gap-1"
                >
                  {currentIndex + 1 < totalQuestions ? "Keyingi savol" : "Natijani ko'rish"}
                  <ChevronRight className="size-3.5" />
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
