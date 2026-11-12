"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronRight,
  Flame,
  HelpCircle,
  RotateCcw,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";

export interface QuizQuestion {
  id: string;
  wordId: string;
  prompt: string;
  type: "eng_uzb" | "uzb_eng" | "spelling";
  options: string[];
  contextSentence?: string | null;
  partOfSpeech?: string | null;
  firstLetter?: string;
}

export interface QuizResult {
  attemptId?: string;
  score: number;
  totalWords: number;
  percentage: number;
  pointsAwarded: number;
  /** Points this result earns by the rule, and points this set already paid (server-provided). */
  pointsEarned?: number;
  pointsAlreadyAwarded?: number;
  mode: string;
  wrongAnswers: Array<{
    wordId: string;
    english: string;
    uzbek: string;
    userAnswer?: string;
    correctAnswer?: string;
  }>;
}

export interface VocabularyQuizRunnerProps {
  setId?: string;
  isSrs?: boolean;
  mode?: "mixed" | "eng_uzb" | "uzb_eng" | "spelling";
  onFinish?: (result: QuizResult) => void;
  onExit?: () => void;
}

export function VocabularyQuizRunner({
  setId,
  isSrs = false,
  mode = "mixed",
  onFinish,
  onExit,
}: VocabularyQuizRunnerProps) {
  const t = useTranslations("vocabQuiz");
  const [questions, setQuestions] = React.useState<QuizQuestion[]>([]);
  const [quizTitle, setQuizTitle] = React.useState<string>("");
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<
    Array<{ wordId: string; answer: string; type: string }>
  >([]);
  const [selectedOption, setSelectedOption] = React.useState<string | null>(null);
  const [spellingText, setSpellingText] = React.useState<string>("");
  const [isAnswered, setIsAnswered] = React.useState(false);
  const [isCorrectCurrent, setIsCorrectCurrent] = React.useState<boolean | null>(null);

  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [quizResult, setQuizResult] = React.useState<QuizResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [isSpeechSupported, setIsSpeechSupported] = React.useState(false);

  // Check Web Speech API availability
  React.useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      setIsSpeechSupported(true);
    }
  }, []);

  const speakWord = React.useCallback(
    (textToSpeak: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = "en-US";
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("TTS error", err);
      }
    },
    [],
  );

  // Fetch Quiz Questions. Only the latest load may set the questions: an
  // earlier response arriving later (remount, React StrictMode) used to replace
  // the questions under a student who had already answered, so the answer was
  // scored against another word.
  const loadSeq = React.useRef(0);
  const loadQuiz = React.useCallback(async () => {
    const seq = ++loadSeq.current;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isSrs) {
        const res = await api.get<{
          title: string;
          totalQuestions: number;
          questions: QuizQuestion[];
        }>("/v1/vocabulary/srs/quiz");
        if (seq !== loadSeq.current) return;
        setQuestions(res.questions || []);
        setQuizTitle(res.title || "Xatolar Banki (SRS)");
      } else if (setId) {
        const res = await api.get<{
          setTitle: string;
          totalQuestions: number;
          questions: QuizQuestion[];
        }>(`/v1/vocabulary/sets/${setId}/quiz?mode=${mode}`);
        if (seq !== loadSeq.current) return;
        setQuestions(res.questions || []);
        setQuizTitle(res.setTitle || t("defaultTitle"));
      }
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedOption(null);
      setSpellingText("");
      setIsAnswered(false);
      setIsCorrectCurrent(null);
      setQuizResult(null);
    } catch (err: any) {
      if (seq !== loadSeq.current) return;
      setErrorMsg(err.message || t("loadFailed"));
    } finally {
      if (seq === loadSeq.current) setIsLoading(false);
    }
  }, [setId, isSrs, mode]);

  React.useEffect(() => {
    loadQuiz();
    // A newer load (or unmount) makes this one stale.
    return () => { loadSeq.current += 1; };
  }, [loadQuiz]);

  const currentQ = questions[currentIndex];

  // Auto-pronounce if prompt is English
  React.useEffect(() => {
    if (currentQ && currentQ.type === "eng_uzb") {
      speakWord(currentQ.prompt);
    }
  }, [currentQ, speakWord]);

  const handleSelectOption = (opt: string) => {
    if (isAnswered || !currentQ) return;
    setSelectedOption(opt);
    setIsAnswered(true);

    // Save answer
    const nextAnswers = [
      ...answers,
      { wordId: currentQ.wordId, answer: opt, type: currentQ.type },
    ];
    setAnswers(nextAnswers);

    // Short delay before advancing
    setTimeout(() => {
      advanceNextQuestion(nextAnswers);
    }, 600);
  };

  const handleSpellingSubmit = () => {
    if (isAnswered || !currentQ || !spellingText.trim()) return;
    setIsAnswered(true);

    const nextAnswers = [
      ...answers,
      { wordId: currentQ.wordId, answer: spellingText.trim(), type: currentQ.type },
    ];
    setAnswers(nextAnswers);

    setTimeout(() => {
      advanceNextQuestion(nextAnswers);
    }, 600);
  };

  const advanceNextQuestion = (accumulatedAnswers: typeof answers) => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOption(null);
      setSpellingText("");
      setIsAnswered(false);
      setIsCorrectCurrent(null);
    } else {
      // Completed all questions -> submit
      submitAttempt(accumulatedAnswers);
    }
  };

  const submitAttempt = async (finalAnswers: typeof answers) => {
    setIsSubmitting(true);
    try {
      let result: QuizResult;
      if (isSrs) {
        result = await api.post<QuizResult>("/v1/vocabulary/srs/submit", {
          mode,
          answers: finalAnswers,
        });
      } else {
        result = await api.post<QuizResult>(`/v1/vocabulary/sets/${setId}/submit`, {
          mode,
          answers: finalAnswers,
        });
      }
      setQuizResult(result);
      if (onFinish) {
        onFinish(result);
      }
    } catch (err: any) {
      setErrorMsg(err.message || t("saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      // Skeleton in the shape of the quiz card (U5): header, progress, prompt, four options.
      <div className="space-y-5 rounded-2xl border border-border bg-surface/90 p-6 shadow-2xl" aria-busy="true" data-testid="vocab-quiz-skeleton">
        <p className="sr-only" role="status">{t("preparing")}</p>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-16" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-8 w-3/4" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-2xl border border-danger-border/50 bg-danger-bg/20 p-8 text-center text-danger space-y-4">
        <AlertCircle className="h-8 w-8 text-danger mx-auto" />
        <p className="font-medium">{errorMsg}</p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={loadQuiz}>
            {t("retry")}
          </Button>
          {onExit && (
            <Button variant="ghost" onClick={onExit}>
              {t("exit")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface/90 backdrop-blur-xl p-12 text-center text-fg-muted space-y-4">
        <CheckCircle2 className="h-12 w-12 text-brand mx-auto" />
        <h3 className="text-xl font-bold text-fg">{t("emptyTitle")}</h3>
        <p className="text-sm text-fg-muted">
          {t("emptyBody")}
        </p>
        {onExit && (
          <Button onClick={onExit} className="bg-brand hover:bg-brand-hover text-brand-fg">
            {t("backToVocabulary")}
          </Button>
        )}
      </div>
    );
  }

  // Quiz Finished / Modal Screen
  if (quizResult) {
    const isPerfect = quizResult.percentage === 100;
    const isGood = quizResult.percentage >= 80 && quizResult.percentage < 100;
    const hasBonus = quizResult.pointsAwarded > 0;

    return (
      <div className="rounded-2xl border border-border bg-surface/95 backdrop-blur-2xl p-6 sm:p-10 shadow-2xl text-fg max-w-2xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Celebration Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-brand/10 border border-brand/20 mb-2">
            <Trophy className="h-10 w-10 text-brand" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-fg">
            {isPerfect ? t("headingPerfect") : isGood ? t("headingGood") : t("headingDone")}
          </h2>
          <p className="text-sm text-fg-muted">
            {isSrs
              ? t("srsReviewed")
              : t("setSubmitted", { title: quizTitle })}
          </p>
        </div>

        {/* Gamified Points Banner */}
        {hasBonus ? (
          <div className="rounded-xl border border-warning/30 bg-gradient-to-r from-warning/10 via-brand/10 to-warning/10 p-5 text-center space-y-1 shadow-lg shadow-brand/5">
            <div className="flex items-center justify-center gap-2 text-warning font-extrabold text-lg">
              <Sparkles className="h-5 w-5" />
              <span>{t("pointsAdded", { points: quizResult.pointsAwarded })}</span>
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-xs text-fg-muted">
              {t("pointsRule")}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-hover/40 p-4 text-center text-xs text-fg-muted">
            {(quizResult.pointsAlreadyAwarded ?? 0) > 0 && (quizResult.pointsEarned ?? 0) > 0 ? t("pointsAlreadyPaid") : t("pointsNeed80")}
          </div>
        )}

        {/* Score Breakdown Cards */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-border bg-surface-hover/30 p-3">
            <div className="text-xs uppercase tracking-wider text-fg-muted">{t("correct")}</div>
            <div className="text-xl font-bold text-brand mt-1">
              {quizResult.score} / {quizResult.totalWords}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface-hover/30 p-3">
            <div className="text-xs uppercase tracking-wider text-fg-muted">{t("accuracy")}</div>
            <div className="text-xl font-bold text-fg mt-1">
              {quizResult.percentage}%
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface-hover/30 p-3">
            <div className="text-xs uppercase tracking-wider text-fg-muted">{t("mistakes")}</div>
            <div className="text-xl font-bold text-danger mt-1">
              {quizResult.wrongAnswers?.length || 0} ta
            </div>
          </div>
        </div>

        {/* Mistake Review Accordion / List */}
        {quizResult.wrongAnswers && quizResult.wrongAnswers.length > 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-muted flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-danger" />
              <span>{t("wrongWords")}</span>
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {quizResult.wrongAnswers.map((w, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-danger-border/40 bg-danger-bg/20 p-2.5 text-xs flex items-center justify-between gap-3"
                >
                  <div>
                    <span className="font-bold text-fg">{w.english}</span>
                    <span className="text-fg-muted ml-2">— {w.uzbek}</span>
                  </div>
                  {w.userAnswer && (
                    <div className="text-danger font-mono text-[11px] truncate">
                      Siz: {w.userAnswer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={loadQuiz}
            className="border-border-strong text-fg hover:bg-surface-hover"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("retake")}
          </Button>

          <div className="flex items-center gap-2">
            <Link href="/vocabulary/srs">
              <Button
                type="button"
                variant="outline"
                className="border-brand/40 text-brand hover:bg-brand-hover/10"
              >
                {t("srsBank")}
              </Button>
            </Link>

            {onExit ? (
              <Button
                type="button"
                onClick={onExit}
                className="bg-brand hover:bg-brand-hover text-brand-fg font-medium"
              >
                {t("backToVocabulary")}
              </Button>
            ) : (
              <Link href="/vocabulary">
                <Button
                  type="button"
                  className="bg-brand hover:bg-brand-hover text-brand-fg font-medium"
                >
                  {t("backToVocabulary")}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active Question Runner
  const progressPercent = Math.round(((currentIndex + 1) / questions.length) * 100);

  return (
    <div className="rounded-2xl border border-border bg-surface/90 backdrop-blur-xl p-6 md:p-8 shadow-2xl text-fg max-w-2xl mx-auto space-y-6">
      {/* Top Bar: Progress and Title */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg">{quizTitle}</span>
            <Badge
              variant="neutral"
              className="border-brand/30 text-brand text-[10px] uppercase font-mono"
            >
              {currentQ.type === "eng_uzb"
                ? "ENG → UZB"
                : currentQ.type === "uzb_eng"
                ? "UZB → ENG"
                : "SPELLING"}
            </Badge>
          </div>
          <span className="font-mono">
            {currentIndex + 1} / {questions.length}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
          <div
            className="h-full bg-brand transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="rounded-xl border border-border/80 bg-surface-hover/30 p-6 text-center space-y-4">
        {currentQ.partOfSpeech && (
          <span className="inline-block text-[11px] uppercase tracking-wider font-semibold text-brand bg-brand/10 px-2 py-0.5 rounded-full border border-brand/20">
            {currentQ.partOfSpeech}
          </span>
        )}

        <div className="flex items-center justify-center gap-3">
          <h3 className="text-3xl font-extrabold text-fg tracking-tight">
            {currentQ.prompt}
          </h3>
          {/* TTS Speaker Button */}
          {isSpeechSupported && (
            <button
              type="button"
              onClick={() => speakWord(currentQ.prompt)}
              className="p-2 rounded-full bg-surface-hover hover:bg-border-strong text-brand hover:text-brand transition-colors shadow-sm"
              title={t("listen")}
              aria-label={t("listen")}
            >
              <Volume2 className="h-5 w-5" />
            </button>
          )}
        </div>

        {currentQ.contextSentence && (
          <p className="text-xs text-fg-muted italic max-w-md mx-auto">
            "{currentQ.contextSentence}"
          </p>
        )}

        {currentQ.type === "spelling" && currentQ.firstLetter && (
          <div className="inline-flex items-center gap-1.5 text-xs text-warning bg-warning/10 px-3 py-1 rounded-lg border border-warning/20">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>{t("firstLetter")} <strong>{currentQ.firstLetter}...</strong></span>
          </div>
        )}
      </div>

      {/* Answer Area: 4-Option Grid or Spelling Input */}
      {currentQ.type === "spelling" ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              autoFocus
              value={spellingText}
              onChange={(e) => setSpellingText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSpellingSubmit()}
              placeholder={t("spellingPlaceholder")}
              disabled={isAnswered}
              className="bg-bg/80 border-border-strong text-fg placeholder:text-fg-subtle text-base h-12 px-4 rounded-xl focus:border-brand focus:ring-brand"
            />
            <Button
              type="button"
              onClick={handleSpellingSubmit}
              disabled={!spellingText.trim() || isAnswered}
              className="bg-brand hover:bg-brand-hover text-brand-fg h-12 px-6 rounded-xl font-semibold shrink-0"
            >
              {t("check")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {currentQ.options.map((opt, i) => {
            const isSelected = selectedOption === opt;
            return (
              <button
                key={i}
                type="button"
                disabled={isAnswered}
                onClick={() => handleSelectOption(opt)}
                className={`rounded-xl border p-4 text-left transition-all duration-200 text-sm font-medium flex items-center justify-between ${
                  isSelected
                    ? "border-brand bg-brand/20 text-fg scale-[1.01]"
                    : "border-border bg-surface-hover/40 text-fg hover:border-border-strong hover:bg-surface-hover/80"
                }`}
              >
                <span>{opt}</span>
                <span className="font-mono text-xs text-fg-subtle ml-2">
                  {String.fromCharCode(65 + i)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Footer controls */}
      <div className="flex items-center justify-between text-xs text-fg-muted border-t border-border/80 pt-4">
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="hover:text-fg transition-colors"
          >
            {t("stop")}
          </button>
        ) : (
          <Link href="/vocabulary" className="hover:text-fg transition-colors">
            {t("stop")}
          </Link>
        )}
        <span className="text-fg-subtle">
          {t("pointsRule")}
        </span>
      </div>
    </div>
  );
}
