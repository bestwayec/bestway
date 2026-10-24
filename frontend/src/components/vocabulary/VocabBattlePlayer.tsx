"use client";

import * as React from "react";
import {
  Award,
  Check,
  CheckCircle2,
  Clock,
  Crown,
  Flame,
  Gamepad2,
  Loader2,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface VocabBattlePlayerProps {
  initialPin?: string;
  onClose?: () => void;
}

export interface PlayerBattleState {
  sessionId: string;
  pin: string;
  setTitle: string;
  status: "WAITING" | "QUESTION" | "LEADERBOARD" | "FINISHED";
  currentQuestionIndex: number;
  totalQuestions: number;
  currentQuestion?: {
    questionId: string;
    english: string;
    prompt: string;
    options: string[];
    timeLimit: number;
  } | null;
  leaderboard: Array<{ id: string; name: string; score: number; streak: number }>;
  myState?: {
    id: string;
    name: string;
    score: number;
    streak: number;
    answers?: Record<string, any>;
  } | null;
}

const SHAPES = [
  { bg: "bg-red-600 active:scale-95 hover:bg-red-500", text: "text-white", shape: "🔺" },
  { bg: "bg-blue-600 active:scale-95 hover:bg-blue-500", text: "text-white", shape: "🔷" },
  { bg: "bg-amber-600 active:scale-95 hover:bg-amber-500", text: "text-white", shape: "🟡" },
  { bg: "bg-emerald-600 active:scale-95 hover:bg-emerald-500", text: "text-white", shape: "🟢" },
];

export function VocabBattlePlayer({ initialPin = "", onClose }: VocabBattlePlayerProps) {
  const [pin, setPin] = React.useState(initialPin);
  const [hasJoined, setHasJoined] = React.useState(false);
  const [state, setState] = React.useState<PlayerBattleState | null>(null);
  const [isJoining, setIsJoining] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Answering state
  const [selectedAnswerIndex, setSelectedAnswerIndex] = React.useState<number | null>(null);
  const [answerResult, setAnswerResult] = React.useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [questionStartTime, setQuestionStartTime] = React.useState<number>(Date.now());

  const handleJoin = async (pinToUse?: string) => {
    const targetPin = (pinToUse || pin).trim();
    if (!targetPin) {
      setErrorMsg("PIN-kodni kiriting");
      return;
    }
    setIsJoining(true);
    setErrorMsg(null);
    try {
      const res = await api.post<PlayerBattleState>("/v1/vocabulary/battle/join", { pin: targetPin });
      setState(res);
      setHasJoined(true);
    } catch (err: any) {
      setErrorMsg(err.message || "Xonaga ulanib bo'lmadi. PIN-kodni tekshiring.");
    } finally {
      setIsJoining(false);
    }
  };

  // Auto-join if initialPin provided
  React.useEffect(() => {
    if (initialPin && !hasJoined) {
      handleJoin(initialPin);
    }
  }, [initialPin]);

  // Polling state when in game
  React.useEffect(() => {
    if (!hasJoined || !pin || state?.status === "FINISHED") return;

    const interval = setInterval(async () => {
      try {
        const nextState = await api.get<PlayerBattleState>(`/v1/vocabulary/battle/${pin}/state`);
        setState(nextState);
      } catch (err) {
        console.error("Player poll error", err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [hasJoined, pin, state?.status]);

  // Reset answer when moving to new question
  React.useEffect(() => {
    if (state?.status === "QUESTION") {
      const currQId = state.currentQuestion?.questionId;
      const alreadyAns = currQId && state.myState?.answers?.[currQId];
      if (alreadyAns) {
        setSelectedAnswerIndex(alreadyAns.selectedIndex);
        setAnswerResult({
          isCorrect: alreadyAns.isCorrect,
          pointsGained: alreadyAns.pointsGained,
        });
      } else {
        setSelectedAnswerIndex(null);
        setAnswerResult(null);
        setQuestionStartTime(Date.now());
      }
    }
  }, [state?.currentQuestionIndex, state?.status]);

  const handleChooseOption = async (optionIndex: number) => {
    if (selectedAnswerIndex !== null || isSubmitting || !state?.currentQuestion) return;
    setSelectedAnswerIndex(optionIndex);
    setIsSubmitting(true);

    const elapsed = Math.max(0.1, (Date.now() - questionStartTime) / 1000);
    try {
      const res = await api.post<any>(`/v1/vocabulary/battle/${pin}/answer`, {
        questionIndex: state.currentQuestionIndex,
        selectedIndex: optionIndex,
        elapsedSec: elapsed,
      });
      setAnswerResult(res);
    } catch (err: any) {
      console.error("Answer error", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!hasJoined) {
    return (
      <div className="rounded-3xl border border-white/10 bg-[#0B0F17] p-8 text-white shadow-2xl max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-bold">Vocab Battle O'yiniga Kirish</h2>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            O'qituvchi taqdim etgan 6 xonali PIN-kodni kiriting:
          </p>

          <Input
            type="text"
            placeholder="6 xonali PIN (masalan: 742918)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
            className="text-center font-mono text-3xl font-black tracking-widest bg-white/5 border-white/20 h-16 rounded-2xl"
          />

          {errorMsg && (
            <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-xl border border-destructive/20 font-medium">
              {errorMsg}
            </p>
          )}

          <Button
            type="button"
            size="lg"
            onClick={() => handleJoin()}
            disabled={isJoining || pin.length < 5}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-12 rounded-xl text-base shadow-lg shadow-emerald-950/40"
          >
            {isJoining ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Ulanmoqda...
              </>
            ) : (
              "O'yinga Kirish 🎮"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0B0F17] p-6 text-white shadow-2xl max-w-lg mx-auto min-h-[500px] flex flex-col justify-between">
      {/* Top player header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <span className="text-xs text-muted-foreground">O'yinchi</span>
          <p className="text-sm font-bold text-white flex items-center gap-1.5">
            👤 {state?.myState?.name || "Siz"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {state?.myState?.streak && state.myState.streak > 1 ? (
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">
              <Flame className="h-3 w-3 mr-1 fill-current" />
              {state.myState.streak} streak
            </Badge>
          ) : null}

          <div className="bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-xl text-emerald-400 font-mono font-bold text-sm">
            {state?.myState?.score || 0} ball
          </div>

          {onClose && (
            <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* WAITING STATE */}
      {state?.status === "WAITING" && (
        <div className="py-12 text-center space-y-4 my-auto">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-400 mx-auto" />
          <h3 className="text-xl font-bold text-white">Siz o'yindasiz! 🎉</h3>
          <p className="text-sm text-muted-foreground">
            O'qituvchi barcha o'quvchilarni kutib, bellashuvni boshlashini kuting...
          </p>
          <div className="inline-block bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-xs font-mono text-emerald-400">
            PIN: {pin}
          </div>
        </div>
      )}

      {/* QUESTION STATE */}
      {state?.status === "QUESTION" && state.currentQuestion && (
        <div className="py-4 space-y-6 flex-1 flex flex-col justify-between">
          <div className="text-center space-y-2">
            <span className="text-xs text-muted-foreground">
              Savol {state.currentQuestionIndex + 1} / {state.totalQuestions}
            </span>
            <h2 className="text-3xl font-black text-white capitalize">
              {state.currentQuestion.english}
            </h2>
            <p className="text-xs text-muted-foreground">{state.currentQuestion.prompt}</p>
          </div>

          {/* Answer confirmation overlay or option tiles */}
          {selectedAnswerIndex !== null ? (
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-3 my-auto animate-in fade-in zoom-in-95">
              {answerResult ? (
                answerResult.isCorrect ? (
                  <>
                    <CheckCircle2 className="h-14 w-14 text-emerald-400 mx-auto animate-bounce" />
                    <h3 className="text-2xl font-black text-emerald-400">To'g'ri javob! 🎉</h3>
                    <p className="text-sm font-semibold text-white">
                      +{answerResult.pointsGained} ball qo'shildi!
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle className="h-14 w-14 text-red-400 mx-auto" />
                    <h3 className="text-2xl font-black text-red-400">Noto'g'ri ❌</h3>
                    <p className="text-xs text-muted-foreground">Keyingi savolda omad tilaymiz!</p>
                  </>
                )
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mx-auto" />
                  <p className="text-sm text-white font-medium">Javobingiz qabul qilindi...</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {state.currentQuestion.options.map((opt, idx) => {
                const shape = SHAPES[idx % SHAPES.length];
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleChooseOption(idx)}
                    className={`${shape.bg} ${shape.text} p-5 rounded-2xl flex items-center justify-between font-bold text-lg shadow-lg hover:brightness-110 transition-all text-left`}
                  >
                    <span>{opt}</span>
                    <span className="text-xl">{shape.shape}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="text-center text-xs text-muted-foreground">
            Barcha javob bergach o'qituvchi keyingi bosqichga o'tkazadi
          </div>
        </div>
      )}

      {/* LEADERBOARD STATE */}
      {state?.status === "LEADERBOARD" && (
        <div className="py-6 text-center space-y-5 my-auto">
          <Trophy className="h-10 w-10 text-amber-400 mx-auto" />
          <h3 className="text-xl font-bold text-white">Natijalar jadvali</h3>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 max-w-sm mx-auto space-y-2">
            <span className="text-xs text-muted-foreground">Sizning jami ballingiz:</span>
            <div className="text-3xl font-black text-emerald-400 font-mono">
              {state.myState?.score || 0} ball
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            O'qituvchi keyingi savolni ochishini kuting...
          </p>
        </div>
      )}

      {/* FINISHED STATE */}
      {state?.status === "FINISHED" && (
        <div className="py-8 text-center space-y-6 my-auto">
          <Crown className="h-12 w-12 text-amber-400 mx-auto animate-bounce" />
          <h2 className="text-2xl font-black text-white">O'yin yakunlandi! 🏆</h2>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 max-w-sm mx-auto space-y-2">
            <span className="text-xs text-muted-foreground">Siz to'plagan yakuniy ball:</span>
            <div className="text-4xl font-black text-amber-400 font-mono">
              {state.myState?.score || 0}
            </div>
          </div>

          <Button
            type="button"
            onClick={onClose}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-3 rounded-xl"
          >
            Chiqish ✅
          </Button>
        </div>
      )}
    </div>
  );
}
