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
import { Button } from "@/components/ui/button";
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

  // Fetch Quiz Questions
  const loadQuiz = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      if (isSrs) {
        const res = await api.get<{
          title: string;
          totalQuestions: number;
          questions: QuizQuestion[];
        }>("/v1/vocabulary/srs/quiz");
        setQuestions(res.questions || []);
        setQuizTitle(res.title || "Xatolar Banki (SRS)");
      } else if (setId) {
        const res = await api.get<{
          setTitle: string;
          totalQuestions: number;
          questions: QuizQuestion[];
        }>(`/v1/vocabulary/sets/${setId}/quiz?mode=${mode}`);
        setQuestions(res.questions || []);
        setQuizTitle(res.setTitle || "Lug'at Testi");
      }
      setCurrentIndex(0);
      setAnswers([]);
      setSelectedOption(null);
      setSpellingText("");
      setIsAnswered(false);
      setIsCorrectCurrent(null);
      setQuizResult(null);
    } catch (err: any) {
      setErrorMsg(err.message || "Test savollarini yuklab bo'lmadi");
    } finally {
      setIsLoading(false);
    }
  }, [setId, isSrs, mode]);

  React.useEffect(() => {
    loadQuiz();
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
      setErrorMsg(err.message || "Test natijasini saqlashda xatolik yuz berdi");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 backdrop-blur-xl p-12 text-center text-slate-300 shadow-2xl flex flex-col items-center justify-center gap-4">
        <Sparkles className="h-8 w-8 text-emerald-400 animate-spin" />
        <p className="text-base font-medium">Lug'at savollari tayyorlanmoqda...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-8 text-center text-rose-200 space-y-4">
        <AlertCircle className="h-8 w-8 text-rose-400 mx-auto" />
        <p className="font-medium">{errorMsg}</p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={loadQuiz}>
            Qayta urinish
          </Button>
          {onExit && (
            <Button variant="ghost" onClick={onExit}>
              Chiqish
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 backdrop-blur-xl p-12 text-center text-slate-300 space-y-4">
        <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
        <h3 className="text-xl font-bold text-white">Savollar mavjud emas</h3>
        <p className="text-sm text-slate-400">
          Ushbu rejimda yoki xatolar bankida hozircha mashq qilish uchun so'zlar yo'q.
        </p>
        {onExit && (
          <Button onClick={onExit} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            Lug'atga qaytish
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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/95 backdrop-blur-2xl p-6 sm:p-10 shadow-2xl text-slate-100 max-w-2xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Celebration Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-2">
            <Trophy className="h-10 w-10 text-emerald-400" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
            {isPerfect
              ? "Ajoyib! Mukammal Natija! 🏆"
              : isGood
              ? "Yaxshi Natija! Barakalla! ✨"
              : "Mashq Yakunlandi! 🎯"}
          </h2>
          <p className="text-sm text-slate-400">
            {isSrs
              ? "Xatolar bankidagi so'zlaringiz qayta ko'rib chiqildi"
              : `${quizTitle} to'plami bo'yicha test topshirildi`}
          </p>
        </div>

        {/* Gamified Points Banner */}
        {hasBonus ? (
          <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-amber-500/10 p-5 text-center space-y-1 shadow-lg shadow-emerald-500/5">
            <div className="flex items-center justify-center gap-2 text-amber-400 font-extrabold text-lg">
              <Sparkles className="h-5 w-5" />
              <span>+{quizResult.pointsAwarded} PLATFORMA BALLI QO'SHILDI!</span>
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-xs text-slate-300">
              {isPerfect
                ? "100% aniqlik uchun maksimal +5 bonus balli hisobingizga o'tkazildi."
                : "80% dan yuqori natija uchun +3 bonus balli hisobingizga o'tkazildi."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-4 text-center text-xs text-slate-400">
            Platforma ballini qo'lga kiritish uchun natijangiz kamida 80% bo'lishi kerak. Yana mashq qiling!
          </div>
        )}

        {/* Score Breakdown Cards */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-400">To'g'ri</div>
            <div className="text-xl font-bold text-emerald-400 mt-1">
              {quizResult.score} / {quizResult.totalWords}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-400">Aniqlik</div>
            <div className="text-xl font-bold text-white mt-1">
              {quizResult.percentage}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-3">
            <div className="text-xs uppercase tracking-wider text-slate-400">Xatolar</div>
            <div className="text-xl font-bold text-rose-400 mt-1">
              {quizResult.wrongAnswers?.length || 0} ta
            </div>
          </div>
        </div>

        {/* Mistake Review Accordion / List */}
        {quizResult.wrongAnswers && quizResult.wrongAnswers.length > 0 && (
          <div className="space-y-3 border-t border-slate-800 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-rose-400" />
              <span>Xato Qilingan So'zlar (SRS Bankiga qo'shildi):</span>
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {quizResult.wrongAnswers.map((w, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-2.5 text-xs flex items-center justify-between gap-3"
                >
                  <div>
                    <span className="font-bold text-white">{w.english}</span>
                    <span className="text-slate-400 ml-2">— {w.uzbek}</span>
                  </div>
                  {w.userAnswer && (
                    <div className="text-rose-400 font-mono text-[11px] truncate">
                      Siz: {w.userAnswer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={loadQuiz}
            className="border-slate-700 text-slate-200 hover:bg-slate-800"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Qayta Topshtirish
          </Button>

          <div className="flex items-center gap-2">
            <Link href="/vocabulary/srs">
              <Button
                type="button"
                variant="outline"
                className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              >
                Xatolar Banki (SRS)
              </Button>
            </Link>

            {onExit ? (
              <Button
                type="button"
                onClick={onExit}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
              >
                Lug'atga Qaytish
              </Button>
            ) : (
              <Link href="/vocabulary">
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                >
                  Lug'atga Qaytish
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 backdrop-blur-xl p-6 md:p-8 shadow-2xl text-slate-100 max-w-2xl mx-auto space-y-6">
      {/* Top Bar: Progress and Title */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">{quizTitle}</span>
            <Badge
              variant="neutral"
              className="border-emerald-500/30 text-emerald-400 text-[10px] uppercase font-mono"
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
        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-800/30 p-6 text-center space-y-4">
        {currentQ.partOfSpeech && (
          <span className="inline-block text-[11px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            {currentQ.partOfSpeech}
          </span>
        )}

        <div className="flex items-center justify-center gap-3">
          <h3 className="text-3xl font-extrabold text-white tracking-tight">
            {currentQ.prompt}
          </h3>
          {/* TTS Speaker Button */}
          {isSpeechSupported && (
            <button
              type="button"
              onClick={() => speakWord(currentQ.prompt)}
              className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 transition-colors shadow-sm"
              title="Talaffuzni tinglash"
              aria-label="Talaffuzni tinglash"
            >
              <Volume2 className="h-5 w-5" />
            </button>
          )}
        </div>

        {currentQ.contextSentence && (
          <p className="text-xs text-slate-400 italic max-w-md mx-auto">
            "{currentQ.contextSentence}"
          </p>
        )}

        {currentQ.type === "spelling" && currentQ.firstLetter && (
          <div className="inline-flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-3 py-1 rounded-lg border border-amber-500/20">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Bosh harfi: <strong>{currentQ.firstLetter}...</strong></span>
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
              placeholder="Inglizcha to'g'ri yozilishini kiriting..."
              disabled={isAnswered}
              className="bg-slate-950/80 border-slate-700 text-white placeholder:text-slate-500 text-base h-12 px-4 rounded-xl focus:border-emerald-500 focus:ring-emerald-500"
            />
            <Button
              type="button"
              onClick={handleSpellingSubmit}
              disabled={!spellingText.trim() || isAnswered}
              className="bg-emerald-600 hover:bg-emerald-500 text-white h-12 px-6 rounded-xl font-semibold shrink-0"
            >
              Tekshirish
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
                    ? "border-emerald-500 bg-emerald-500/20 text-white scale-[1.01]"
                    : "border-slate-800 bg-slate-800/40 text-slate-200 hover:border-slate-700 hover:bg-slate-800/80"
                }`}
              >
                <span>{opt}</span>
                <span className="font-mono text-xs text-slate-500 ml-2">
                  {String.fromCharCode(65 + i)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Footer controls */}
      <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-4">
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="hover:text-slate-200 transition-colors"
          >
            Mashqni to'xtatish
          </button>
        ) : (
          <Link href="/vocabulary" className="hover:text-slate-200 transition-colors">
            Mashqni to'xtatish
          </Link>
        )}
        <span className="text-slate-500">
          Natija: 100% uchun +5 ball, 80-99% uchun +3 ball
        </span>
      </div>
    </div>
  );
}
