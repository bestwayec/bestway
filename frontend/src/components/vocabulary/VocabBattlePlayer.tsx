"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Crown, Flame, Gamepad2, Loader2, Trophy, X, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BATTLE_ANSWER_STYLES } from "./battle-answer-styles";

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
    answers?: Record<string, { selectedIndex: number; isCorrect: boolean; pointsGained: number }>;
  } | null;
  /** Recorded by the server when the battle ends. Absent on an older API. */
  winners?: Array<{ rank: number; studentId: string; name: string; score: number; pointsAwarded: number }>;
}

interface AnswerResult {
  isCorrect: boolean;
  pointsGained: number;
}

const PIN_LENGTH = 6; // the server issues 6-digit PINs (vocab_battle.create_battle)

/** Student screen. "Points" here are this game's score, not platform points. */
export function VocabBattlePlayer({ initialPin = "", onClose }: VocabBattlePlayerProps) {
  const t = useTranslations("vocabBattle");
  const [pin, setPin] = React.useState(initialPin);
  const [hasJoined, setHasJoined] = React.useState(false);
  const [state, setState] = React.useState<PlayerBattleState | null>(null);
  const [isJoining, setIsJoining] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [selectedAnswerIndex, setSelectedAnswerIndex] = React.useState<number | null>(null);
  const [answerResult, setAnswerResult] = React.useState<AnswerResult | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [questionStartTime, setQuestionStartTime] = React.useState<number>(() => Date.now());

  const handleJoin = async (pinToUse?: string) => {
    const targetPin = (pinToUse || pin).trim();
    if (!targetPin) {
      setErrorMsg(t("player.enterPin"));
      return;
    }
    setIsJoining(true);
    setErrorMsg(null);
    try {
      setState(await api.post<PlayerBattleState>("/v1/vocabulary/battle/join", { pin: targetPin }));
      setHasJoined(true);
    } catch {
      setErrorMsg(t("player.joinFailed"));
    } finally {
      setIsJoining(false);
    }
  };

  React.useEffect(() => {
    if (initialPin && !hasJoined) void handleJoin(initialPin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPin]);

  React.useEffect(() => {
    if (!hasJoined || !pin || state?.status === "FINISHED") return;
    const interval = setInterval(async () => {
      try {
        setState(await api.get<PlayerBattleState>(`/v1/vocabulary/battle/${pin}/state`));
      } catch (err) {
        console.error("Player poll error", err);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [hasJoined, pin, state?.status]);

  React.useEffect(() => {
    if (state?.status !== "QUESTION") return;
    const currQId = state.currentQuestion?.questionId;
    const alreadyAns = currQId ? state.myState?.answers?.[currQId] : undefined;
    if (alreadyAns) {
      setSelectedAnswerIndex(alreadyAns.selectedIndex);
      setAnswerResult({ isCorrect: alreadyAns.isCorrect, pointsGained: alreadyAns.pointsGained });
    } else {
      setSelectedAnswerIndex(null);
      setAnswerResult(null);
      setQuestionStartTime(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentQuestionIndex, state?.status]);

  const handleChooseOption = async (optionIndex: number) => {
    if (selectedAnswerIndex !== null || isSubmitting || !state?.currentQuestion) return;
    setSelectedAnswerIndex(optionIndex);
    setIsSubmitting(true);
    const elapsed = Math.max(0.1, (Date.now() - questionStartTime) / 1000);
    try {
      setAnswerResult(
        await api.post<AnswerResult>(`/v1/vocabulary/battle/${pin}/answer`, {
          questionIndex: state.currentQuestionIndex,
          selectedIndex: optionIndex,
          elapsedSec: elapsed,
        }),
      );
    } catch (err) {
      console.error("Answer error", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeButton = onClose && (
    <button type="button" onClick={onClose} aria-label={t("close")} className="p-1 rounded-lg hover:bg-surface-hover text-fg-muted">
      <X className="h-5 w-5" />
    </button>
  );

  if (!hasJoined) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-8 text-fg shadow-2xl max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="text-lg font-bold">{t("player.joinTitle")}</h2>
          </div>
          {closeButton}
        </div>

        <div className="space-y-4 text-center">
          <label htmlFor="battle-pin" className="block text-sm text-fg-muted">{t("player.joinIntro")}</label>
          <Input
            id="battle-pin"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("player.pinPlaceholder")}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
            maxLength={PIN_LENGTH}
            className="text-center font-mono text-3xl font-black tracking-widest h-16 rounded-2xl"
          />
          {errorMsg && (
            <p role="alert" className="text-sm text-danger bg-danger-bg p-2.5 rounded-xl border border-danger-border font-medium">{errorMsg}</p>
          )}
          <Button
            type="button"
            size="lg"
            onClick={() => handleJoin()}
            disabled={isJoining || pin.length < PIN_LENGTH}
            className="w-full font-bold h-12 text-base"
          >
            {isJoining ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("player.joining")}
              </>
            ) : (
              t("player.join")
            )}
          </Button>
        </div>
      </div>
    );
  }

  const score = state?.myState?.score ?? 0;
  // My podium place, only if the server recorded one for this account.
  const myPlace = state?.myState ? state.winners?.find((w) => w.studentId === state.myState?.id) : undefined;

  return (
    <div className="rounded-3xl border border-border bg-surface p-6 text-fg shadow-2xl max-w-lg mx-auto min-h-[500px] flex flex-col justify-between">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <span className="text-sm text-fg-muted">{t("player.player")}</span>
          <p className="truncate text-sm font-bold text-fg">{state?.myState?.name || t("player.you")}</p>
        </div>
        <div className="flex items-center gap-2">
          {state?.myState?.streak && state.myState.streak > 1 ? (
            <Badge className="bg-orange-subtle text-orange border-border text-sm">
              <Flame className="h-3 w-3 mr-1 fill-current" aria-hidden="true" />
              {t("streak", { count: state.myState.streak })}
            </Badge>
          ) : null}
          <div className="bg-brand-subtle border border-border px-3 py-1 rounded-xl text-brand-subtle-fg font-mono font-bold text-sm tabular-nums">
            {t("gameScore", { score })}
          </div>
          {closeButton}
        </div>
      </div>

      {state?.status === "WAITING" && (
        <div className="py-12 text-center space-y-4 my-auto">
          <Loader2 className="h-10 w-10 animate-spin text-brand mx-auto" aria-hidden="true" />
          <h3 className="text-xl font-bold text-fg">{t("player.inGame")}</h3>
          <p className="text-sm text-fg-muted">{t("player.waitTeacher")}</p>
          <div className="inline-block bg-bg-subtle border border-border px-4 py-2 rounded-xl text-sm font-mono text-fg">{t("player.pin", { pin })}</div>
        </div>
      )}

      {state?.status === "QUESTION" && state.currentQuestion && (
        <div className="py-4 space-y-6 flex-1 flex flex-col justify-between">
          <div className="text-center space-y-2">
            <span className="text-sm text-fg-muted">
              {t("question", { current: state.currentQuestionIndex + 1, total: state.totalQuestions })}
            </span>
            <h2 className="text-3xl font-black text-fg">{state.currentQuestion.english}</h2>
            <p className="text-sm text-fg-muted">{t("prompt", { word: state.currentQuestion.english })}</p>
          </div>

          {selectedAnswerIndex !== null ? (
            <div className="p-6 rounded-2xl bg-bg-subtle border border-border text-center space-y-3 my-auto" aria-live="polite">
              {answerResult ? (
                answerResult.isCorrect ? (
                  <>
                    <CheckCircle2 className="h-14 w-14 text-success mx-auto" aria-hidden="true" />
                    <h3 className="text-2xl font-black text-success">{t("player.correct")}</h3>
                    {answerResult.pointsGained > 0 && (
                      <p className="text-sm font-semibold text-fg">{t("player.gained", { points: answerResult.pointsGained })}</p>
                    )}
                  </>
                ) : (
                  <>
                    <XCircle className="h-14 w-14 text-danger mx-auto" aria-hidden="true" />
                    <h3 className="text-2xl font-black text-danger">{t("player.wrong")}</h3>
                    <p className="text-sm text-fg-muted">{t("player.nextLuck")}</p>
                  </>
                )
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-brand mx-auto" aria-hidden="true" />
                  <p className="text-sm text-fg font-medium">{t("player.received")}</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {state.currentQuestion.options.map((opt, idx) => {
                const shape = BATTLE_ANSWER_STYLES[idx % BATTLE_ANSWER_STYLES.length];
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleChooseOption(idx)}
                    className={cn(shape.bg, shape.text, "min-h-[56px] p-5 rounded-2xl flex items-center justify-between gap-3 font-bold text-lg shadow-lg hover:brightness-110 active:scale-95 transition-all text-left")}
                  >
                    <span>{opt}</span>
                    <span className="text-xl" aria-hidden="true">{shape.shape}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="text-center text-sm text-fg-muted">{t("player.teacherAdvances")}</div>
        </div>
      )}

      {state?.status === "LEADERBOARD" && (
        <div className="py-6 text-center space-y-5 my-auto">
          <Trophy className="h-10 w-10 text-warning mx-auto" aria-hidden="true" />
          <h3 className="text-xl font-bold text-fg">{t("player.leaderboardTitle")}</h3>
          <div className="bg-bg-subtle border border-border rounded-2xl p-4 max-w-sm mx-auto space-y-2">
            <span className="text-sm text-fg-muted">{t("player.yourScore")}</span>
            <div className="text-3xl font-black text-brand font-mono tabular-nums">{t("gameScore", { score })}</div>
          </div>
          <p className="text-sm text-fg-muted">{t("player.waitNext")}</p>
        </div>
      )}

      {state?.status === "FINISHED" && (
        <div className="py-8 text-center space-y-6 my-auto">
          <Crown className="h-12 w-12 text-warning mx-auto" aria-hidden="true" />
          <h2 className="text-2xl font-black text-fg">{t("player.finishedTitle")}</h2>
          <div className="bg-bg-subtle border border-border rounded-2xl p-6 max-w-sm mx-auto space-y-2">
            <span className="text-sm text-fg-muted">{t("player.finalScore")}</span>
            <div className="text-4xl font-black text-warning font-mono tabular-nums">{t("gameScore", { score })}</div>
            {myPlace && <p className="text-sm font-semibold text-fg">{t("player.yourPlace", { rank: myPlace.rank })}</p>}
            {myPlace && myPlace.pointsAwarded > 0 && (
              <p className="text-sm font-semibold text-success">{t("pointsAwarded", { points: myPlace.pointsAwarded })}</p>
            )}
          </div>
          <Button type="button" onClick={onClose} className="font-bold px-8">{t("player.exit")}</Button>
        </div>
      )}
    </div>
  );
}
