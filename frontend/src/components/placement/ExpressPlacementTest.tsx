"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  GraduationCap,
  HelpCircle,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/navigation";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { cn } from "@/lib/utils";

export interface PlacementOption {
  key: string;
  text: string;
}

export interface PlacementQuestion {
  id: string;
  number: number;
  level: string;
  skill: string;
  topic: string;
  prompt: string;
  options: PlacementOption[];
}

export interface WeakTopic {
  topic: string;
  mistakes_count: number;
  lesson_title: string;
  lesson_order: number | null;
  lesson_id: string | null;
  recommendation: string;
}

export interface PlacementResultData {
  result_token: string;
  guest_session_id: string;
  score: number;
  total_questions: number;
  score_percent: number;
  cefr_level: string;
  cefr_label: string;
  estimated_ielts_band: string;
  national_score_estimate: string;
  weak_topics: WeakTopic[];
  analysis: string;
  is_claimed: boolean;
  created_at?: string;
}

export const LOCAL_STORAGE_PLACEMENT_KEY = "bestway_placement_result_token";

interface ExpressPlacementTestProps {
  className?: string;
  autoStart?: boolean;
  isAuthenticated?: boolean;
}

export function ExpressPlacementTest({
  className = "",
  autoStart = false,
  isAuthenticated = false,
}: ExpressPlacementTestProps) {
  const locale = useLocale();
  const router = useRouter();

  const [status, setStatus] = React.useState<"idle" | "loading" | "running" | "submitting" | "result" | "error">(
    autoStart ? "loading" : "idle",
  );
  const [questions, setQuestions] = React.useState<PlacementQuestion[]>([]);
  const [guestSessionId, setGuestSessionId] = React.useState<string>("");
  const [currentIndex, setCurrentIndex] = React.useState<number>(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = React.useState<number>(600); // 10 minutes in seconds
  const [result, setResult] = React.useState<PlacementResultData | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isClaiming, setIsClaiming] = React.useState<boolean>(false);
  const [hasClaimed, setHasClaimed] = React.useState<boolean>(isAuthenticated);

  // Load questions from API
  const startTest = React.useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/backend/placement-test/questions", {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || "Savollarni yuklab bo'lmadi");
      }
      setQuestions(json.data.questions || []);
      setGuestSessionId(json.data.guest_session_id || "");
      setCurrentIndex(0);
      setAnswers({});
      setTimeLeft(600);
      setStatus("running");
    } catch (err: any) {
      setErrorMessage(err?.message || "Aloqa xatoligi. Qaytadan urinib ko'ring.");
      setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    if (autoStart && status === "loading" && questions.length === 0) {
      startTest();
    }
  }, [autoStart, startTest, status, questions.length]);

  // Claim placement result to authenticated user account
  const claimPlacementResult = React.useCallback(async (token?: string) => {
    const targetToken = token || result?.result_token;
    if (!targetToken) return;

    setIsClaiming(true);
    try {
      const res = await fetch("/api/backend/placement-test/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result_token: targetToken }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setHasClaimed(true);
        if (typeof window !== "undefined") {
          localStorage.removeItem(LOCAL_STORAGE_PLACEMENT_KEY);
        }
        toast.success("🎉 Natijangiz shaxsiy profilingizga muvaffaqiyatli bog'landi!");
      }
    } catch {
      // Background claim can be retried on dashboard
    } finally {
      setIsClaiming(false);
    }
  }, [result?.result_token]);

  // Submit test answers
  const handleSubmitTest = React.useCallback(async () => {
    if (status === "submitting" || status === "result") return;
    setStatus("submitting");

    try {
      const res = await fetch("/api/backend/placement-test/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          guest_session_id: guestSessionId,
          answers,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error || "Natijani hisoblab bo'lmadi");
      }

      const resData: PlacementResultData = json.data;
      setResult(resData);
      setStatus("result");

      // Save token in localStorage for state migration
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(LOCAL_STORAGE_PLACEMENT_KEY, resData.result_token);
        } catch {
          // Ignore quota errors
        }
      }

      // If already logged in, automatically claim in the background
      if (isAuthenticated) {
        claimPlacementResult(resData.result_token);
      }
    } catch (err: any) {
      toast.error(err?.message || "Xatolik yuz berdi");
      setStatus("running");
    }
  }, [answers, claimPlacementResult, guestSessionId, isAuthenticated, status]);

  // Sticky 10-Minute Countdown Timer
  React.useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleSubmitTest();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [status, handleSubmitTest]);

  // Format seconds into MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };



  const handleSelectOption = (questionId: string, optionKey: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: optionKey,
    }));
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleTelegramAuthRedirect = () => {
    if (result?.result_token && typeof window !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_PLACEMENT_KEY, result.result_token);
    }
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "xabar_bestway_bot";
    window.open(`https://t.me/${botUsername}?start=login`, "_blank", "noopener,noreferrer");
  };

  const handleGoogleSuccess = async () => {
    if (result?.result_token) {
      await claimPlacementResult(result.result_token);
    }
    router.push("/dashboard");
  };

  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const progressPercent = questions.length > 0 ? Math.round(((currentIndex + 1) / questions.length) * 100) : 0;
  const isTimeCritical = timeLeft <= 60;

  // 1. IDLE STATE — Launch Card
  if (status === "idle") {
    return (
      <div
        id="placement-test"
        className={cn(
          "relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-[#0B0F17] p-6 sm:p-10 shadow-2xl backdrop-blur-xl",
          className,
        )}
      >
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 size-96 rounded-full bg-teal-500/10 blur-3xl" />

        <div className="relative z-10 max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-4 py-1.5 text-xs font-semibold text-emerald-300 shadow-inner">
            <Sparkles className="size-3.5 animate-pulse text-emerald-400" />
            <span>AI Diagnostika & Express Placement</span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
            10 Daqiqalik Bepul <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">CEFR & IELTS</span> Placement Test
          </h2>

          <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto leading-relaxed">
            20 ta kalibratsiyalangan savol orqali grammatika, lug'at va reading darajangizni aniqlang.
            Test yakunida aniq CEFR darajangiz (A2-C1), taxminiy IELTS bali (4.0-8.0) hamda 3 ta zaif grammatik mavzuyingiz aniqlab beriladi.
          </p>

          <div className="grid grid-cols-3 gap-3 sm:gap-6 py-2 max-w-lg mx-auto">
            <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 p-3.5 text-center">
              <Clock className="size-5 mx-auto text-emerald-400 mb-1" />
              <div className="text-lg font-bold text-white">10 daqiqa</div>
              <div className="text-xs text-slate-400">Tezkor diagnostika</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 p-3.5 text-center">
              <Award className="size-5 mx-auto text-teal-400 mb-1" />
              <div className="text-lg font-bold text-white">20 ta savol</div>
              <div className="text-xs text-slate-400">A1 dan C1 gacha</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 p-3.5 text-center">
              <Zap className="size-5 mx-auto text-yellow-400 mb-1" />
              <div className="text-lg font-bold text-white">0 so'm</div>
              <div className="text-xs text-slate-400">Mutlaqo bepul</div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={startTest}
              className="inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-8 py-4 text-base sm:text-lg font-bold text-white shadow-xl shadow-emerald-950/60 transition-all duration-200 hover:from-emerald-400 hover:to-emerald-500 hover:scale-[1.02] active:scale-95"
            >
              <Zap className="size-5 fill-current" />
              <span>⚡️ Bepul Darajangizni Aniqlang (10 daqiqa)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. LOADING STATE
  if (status === "loading") {
    return (
      <div className={cn("rounded-3xl border border-slate-800 bg-[#0B0F17] p-12 text-center shadow-2xl", className)}>
        <Loader2 className="size-12 animate-spin text-emerald-400 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white">Diagnostik Savollar Yuklanmoqda...</h3>
        <p className="text-sm text-slate-400 mt-2">Sun’iy intellekt CEFR savollar bazasini kalibratsiya qilmoqda.</p>
      </div>
    );
  }

  // 3. ERROR STATE
  if (status === "error") {
    return (
      <div className={cn("rounded-3xl border border-red-900/60 bg-[#0B0F17] p-8 text-center shadow-2xl", className)}>
        <AlertCircle className="size-10 text-red-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-white">Xatolik yuz berdi</h3>
        <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">{errorMessage}</p>
        <button
          type="button"
          onClick={startTest}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition"
        >
          <RotateCcw className="size-4" />
          <span>Qaytadan urinish</span>
        </button>
      </div>
    );
  }

  // 4. SUBMITTING STATE
  if (status === "submitting") {
    return (
      <div className={cn("rounded-3xl border border-emerald-500/40 bg-[#0B0F17] p-12 text-center shadow-2xl", className)}>
        <div className="relative size-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
          <div className="relative size-20 rounded-full border-2 border-emerald-500 flex items-center justify-center bg-slate-900">
            <Sparkles className="size-10 text-emerald-400 animate-spin" />
          </div>
        </div>
        <h3 className="text-2xl font-bold text-white">Natijalar Tahlil Qilinmoqda...</h3>
        <p className="text-sm text-slate-300 mt-2 max-w-md mx-auto">
          Sun’iy intellekt sizning javoblaringizni tekshirmoqda, CEFR darajasi va zaif grammatik nuqtalaringizni shakllantirmoqda.
        </p>
      </div>
    );
  }

  // 5. TEST RUNNER VIEW
  if (status === "running" && currentQuestion) {
    const selectedKey = answers[currentQuestion.id];

    return (
      <div
        id="placement-test-runner"
        className={cn(
          "relative overflow-hidden rounded-3xl border border-slate-800 bg-[#0B0F17] p-4 sm:p-8 shadow-2xl",
          className,
        )}
      >
        {/* Sticky Header: Timer & Progress */}
        <div className="sticky top-2 z-20 mb-6 rounded-2xl border border-slate-800/80 bg-[#111827]/90 px-4 py-3 shadow-lg backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-400">
              <Zap className="size-3.5 fill-current" />
              Savol {currentIndex + 1} / {questions.length}
            </span>
            <span className="text-xs text-slate-400 hidden sm:inline">
              ({answeredCount} ta belgilandi)
            </span>
          </div>

          {/* Sticky Timer */}
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-sm font-bold tracking-wider tabular-nums transition-colors",
              isTimeCritical
                ? "bg-red-950/80 text-red-300 border border-red-500/50 animate-pulse"
                : "bg-slate-900 text-emerald-300 border border-slate-700",
            )}
          >
            <Clock className={cn("size-4", isTimeCritical ? "text-red-400" : "text-emerald-400")} />
            <span>{formatTime(timeLeft)}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-2 w-full rounded-full bg-slate-900 overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Question Card */}
        <div className="rounded-2xl border border-slate-800/90 bg-[#111827] p-5 sm:p-8 shadow-inner">
          <div className="flex items-center gap-2 mb-4">
            <span className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
              {currentQuestion.level}
            </span>
            <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-xs font-medium text-slate-300 uppercase tracking-wider">
              {currentQuestion.skill}
            </span>
            <span className="text-xs text-slate-400 hidden md:inline ml-auto">
              Mavzu: {currentQuestion.topic}
            </span>
          </div>

          <h3 className="text-lg sm:text-xl font-medium text-slate-100 leading-relaxed min-h-[3.5rem]">
            {currentQuestion.prompt}
          </h3>

          {/* Options Grid */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {currentQuestion.options.map((opt) => {
              const isSelected = selectedKey === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => handleSelectOption(currentQuestion.id, opt.key)}
                  className={cn(
                    "group flex items-center gap-3.5 rounded-xl border p-4 text-left transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500",
                    isSelected
                      ? "border-emerald-500 bg-emerald-950/40 text-white shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500"
                      : "border-slate-800 bg-[#0B0F17]/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors",
                      isSelected
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-800 text-slate-300 group-hover:bg-slate-700",
                    )}
                  >
                    {opt.key}
                  </span>
                  <span className="text-sm font-medium leading-snug">{opt.text}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Question Selector Matrix (Dots) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
          {questions.map((q, idx) => {
            const isAnswered = !!answers[q.id];
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Savol ${idx + 1}`}
                className={cn(
                  "size-7 rounded-lg text-xs font-semibold transition-all flex items-center justify-center",
                  isCurrent
                    ? "border-2 border-emerald-400 bg-emerald-500/20 text-white shadow"
                    : isAnswered
                      ? "bg-emerald-600/30 text-emerald-300 border border-emerald-600/40"
                      : "bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300",
                )}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        {/* Navigation & Submit Footer */}
        <div className="mt-8 flex items-center justify-between gap-3 pt-4 border-t border-slate-800/80">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition"
          >
            <ArrowLeft className="size-4" />
            <span>Oldingisi</span>
          </button>

          <div className="flex items-center gap-3">
            {currentIndex < questions.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white transition shadow"
              >
                <span>Keyingisi</span>
                <ArrowRight className="size-4" />
              </button>
            ) : null}

            {/* Finish Button — visible anytime after answering, or on last question */}
            {(currentIndex === questions.length - 1 || answeredCount >= 10) && (
              <button
                type="button"
                onClick={handleSubmitTest}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-950/60 hover:from-emerald-400 hover:to-emerald-500 active:scale-95 transition"
              >
                <Zap className="size-4 fill-current" />
                <span>Testni Yakunlash ({answeredCount}/{questions.length})</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 6. RESULTS & HIGH-CONVERTING FUNNEL
  if (status === "result" && result) {
    return (
      <div
        id="placement-test-results"
        className={cn(
          "relative overflow-hidden rounded-3xl border border-emerald-500/40 bg-[#0B0F17] p-6 sm:p-10 shadow-2xl backdrop-blur-xl space-y-8",
          className,
        )}
      >
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 size-96 rounded-full bg-emerald-500/15 blur-3xl" />

        {/* Hero Result Banner */}
        <div className="relative text-center space-y-4 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-4 py-1 text-xs font-bold text-emerald-300">
            <Award className="size-4 text-emerald-400" />
            <span>Rasmiy CEFR & IELTS Express Diagnostika</span>
          </div>

          <div className="flex flex-col items-center justify-center">
            <span className="text-6xl sm:text-7xl font-black bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500 bg-clip-text text-transparent drop-shadow-[0_0_35px_rgba(16,185,129,0.35)]">
              {result.cefr_level}
            </span>
            <span className="text-xl sm:text-2xl font-bold text-white mt-1">
              {result.cefr_label}
            </span>
          </div>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            {result.analysis}
          </p>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="rounded-2xl border border-slate-800 bg-[#111827]/90 p-4 text-center">
              <div className="text-xs text-slate-400 mb-1">Aniqlik darajasi</div>
              <div className="text-lg sm:text-xl font-extrabold text-emerald-400">
                {result.score} / {result.total_questions}
              </div>
              <div className="text-[11px] text-slate-500">({result.score_percent}%)</div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#111827]/90 p-4 text-center">
              <div className="text-xs text-slate-400 mb-1">Taxminiy IELTS</div>
              <div className="text-lg sm:text-xl font-extrabold text-teal-300">
                {result.estimated_ielts_band}
              </div>
              <div className="text-[11px] text-slate-500">Band (0-9.0)</div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#111827]/90 p-4 text-center">
              <div className="text-xs text-slate-400 mb-1">Milliy Sertifikat</div>
              <div className="text-lg sm:text-xl font-extrabold text-yellow-400">
                {result.national_score_estimate}
              </div>
              <div className="text-[11px] text-slate-500">DTM (0-75 ball)</div>
            </div>
          </div>
        </div>

        {/* Weak Grammatical Topics */}
        {result.weak_topics && result.weak_topics.length > 0 && (
          <div className="rounded-2xl border border-slate-800/90 bg-[#111827]/80 p-5 sm:p-7 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-400" />
              <h4 className="text-base sm:text-lg font-bold text-white">
                Sizning zaif grammatik nuqtalaringiz (Top 3):
              </h4>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {result.weak_topics.map((wt, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-800 bg-[#0B0F17] p-4 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="font-semibold text-emerald-400">#{i + 1}-mavzu</span>
                      {wt.mistakes_count > 0 && (
                        <span className="text-red-400 font-medium">{wt.mistakes_count} ta xato</span>
                      )}
                    </div>
                    <h5 className="font-semibold text-slate-100 text-sm leading-snug">{wt.topic}</h5>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{wt.recommendation}</p>
                  </div>

                  {wt.lesson_id && (
                    <Link
                      href={`/videos?lesson=${encodeURIComponent(wt.lesson_id)}`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 pt-1 transition"
                    >
                      <Play className="size-3 fill-current" />
                      <span>{wt.lesson_order ? `${wt.lesson_order}-darsni ko'rish` : "Darsni ko'rish"}</span>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FRICTIONLESS CONVERSION / STATE MIGRATION CALLOUT */}
        <div className="rounded-3xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-950/40 via-[#111827] to-[#0B0F17] p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="max-w-xl mx-auto space-y-2">
            <h4 className="text-lg sm:text-2xl font-bold text-white leading-snug">
              Batafsil xatolar tahlili, o'qituvchilar tavsiyasi va shaxsiy o'quv rejangizni saqlab qolish uchun kiring:
            </h4>
            <p className="text-xs sm:text-sm text-slate-300">
              Ushbu test natijasi avtomatik ravishda shaxsiy o'quvchi profilingiz (MistakeVault) bazasiga biriktiriladi.
            </p>
          </div>

          {hasClaimed ? (
            <div className="flex flex-col items-center justify-center space-y-3 pt-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-950/70 px-4 py-1.5 text-sm font-semibold text-emerald-300">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>Natijangiz profilingizga muvaffaqiyatli bog'landi!</span>
              </div>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg hover:bg-emerald-500 transition"
              >
                <span>O'quvchi Kabinetiga O'tish</span>
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto pt-2">
              {/* Telegram 1-Click SSO */}
              <button
                type="button"
                onClick={handleTelegramAuthRedirect}
                className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2.5 rounded-xl border border-[#229ED9]/50 bg-[#229ED9]/20 hover:bg-[#229ED9]/30 px-5 py-3 text-sm font-bold text-[#38bdf8] shadow-md transition active:scale-95"
              >
                <svg className="size-5 fill-current shrink-0" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.535-.194 1.006.128.832.957z" />
                </svg>
                <span>✈️ Telegram orqali kirish</span>
              </button>

              {/* Google Sign-in */}
              <div className="w-full sm:w-auto flex-1">
                <GoogleAuthButton
                  mode="signin"
                  onSuccess={handleGoogleSuccess}
                  onError={(err) => toast.error(err)}
                  className="w-full py-3 text-sm font-bold"
                />
              </div>
            </div>
          )}

          {!hasClaimed && (
            <div className="flex items-center justify-center gap-4 text-xs text-slate-400 pt-2">
              <Link
                href={`/login?redirect=/${locale}/dashboard`}
                className="underline hover:text-white transition"
              >
                Telefon va parol bilan kirish
              </Link>
              <span>•</span>
              <Link
                href={`/register?redirect=/${locale}/dashboard`}
                className="underline hover:text-emerald-400 transition"
              >
                Ro'yxatdan o'tish
              </Link>
            </div>
          )}
        </div>

        {/* Retake test action */}
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={startTest}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition"
          >
            <RotateCcw className="size-3.5" />
            <span>Testni qayta topshirish</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
