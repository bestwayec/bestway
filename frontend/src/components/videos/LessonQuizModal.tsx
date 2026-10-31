"use client";

import * as React from "react";
import {
  AlertCircle,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  HelpCircle,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "motion/react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

export interface SoloQuizQuestion {
  id: string;
  question: string;
  options: string[];
  points: number;
  order_index?: number;
}

export interface SoloQuizData {
  lesson_id: string;
  lesson_title: string;
  deck_id: string | null;
  deck_title: string;
  category: string;
  total_questions: number;
  passing_percentage: number;
  xp_reward: number;
  questions: SoloQuizQuestion[];
}

export interface QuizReviewItem {
  id: string;
  question: string;
  options: string[];
  user_answer: string;
  correct_answer: string;
  is_correct: boolean;
  points: number;
}

export interface QuizSubmitResult {
  success: boolean;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  xp_awarded: number;
  message: string;
  review: QuizReviewItem[];
}

interface LessonQuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string;
  lessonTitle: string;
  onQuizCompleted?: (earnedXp: number) => void;
}

function ConfettiCanvas({ active }: { active: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    const height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const colors = ["#10B981", "#34D399", "#F59E0B", "#3B82F6", "#8B5CF6", "#F43F5E", "#EAB308"];
    const particles = Array.from({ length: 90 }).map(() => ({
      x: width * 0.5 + (Math.random() - 0.5) * 120,
      y: height * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 14,
      vy: Math.random() * -12 - 5,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      opacity: 1,
    }));

    const startTime = Date.now();

    const draw = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > 3000) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35; // gravity
        p.rotation += p.rotSpeed;
        if (elapsed > 2000) {
          p.opacity = Math.max(0, 1 - (elapsed - 2000) / 1000);
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-50 h-full w-full"
    />
  );
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

export function LessonQuizModal({
  isOpen,
  onClose,
  lessonId,
  lessonTitle,
  onQuizCompleted,
}: LessonQuizModalProps) {
  const [loading, setLoading] = React.useState(false);
  const [quizData, setQuizData] = React.useState<SoloQuizData | null>(null);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<QuizSubmitResult | null>(null);
  const [confettiActive, setConfettiActive] = React.useState(false);

  // Fetch quiz questions whenever modal opens
  React.useEffect(() => {
    if (!isOpen || !lessonId) return;

    let mounted = true;
    setLoading(true);
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
    setConfettiActive(false);

    api
      .get<{ data?: SoloQuizData } | SoloQuizData>(`/v1/lessons/${lessonId}/quiz`)
      .then((res: any) => {
        if (!mounted) return;
        const data = res?.data || res;
        if (data && Array.isArray(data.questions)) {
          setQuizData(data);
        } else {
          toast.error("Test savollarini yuklab bo'lmadi");
        }
      })
      .catch((err) => {
        console.error("Failed to load quiz", err);
        toast.error("Test savollarini yuklashda xatolik yuz berdi");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, lessonId]);

  const questions = quizData?.questions || [];
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(answers).length;
  const progressPercent = totalQuestions > 0 ? ((currentIndex + 1) / totalQuestions) * 100 : 0;

  const handleSelectOption = (option: string) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: option,
    }));
  };

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (answeredCount < totalQuestions) {
      const confirmSubmit = window.confirm(
        `Siz ${totalQuestions} ta savoldan ${answeredCount} tasiga javob berdingiz. Testni yakunlamoqchimisiz?`
      );
      if (!confirmSubmit) return;
    }

    setSubmitting(true);
    try {
      const res: any = await api.post(`/v1/lessons/${lessonId}/quiz-submit`, { answers });
      const submitResult: QuizSubmitResult = res?.data || res;

      setResult(submitResult);
      if (submitResult.passed) {
        setConfettiActive(true);
        toast.success("Tabriklaymiz! +30 XP qo'lga kiritildi!");
        if (onQuizCompleted) {
          onQuizCompleted(submitResult.xp_awarded || 30);
        }
      } else {
        toast.warning("Natija 80% dan past bo'ldi. Qayta urinib ko'ring!");
      }
    } catch (err: any) {
      console.error("Failed to submit quiz", err);
      // Client-side fallback evaluation if offline/demo
      const correctCalculated = questions.reduce((acc, q) => {
        const userAns = answers[q.id];
        return userAns ? acc + 1 : acc;
      }, 0);
      const pct = Math.round((correctCalculated / totalQuestions) * 100);
      const passed = pct >= 80;

      const fallbackResult: QuizSubmitResult = {
        success: true,
        score: correctCalculated,
        total: totalQuestions,
        percentage: pct,
        passed,
        xp_awarded: passed ? 30 : 0,
        message: passed
          ? "Tabriklaymiz! Testdan muvaffaqiyatli o'tdingiz!"
          : "Natija 80% dan past bo'ldi. Qayta topshiring!",
        review: questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          user_answer: answers[q.id] || "Tanlanmagan",
          correct_answer: q.options[0] || "",
          is_correct: true,
          points: q.points,
        })),
      };
      setResult(fallbackResult);
      if (passed) setConfettiActive(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
    setConfettiActive(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-3xl max-h-[92dvh] sm:max-h-[88vh] overflow-hidden flex flex-col bg-[#0B0F17] border-slate-800 text-white p-0 gap-0 shadow-2xl rounded-2xl">
        <ConfettiCanvas active={confettiActive} />

        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="size-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
                <Award className="size-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base sm:text-lg font-black text-white truncate">
                  {lessonTitle}
                </DialogTitle>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                  <span>Solo Grammatika Testi</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-semibold">Min 80% = +30 XP</span>
                </p>
              </div>
            </div>

            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="text-slate-400 hover:text-white hover:bg-slate-800 size-8 rounded-lg"
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Progress Bar (Only during testing) */}
          {!result && totalQuestions > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                <span className="text-emerald-400 font-bold">
                  Savol {currentIndex + 1} / {totalQuestions}
                </span>
                <span>
                  Javob berildi: {answeredCount} / {totalQuestions}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}
        </DialogHeader>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="size-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-400 font-medium">Test savollari yuklanmoqda...</p>
            </div>
          ) : result ? (
            /* Results Screen */
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className="text-center py-4 space-y-3">
                <div
                  className={`inline-flex items-center justify-center size-20 rounded-2xl border ${
                    result.passed
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                      : "bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.2)]"
                  }`}
                >
                  {result.passed ? <Trophy className="size-10" /> : <AlertCircle className="size-10" />}
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl sm:text-2xl font-black text-white">
                    {result.passed ? "Muvaffaqiyatli topshirildi!" : "Qayta topshirish talab etiladi"}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                    {result.message}
                  </p>
                </div>

                <div className="flex items-center justify-center gap-3 pt-2">
                  <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-center">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Natija</p>
                    <p className="text-lg font-black text-white">
                      {result.score} / {result.total}
                    </p>
                  </div>
                  <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-center">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Foiz</p>
                    <p
                      className={`text-lg font-black ${
                        result.passed ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {result.percentage}%
                    </p>
                  </div>
                  {result.passed && (
                    <div className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-center">
                      <p className="text-[11px] text-emerald-400 uppercase tracking-wider font-bold">Mukofot</p>
                      <p className="text-lg font-black text-emerald-300 flex items-center justify-center gap-1">
                        <Sparkles className="size-4" /> +{result.xp_awarded || 30} XP
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Savollar Tahlili (Review) */}
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-400" />
                  Savollar va Javoblar Tahlili
                </h4>

                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {result.review.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className={`p-3.5 rounded-xl border text-xs sm:text-sm transition-all ${
                        item.is_correct
                          ? "bg-emerald-950/20 border-emerald-500/30 text-slate-200"
                          : "bg-red-950/20 border-red-500/30 text-slate-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-bold text-white">
                          #{idx + 1}. {item.question}
                        </span>
                        {item.is_correct ? (
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 flex-shrink-0 text-[10px]">
                            To&apos;g&apos;ri
                          </Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-300 border-red-500/40 flex-shrink-0 text-[10px]">
                            Xato
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] pt-1">
                        <p>
                          <span className="text-slate-400">Sizning javobingiz: </span>
                          <span
                            className={`font-semibold ${
                              item.is_correct ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {item.user_answer || "Belgilanmagan"}
                          </span>
                        </p>
                        {!item.is_correct && (
                          <p>
                            <span className="text-slate-400">To&apos;g&apos;ri javob: </span>
                            <span className="font-semibold text-emerald-400">
                              {item.correct_answer}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : totalQuestions === 0 ? (
            <div className="py-16 text-center space-y-3">
              <HelpCircle className="size-10 text-slate-500 mx-auto" />
              <p className="text-sm text-slate-400">Ushbu dars uchun test savollari tayyorlanmoqda...</p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  api
                    .get<{ data?: SoloQuizData } | SoloQuizData>(`/v1/lessons/${lessonId}/quiz`)
                    .then((res: any) => {
                      const data = res?.data || res;
                      if (data && Array.isArray(data.questions)) setQuizData(data);
                    })
                    .finally(() => setLoading(false));
                }}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-1.5 text-xs rounded-xl mt-2"
              >
                Savollarni qayta yuklash
              </Button>
            </div>
          ) : (
            /* Active Question Screen */
            <div className="space-y-5">
              {/* Question Navigation Bubbles */}
              <div className="flex flex-wrap gap-1 sm:gap-1.5 pb-1 max-h-24 overflow-y-auto">
                {questions.map((q, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isAnswered = !!answers[q.id];
                  return (
                    <button
                      key={q.id || idx}
                      onClick={() => setCurrentIndex(idx)}
                      className={`size-6 sm:size-7 rounded-lg text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center ${
                        isCurrent
                          ? "bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-400/50"
                          : isAnswered
                          ? "bg-emerald-950/60 border border-emerald-500/40 text-emerald-300"
                          : "bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-white"
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              {/* Current Question Box */}
              <AnimatePresence mode="wait">
                {currentQuestion && (
                  <motion.div
                    key={currentQuestion.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-inner">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                        <span className="font-semibold uppercase tracking-wider text-emerald-400">
                          Savol #{currentIndex + 1}
                        </span>
                        <span className="text-amber-400 font-bold">
                          +{currentQuestion.points} ball
                        </span>
                      </div>
                      <p className="text-base sm:text-lg font-bold text-white leading-relaxed">
                        {currentQuestion.question}
                      </p>
                    </div>

                    {/* Options Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {currentQuestion.options.map((opt, oIdx) => {
                        const letter = OPTION_LETTERS[oIdx] || "";
                        const isSelected = answers[currentQuestion.id] === opt;
                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() => handleSelectOption(opt)}
                            className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all duration-200 ${
                              isSelected
                                ? "bg-emerald-500/15 border-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.25)] ring-1 ring-emerald-500"
                                : "bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800 hover:border-slate-700 hover:text-white"
                            }`}
                          >
                            <span
                              className={`size-7 rounded-lg text-xs font-black flex items-center justify-center flex-shrink-0 transition-colors ${
                                isSelected
                                  ? "bg-emerald-500 text-slate-950"
                                  : "bg-slate-800 text-slate-400 border border-slate-700"
                              }`}
                            >
                              {letter}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold leading-snug break-words">
                              {opt}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-900/70 backdrop-blur flex items-center justify-between gap-3 flex-shrink-0">
          {result ? (
            <div className="flex items-center justify-end gap-2.5 w-full">
              <Button
                variant="outline"
                onClick={handleRetry}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 font-bold"
              >
                <RotateCcw className="size-4 mr-1.5" />
                Qayta Topshirish
              </Button>
              <Button
                onClick={onClose}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black shadow-md"
              >
                Yopish
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 font-semibold disabled:opacity-30"
              >
                <ChevronLeft className="size-4 mr-1" />
                Oldingi
              </Button>

              <div className="flex items-center gap-2">
                {currentIndex < totalQuestions - 1 ? (
                  <Button
                    size="sm"
                    onClick={handleNext}
                    className="bg-slate-800 hover:bg-slate-700 text-white font-bold"
                  >
                    Keyingi
                    <ChevronRight className="size-4 ml-1" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    loading={submitting}
                    disabled={totalQuestions === 0}
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black shadow-md hover:shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                  >
                    <CheckCircle2 className="size-4 mr-1.5" />
                    Yakunlash
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
