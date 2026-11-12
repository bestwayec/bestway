"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, Crown, Flame, Play, RefreshCw, Trophy, Users, X, Volume2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BATTLE_ANSWER_STYLES } from "./battle-answer-styles";

export interface VocabBattleHostProps {
  setId: string;
  onClose?: () => void;
}

export interface ParticipantItem {
  id: string;
  name: string;
  score: number;
  streak: number;
}

export interface BattleStateResponse {
  sessionId: string;
  pin: string;
  setTitle: string;
  level: string;
  status: "WAITING" | "QUESTION" | "LEADERBOARD" | "FINISHED";
  currentQuestionIndex: number;
  totalQuestions: number;
  currentQuestion?: {
    questionId: string;
    english: string;
    prompt: string;
    options: string[];
    correctIndex?: number;
    timeLimit: number;
  } | null;
  answeredCount: number;
  totalParticipants: number;
  leaderboard: ParticipantItem[];
}

/**
 * Host screen. Scores shown here are the battle's own game score. The server also gives platform points to
 * the podium when the battle ends, but the battle state does not report them, so this screen does not claim
 * any points were given.
 */
export function VocabBattleHost({ setId, onClose }: VocabBattleHostProps) {
  const t = useTranslations("vocabBattle");
  const [battleState, setBattleState] = React.useState<BattleStateResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isAdvancing, setIsAdvancing] = React.useState(false);
  const [timeLeft, setTimeLeft] = React.useState<number | null>(null);
  const [errorKey, setErrorKey] = React.useState<"createFailed" | "nextFailed" | null>(null);
  const errorMsg = errorKey ? t(errorKey) : null;

  React.useEffect(() => {
    let mounted = true;
    async function initBattle() {
      setIsLoading(true);
      setErrorKey(null);
      try {
        const createRes = await api.post<{ pin: string }>("/v1/vocabulary/battle/create", { setId });
        if (!mounted) return;
        const stateRes = await api.get<BattleStateResponse>(`/v1/vocabulary/battle/${createRes.pin}/state`);
        if (mounted) setBattleState(stateRes);
      } catch {
        if (mounted) setErrorKey("createFailed");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    initBattle();
    return () => {
      mounted = false;
    };
  }, [setId]);

  React.useEffect(() => {
    if (!battleState?.pin || battleState.status === "FINISHED") return;
    const interval = setInterval(async () => {
      try {
        setBattleState(await api.get<BattleStateResponse>(`/v1/vocabulary/battle/${battleState.pin}/state`));
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [battleState?.pin, battleState?.status]);

  // Countdown from the question's own time limit (sent by the server), shown only while a question is open.
  const limit = battleState?.currentQuestion?.timeLimit;
  React.useEffect(() => {
    if (battleState?.status !== "QUESTION" || !limit) {
      setTimeLeft(null);
      return;
    }
    setTimeLeft(limit);
    const timer = setInterval(() => setTimeLeft((prev) => (prev != null && prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [battleState?.status, battleState?.currentQuestionIndex, limit]);

  const handleNextStep = async () => {
    if (!battleState?.pin || isAdvancing) return;
    setIsAdvancing(true);
    try {
      setBattleState(await api.post<BattleStateResponse>(`/v1/vocabulary/battle/${battleState.pin}/next`, {}));
    } catch {
      setErrorKey("nextFailed");
    } finally {
      setIsAdvancing(false);
    }
  };

  const handlePlayAudio = (word: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  };

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-12 text-center text-fg flex flex-col items-center gap-4">
        <RefreshCw className="h-10 w-10 animate-spin text-brand" />
        <h2 className="text-xl font-bold">{t("host.loadingTitle")}</h2>
        <p className="text-sm text-fg-muted">{t("host.loadingBody")}</p>
      </div>
    );
  }

  if (errorMsg && !battleState) {
    return (
      <div className="rounded-3xl border border-danger-border bg-danger-bg p-8 text-danger flex flex-col items-center gap-4">
        <p className="font-semibold">{errorMsg}</p>
        <Button variant="outline" onClick={onClose}>{t("close")}</Button>
      </div>
    );
  }

  if (!battleState) return null;
  const board = battleState.leaderboard;
  const isLastQuestion = battleState.currentQuestionIndex + 1 >= battleState.totalQuestions;

  return (
    <div className="relative rounded-3xl border border-border bg-surface text-fg p-6 md:p-8 shadow-2xl overflow-hidden min-h-[550px] flex flex-col justify-between">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Badge variant="brand" className="text-xs px-2.5 py-1">{t("badge")}</Badge>
          <span className="truncate text-sm font-semibold text-fg-muted">{battleState.setTitle}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-fg-muted bg-bg-subtle px-3 py-1.5 rounded-xl border border-border">
            <Users className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
            <span>{t("host.players", { count: battleState.totalParticipants })}</span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="p-1.5 rounded-xl bg-bg-subtle hover:bg-surface-hover text-fg-muted hover:text-fg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {errorMsg && <p role="alert" className="mt-3 rounded-xl border border-danger-border bg-danger-bg p-2.5 text-sm text-danger">{errorMsg}</p>}

      {battleState.status === "WAITING" && (
        <div className="py-8 flex flex-col items-center justify-center text-center space-y-6">
          <div className="space-y-2">
            <span className="text-sm uppercase tracking-widest text-brand font-semibold">{t("host.pinLabel")}</span>
            <div className="text-6xl md:text-8xl font-black tracking-widest text-fg tabular-nums select-all">{battleState.pin}</div>
            <p className="text-sm text-fg-muted">{t("host.joinHint", { site: "bestwayec.uz/vocabulary" })}</p>
          </div>

          <div className="w-full max-w-2xl bg-bg-subtle border border-border rounded-2xl p-6 min-h-[140px] flex flex-col items-center justify-center">
            {board.length === 0 ? (
              <div className="flex items-center gap-2 text-fg-muted text-sm">
                <RefreshCw className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
                <span>{t("host.waitingJoin")}</span>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2.5">
                {board.map((p) => (
                  <Badge key={p.id} variant="brand" className="text-sm px-3.5 py-1.5 rounded-xl">{p.name}</Badge>
                ))}
              </div>
            )}
          </div>

          <Button
            type="button"
            size="lg"
            onClick={handleNextStep}
            disabled={isAdvancing || battleState.totalParticipants === 0}
            className="font-bold text-base px-8"
          >
            <Play className="mr-2 h-5 w-5 fill-current" />
            {battleState.totalParticipants === 0 ? t("host.waitStudents") : t("host.start")}
          </Button>
        </div>
      )}

      {battleState.status === "QUESTION" && battleState.currentQuestion && (
        <div className="py-6 space-y-6 flex-1 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="neutral" className="text-sm">
              {t("question", { current: battleState.currentQuestionIndex + 1, total: battleState.totalQuestions })}
            </Badge>
            {timeLeft != null && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-warning" aria-hidden="true" />
                <span className={cn("font-mono text-xl font-bold tabular-nums", timeLeft <= 5 ? "text-danger" : "text-warning")}>
                  {t("host.seconds", { count: timeLeft })}
                </span>
              </div>
            )}
            <div className="text-sm text-fg-muted">
              {t("host.answered", { answered: battleState.answeredCount, total: battleState.totalParticipants })}
            </div>
          </div>

          <div className="text-center py-6 space-y-2">
            <div className="inline-flex items-center gap-3">
              <h2 className="text-4xl md:text-5xl font-black text-fg">{battleState.currentQuestion.english}</h2>
              <button
                type="button"
                onClick={() => handlePlayAudio(battleState.currentQuestion?.english || "")}
                className="p-2 rounded-xl bg-bg-subtle hover:bg-brand-subtle text-brand transition-colors"
                aria-label={t("listen")}
                title={t("listen")}
              >
                <Volume2 className="h-6 w-6" />
              </button>
            </div>
            <p className="text-sm text-fg-muted">{t("prompt", { word: battleState.currentQuestion.english })}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {battleState.currentQuestion.options.map((opt, idx) => {
              const col = BATTLE_ANSWER_STYLES[idx % BATTLE_ANSWER_STYLES.length];
              return (
                <div key={idx} className={cn(col.bg, col.text, "p-5 rounded-2xl flex items-center gap-3 shadow-lg")}>
                  <span className="text-2xl" aria-hidden="true">{col.shape}</span>
                  <span className="text-xl font-bold">{opt}</span>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-4">
            <Button type="button" onClick={handleNextStep} disabled={isAdvancing} className="font-bold">
              {t("host.showLeaderboard")}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {battleState.status === "LEADERBOARD" && (
        <div className="py-6 space-y-6 flex-1 flex flex-col justify-between">
          <div className="text-center space-y-1">
            <div className="inline-flex items-center gap-2 text-warning font-bold text-sm uppercase tracking-wider">
              <Trophy className="h-4 w-4" aria-hidden="true" />
              <span>{t("host.leaderboardBadge")}</span>
            </div>
            <h3 className="text-2xl font-black text-fg">{t("host.leaderboardTitle")}</h3>
          </div>

          <ol className="space-y-2.5 max-w-xl mx-auto w-full">
            {board.slice(0, 5).map((p, idx) => {
              const isFirst = idx === 0;
              return (
                <li
                  key={p.id}
                  className={cn(
                    "flex items-center justify-between gap-3 p-3.5 rounded-2xl border",
                    isFirst ? "bg-warning-bg border-warning-border" : "bg-bg-subtle border-border",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "w-7 h-7 shrink-0 rounded-xl flex items-center justify-center font-bold text-sm",
                        isFirst ? "border border-warning-border bg-warning-bg text-warning" : "bg-surface-hover text-fg",
                      )}
                    >
                      {idx + 1}
                    </span>
                    <span className="truncate font-semibold text-base text-fg">{p.name}</span>
                    {p.streak > 1 && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm text-orange bg-orange-subtle px-2 py-0.5 rounded-lg">
                        <Flame className="h-3 w-3 fill-current" aria-hidden="true" />
                        {t("streak", { count: p.streak })}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono font-bold text-lg tabular-nums text-fg">{t("gameScore", { score: p.score })}</span>
                </li>
              );
            })}
          </ol>

          <div className="flex justify-end pt-4">
            <Button type="button" onClick={handleNextStep} disabled={isAdvancing} className="font-bold">
              {isLastQuestion ? t("host.announce") : t("host.nextQuestion")}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {battleState.status === "FINISHED" && (
        <div className="py-8 text-center space-y-8 flex-1 flex flex-col justify-center items-center">
          <div className="space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-warning-bg border border-warning-border text-warning">
              <Crown className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-fg">{t("host.podiumTitle")}</h2>
            <p className="text-sm text-fg-muted">{t("host.podiumNote")}</p>
          </div>

          <ol className="flex items-end justify-center gap-4 max-w-lg w-full pt-6">
            {[1, 0, 2].map((rank) => {
              const p = board[rank];
              if (!p) return null;
              const tone = rank === 0
                ? { box: "h-36 bg-warning-bg border-warning-border", num: "text-3xl text-warning" }
                : rank === 1
                ? { box: "h-28 bg-surface-hover border-border-strong", num: "text-2xl text-fg-muted" }
                : { box: "h-20 bg-orange-subtle border-border", num: "text-xl text-orange" };
              return (
                <li key={p.id} className={cn("flex-1 min-w-0 flex flex-col items-center", rank === 0 && "-mt-6")}>
                  {rank === 0 && <Crown className="h-6 w-6 text-warning mb-1" aria-hidden="true" />}
                  <span className="text-sm font-bold text-fg truncate max-w-full">{p.name}</span>
                  <span className="text-sm text-fg-muted font-mono tabular-nums">{t("gameScore", { score: p.score })}</span>
                  <div className={cn("w-full border rounded-t-2xl flex items-center justify-center mt-2", tone.box)}>
                    <span className={cn("font-black", tone.num)}>{t("host.place", { rank: rank + 1 })}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          <Button type="button" size="lg" onClick={onClose} className="font-bold px-8">{t("host.finishClose")}</Button>
        </div>
      )}
    </div>
  );
}
