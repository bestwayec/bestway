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
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface PracticeQuestion {
  id: string;
  questionNumber: number;
  context?: string;
  prompt: string;
  options: string[];
}

/** What the server reveals for one question, only after it has been answered. */
interface AnswerCheck {
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
}

interface DrillResult {
  correctCount: number;
  totalQuestions: number;
  pointsAwarded: number;
  dailyCapReached?: boolean;
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
  // The key and explanation of the current question, as the server returned them after the answer.
  const [check, setCheck] = React.useState<AnswerCheck | null>(null);
  const [checking, setChecking] = React.useState(false);
  const isChecked = check !== null;
  // Final figures come from the server's own record of the drill.
  const [result, setResult] = React.useState<DrillResult | null>(null);
  const [isFinished, setIsFinished] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  // Points shown only as the server reports them (null until it answers; never a fixed promise).
  const pointsAwarded = result?.pointsAwarded ?? null;
  const t = useTranslations("drill");

  // Fetch drill questions when modal opens
  React.useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setCheck(null);
    setResult(null);
    setData(null);
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

  const handleCheckAnswer = async () => {
    if (!selectedAnswer || !currentQ || !data || checking) return;
    setChecking(true);
    try {
      const res = await apiClient.post<AnswerCheck>("/api/v1/study-plan/targeted-practice/answer", {
        practiceId: data.practiceId,
        questionId: currentQ.id,
        selectedAnswer,
      });
      setCheck({ isCorrect: !!res.isCorrect, correctAnswer: res.correctAnswer, explanation: res.explanation });
      if (res.isCorrect) {
        toast.success("To'g'ri javob! Barakalla!", { duration: 1500 });
      } else {
        toast.error("Noto'g'ri. Tushuntirishga e'tibor bering.", { duration: 2000 });
      }
    } catch (err) {
      console.error("Failed to check drill answer:", err);
      toast.error(t("checkFailed"));
    } finally {
      setChecking(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setCheck(null);
    } else {
      void finishDrill();
    }
  };

  const finishDrill = async () => {
    if (!data) return;
    setIsFinished(true);
    setSubmitting(true);
    try {
      const res = await apiClient.post<DrillResult>("/api/v1/study-plan/targeted-practice/submit", {
        practiceId: data.practiceId,
      });
      const awarded = typeof res?.pointsAwarded === "number" ? res.pointsAwarded : 0;
      setResult({ correctCount: res.correctCount, totalQuestions: res.totalQuestions, pointsAwarded: awarded, dailyCapReached: !!res.dailyCapReached });
      if (awarded > 0) toast.success(`⚡️ +${awarded} XP hisobingizga qo'shildi!`);
      onCompleted?.({ correctCount: res.correctCount, pointsAwarded: awarded });
    } catch (err) {
      console.error("Failed to submit drill:", err);
      toast.error(t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const totalQuestions = questions.length || 10;
  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl overflow-hidden border border-brand/30 bg-bg-subtle p-0 text-fg shadow-2xl backdrop-blur-xl sm:rounded-2xl">
        {/* Header Bar */}
        <div className="relative border-b border-border bg-surface/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-10 place-items-center rounded-xl border border-brand/40 bg-brand/20 text-brand-subtle-fg shadow-xs">
                <Zap className="size-5 fill-brand" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-fg sm:text-lg">
                  {moduleTitle}
                </DialogTitle>
                <p className="text-xs text-fg-muted flex items-center gap-1.5 mt-0.5">
                  <span className="font-semibold text-brand">Target Drill</span>
                  <span>·</span>
                  {questions.length > 0 && <span>{questions.length} ta chuqurlashtirilgan mashq topshirig&apos;i</span>}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg transition"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Progress Indicator */}
          {!loading && !isFinished && questions.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span className="font-medium">
                  Savol: <strong className="text-brand">{currentIndex + 1}</strong> / {totalQuestions}
                </span>
                <span className="text-brand font-mono font-bold">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-brand transition-all duration-300"
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
              <Skeleton className="h-6 w-3/4 bg-surface-hover" />
              <Skeleton className="h-24 w-full bg-surface-hover" />
              <div className="space-y-2 pt-2">
                <Skeleton className="h-12 w-full bg-surface-hover" />
                <Skeleton className="h-12 w-full bg-surface-hover" />
                <Skeleton className="h-12 w-full bg-surface-hover" />
              </div>
            </div>
          ) : isFinished ? (
            /* Finished Summary View */
            <div className="py-6 text-center space-y-5">
              <div className="mx-auto grid size-20 place-items-center rounded-2xl border border-brand/40 bg-brand/20 text-brand-subtle-fg shadow-lg shadow-brand/10">
                <Award className="size-10" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-xl font-black text-fg">
                  Mashq Muvaffaqiyatli Yakunlandi!
                </h3>
                <p className="text-sm text-fg-muted max-w-md mx-auto">
                  Siz ushbu zaif mavzu bo&apos;yicha 10 ta diagnostik savolni tahlil qilib chiqdingiz va mustahkamlab oldingiz.
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2">
                <div className="rounded-xl border border-border bg-surface/60 p-3">
                  <p className="text-[11px] font-semibold uppercase text-fg-muted">To&apos;g&apos;ri</p>
                  <p className="mt-1 text-2xl font-black text-brand">{result ? result.correctCount : "—"}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface/60 p-3">
                  <p className="text-[11px] font-semibold uppercase text-fg-muted">Aniqlik</p>
                  <p className="mt-1 text-2xl font-black text-brand">
                    {result && result.totalQuestions > 0 ? `${Math.round((result.correctCount / result.totalQuestions) * 100)}%` : "—"}
                  </p>
                </div>
                {pointsAwarded != null && pointsAwarded > 0 && (
                  <div className="rounded-xl border border-border bg-surface/60 p-3">
                    <p className="text-[11px] font-semibold uppercase text-fg-muted">Mukofot</p>
                    <p className="mt-1 text-2xl font-black text-warning">+{pointsAwarded} XP</p>
                  </div>
                )}
              </div>

              {result?.dailyCapReached && (
                <p className="text-xs text-fg-muted max-w-md mx-auto" data-testid="drill-daily-cap">{t("dailyCapReached")}</p>
              )}

              <div className="pt-4 flex items-center justify-center gap-3">
                <Button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl bg-brand px-6 font-bold text-brand-fg hover:bg-brand-hover shadow-md shadow-brand/20"
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
                <div className="rounded-xl border border-border bg-surface/60 p-4 text-xs leading-relaxed text-fg-muted">
                  <span className="font-semibold text-brand uppercase tracking-wide text-[10px] block mb-1">
                    Kontekst Matni:
                  </span>
                  {currentQ.context}
                </div>
              )}

              {/* Prompt */}
              <div>
                <h4 className="text-sm sm:text-base font-bold text-fg leading-snug">
                  {currentQ.prompt}
                </h4>
              </div>

              {/* Options */}
              <div className="space-y-2.5 pt-1">
                {currentQ.options.map((opt, oIdx) => {
                  const isSelected = selectedAnswer === opt;
                  const isCorrectAnswer = check !== null && opt === check.correctAnswer;

                  let optClasses =
                    "relative flex w-full items-center justify-between rounded-xl border p-3.5 text-left text-xs sm:text-sm transition-all ";

                  if (isChecked) {
                    if (isCorrectAnswer) {
                      optClasses += "border-brand/80 bg-brand/20 text-brand-subtle-fg font-bold";
                    } else if (isSelected && !isCorrectAnswer) {
                      optClasses += "border-danger/80 bg-danger/20 text-danger line-through";
                    } else {
                      optClasses += "border-border bg-surface/30 text-fg-subtle opacity-60";
                    }
                  } else {
                    if (isSelected) {
                      optClasses +=
                        "border-brand bg-brand/15 text-brand-subtle-fg font-semibold shadow-xs ring-1 ring-brand/30";
                    } else {
                      optClasses += "border-border bg-surface/60 text-fg-muted hover:border-border-strong hover:bg-surface-hover/60";
                    }
                  }

                  return (
                    <button
                      key={oIdx}
                      type="button"
                      disabled={isChecked || checking}
                      onClick={() => handleSelectOption(opt)}
                      className={optClasses}
                    >
                      <span className="pr-3">{opt}</span>
                      {isChecked && isCorrectAnswer && (
                        <CheckCircle2 className="size-4 shrink-0 text-brand" />
                      )}
                      {isChecked && isSelected && !isCorrectAnswer && (
                        <XCircle className="size-4 shrink-0 text-danger" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Explanation Callout after checking */}
              {check && (
                <div className="rounded-xl border border-brand/30 bg-brand-subtle/20 p-4 text-xs leading-relaxed text-fg animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5 font-bold text-brand mb-1">
                    <Sparkles className="size-3.5" />
                    <span>Tushuntirish & Ekspert Tahlili:</span>
                  </div>
                  <p className="text-fg-muted">{check.explanation}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/80">
                {!isChecked ? (
                  <Button
                    type="button"
                    disabled={!selectedAnswer || checking}
                    onClick={() => void handleCheckAnswer()}
                    className="rounded-xl bg-brand px-6 font-bold text-brand-fg hover:bg-brand-hover disabled:opacity-40"
                  >
                    Tekshirish
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="rounded-xl bg-brand px-6 font-bold text-brand-fg hover:bg-brand-hover flex items-center gap-1.5"
                  >
                    <span>{currentIndex < totalQuestions - 1 ? "Keyingi Savol" : "Natijani Ko'rish"}</span>
                    <ChevronRight className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-fg-muted">
              <p>Savollar topilmadi.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
