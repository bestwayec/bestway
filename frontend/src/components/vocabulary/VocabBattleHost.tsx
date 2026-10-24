"use client";

import * as React from "react";
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  Flame,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
  X,
  Volume2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

const OPTION_COLORS = [
  { bg: "bg-red-600 hover:bg-red-500", border: "border-red-500/30", text: "text-white", shape: "🔺" },
  { bg: "bg-blue-600 hover:bg-blue-500", border: "border-blue-500/30", text: "text-white", shape: "🔷" },
  { bg: "bg-amber-600 hover:bg-amber-500", border: "border-amber-500/30", text: "text-white", shape: "🟡" },
  { bg: "bg-emerald-600 hover:bg-emerald-500", border: "border-emerald-500/30", text: "text-white", shape: "🟢" },
];

export function VocabBattleHost({ setId, onClose }: VocabBattleHostProps) {
  const [battleState, setBattleState] = React.useState<BattleStateResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isAdvancing, setIsAdvancing] = React.useState(false);
  const [timeLeft, setTimeLeft] = React.useState(15);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Initialize session
  React.useEffect(() => {
    let mounted = true;
    async function initBattle() {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const createRes = await api.post<any>("/v1/vocabulary/battle/create", { setId });
        if (!mounted) return;
        const stateRes = await api.get<BattleStateResponse>(`/v1/vocabulary/battle/${createRes.pin}/state`);
        if (mounted) setBattleState(stateRes);
      } catch (err: any) {
        if (mounted) setErrorMsg(err.message || "Bellashuvni yaratishda xatolik yuz berdi");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    initBattle();
    return () => {
      mounted = false;
    };
  }, [setId]);

  // Polling state
  React.useEffect(() => {
    if (!battleState?.pin || battleState.status === "FINISHED") return;

    const interval = setInterval(async () => {
      try {
        const state = await api.get<BattleStateResponse>(`/v1/vocabulary/battle/${battleState.pin}/state`);
        setBattleState(state);
      } catch (e) {
        console.error("Polling error", e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [battleState?.pin, battleState?.status]);

  // Timer countdown during QUESTION state
  React.useEffect(() => {
    if (battleState?.status !== "QUESTION") {
      setTimeLeft(15);
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [battleState?.status, battleState?.currentQuestionIndex]);

  const handleNextStep = async () => {
    if (!battleState?.pin || isAdvancing) return;
    setIsAdvancing(true);
    try {
      const state = await api.post<BattleStateResponse>(`/v1/vocabulary/battle/${battleState.pin}/next`, {});
      setBattleState(state);
      setTimeLeft(15);
    } catch (err: any) {
      setErrorMsg(err.message || "Keyingi bosqichga o'tishda xatolik");
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
      <div className="rounded-3xl border border-white/10 bg-[#0B0F17] p-12 text-center text-foreground flex flex-col items-center gap-4">
        <RefreshCw className="h-10 w-10 animate-spin text-emerald-500" />
        <h2 className="text-xl font-bold">Jonli Vocab Battle xonasi tayyorlanmoqda...</h2>
        <p className="text-sm text-muted-foreground">Savollar generatsiya qilinib, PIN-kod olinmoqda</p>
      </div>
    );
  }

  if (errorMsg && !battleState) {
    return (
      <div className="rounded-3xl border border-destructive/20 bg-destructive/10 p-8 text-destructive flex flex-col items-center gap-4">
        <p className="font-semibold">{errorMsg}</p>
        <Button variant="outline" onClick={onClose}>Yopish</Button>
      </div>
    );
  }

  if (!battleState) return null;

  return (
    <div className="relative rounded-3xl border border-white/10 bg-[#0B0F17] text-white p-6 md:p-8 shadow-2xl overflow-hidden min-h-[550px] flex flex-col justify-between">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-1">
            ⚡️ LIVE VOCAB BATTLE
          </Badge>
          <span className="text-sm font-semibold text-muted-foreground">{battleState.setTitle}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-white/5 px-3 py-1.5 rounded-xl border border-white/10">
            <Users className="h-3.5 w-3.5 text-emerald-400" />
            <span>{battleState.totalParticipants} nafar o'quvchi</span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* STAGE 1: WAITING LOBBY */}
      {battleState.status === "WAITING" && (
        <div className="py-8 flex flex-col items-center justify-center text-center space-y-6">
          <div className="space-y-2">
            <span className="text-xs uppercase tracking-widest text-emerald-400 font-semibold">
              O'quvchilar ulanishi uchun PIN-kod
            </span>
            <div className="text-6xl md:text-8xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500 drop-shadow-md select-all">
              {battleState.pin}
            </div>
            <p className="text-sm text-muted-foreground">
              Sayt: <span className="text-white font-mono font-bold">bestwayec.uz/vocabulary</span> yoki PIN orqali ulaning
            </p>
          </div>

          {/* Participant chips */}
          <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-6 min-h-[140px] flex flex-col items-center justify-center">
            {battleState.leaderboard.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
                <span>O'quvchilar ulanishi kutilmoqda...</span>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2.5">
                {battleState.leaderboard.map((p) => (
                  <Badge
                    key={p.id}
                    className="bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 text-sm px-3.5 py-1.5 rounded-xl shadow-sm"
                  >
                    👤 {p.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <Button
            type="button"
            size="lg"
            onClick={handleNextStep}
            disabled={isAdvancing || battleState.totalParticipants === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base px-8 py-6 rounded-2xl shadow-xl shadow-emerald-950/50 hover:scale-105 active:scale-95 transition-all"
          >
            <Play className="mr-2 h-5 w-5 fill-current" />
            {battleState.totalParticipants === 0 ? "O'quvchilarni kuting..." : "Bellashuvni Boshlash 🚀"}
          </Button>
        </div>
      )}

      {/* STAGE 2: QUESTION SCREEN */}
      {battleState.status === "QUESTION" && battleState.currentQuestion && (
        <div className="py-6 space-y-6 flex-1 flex flex-col justify-between">
          {/* Question progress and timer */}
          <div className="flex items-center justify-between">
            <Badge variant="neutral" className="text-xs text-muted-foreground border-white/10">
              Savol {battleState.currentQuestionIndex + 1} / {battleState.totalQuestions}
            </Badge>

            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" />
              <span className={`font-mono text-xl font-bold ${timeLeft <= 5 ? "text-red-400 animate-pulse" : "text-amber-400"}`}>
                {timeLeft}s
              </span>
            </div>

            <div className="text-xs text-muted-foreground">
              Javob berdi: <strong className="text-emerald-400">{battleState.answeredCount}</strong> / {battleState.totalParticipants}
            </div>
          </div>

          {/* Big English Word */}
          <div className="text-center py-6 space-y-2">
            <div className="inline-flex items-center gap-3">
              <h2 className="text-4xl md:text-5xl font-black text-white capitalize">
                {battleState.currentQuestion.english}
              </h2>
              <button
                type="button"
                onClick={() => handlePlayAudio(battleState.currentQuestion?.english || "")}
                className="p-2 rounded-xl bg-white/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-colors"
                title="Talaffuz"
              >
                <Volume2 className="h-6 w-6" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">{battleState.currentQuestion.prompt}</p>
          </div>

          {/* 4 Colored Option Tiles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {battleState.currentQuestion.options.map((opt, idx) => {
              const col = OPTION_COLORS[idx % OPTION_COLORS.length];
              return (
                <div
                  key={idx}
                  className={`${col.bg} ${col.border} ${col.text} border p-5 rounded-2xl flex items-center justify-between shadow-lg transition-transform`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{col.shape}</span>
                    <span className="text-xl font-bold">{opt}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Next Button */}
          <div className="flex justify-end pt-4">
            <Button
              type="button"
              onClick={handleNextStep}
              disabled={isAdvancing}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-emerald-950/40"
            >
              Natijalarni Ko'rsatish (Leaderboard) 📊
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 3: LEADERBOARD SCREEN */}
      {battleState.status === "LEADERBOARD" && (
        <div className="py-6 space-y-6 flex-1 flex flex-col justify-between">
          <div className="text-center space-y-1">
            <div className="inline-flex items-center gap-2 text-amber-400 font-bold text-sm uppercase tracking-wider">
              <Trophy className="h-4 w-4" />
              <span>Savol yakuni bo'yicha Leaderboard</span>
            </div>
            <h3 className="text-2xl font-black text-white">Eng Tezkor O'quvchilar</h3>
          </div>

          {/* Top Leaderboard bars */}
          <div className="space-y-2.5 max-w-xl mx-auto w-full">
            {battleState.leaderboard.slice(0, 5).map((p, idx) => {
              const isFirst = idx === 0;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                    isFirst
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                      : "bg-white/5 border-white/10 text-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs ${
                      isFirst ? "bg-amber-500 text-black" : "bg-white/10 text-white"
                    }`}>
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-base">{p.name}</span>
                    {p.streak > 1 && (
                      <span className="inline-flex items-center gap-1 text-xs text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-lg">
                        <Flame className="h-3 w-3 fill-current" />
                        {p.streak} streak
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold text-lg">{p.score} ball</span>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-4">
            <Button
              type="button"
              onClick={handleNextStep}
              disabled={isAdvancing}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-emerald-950/40"
            >
              {battleState.currentQuestionIndex + 1 >= battleState.totalQuestions
                ? "G'oliblarni E'lon Qilish (Podium) 🏆"
                : "Keyingi Savol ➡️"}
            </Button>
          </div>
        </div>
      )}

      {/* STAGE 4: FINISHED PODIUM */}
      {battleState.status === "FINISHED" && (
        <div className="py-8 text-center space-y-8 flex-1 flex flex-col justify-center items-center">
          <div className="space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400">
              <Crown className="h-8 w-8" />
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white">G'oliblar Podium Shoxsupasi!</h2>
            <p className="text-sm text-muted-foreground">
              1, 2 va 3-o'rin sohiblariga avtomatik +10, +7, +5 platforma ballari taqdim etildi! 🎉
            </p>
          </div>

          {/* Podium layout */}
          <div className="flex items-end justify-center gap-4 max-w-lg w-full pt-6">
            {/* 2nd Place */}
            {battleState.leaderboard[1] && (
              <div className="flex-1 flex flex-col items-center">
                <span className="text-sm font-bold text-slate-300 truncate max-w-[100px]">
                  {battleState.leaderboard[1].name}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{battleState.leaderboard[1].score} b</span>
                <div className="w-full h-28 bg-slate-700/60 border border-slate-500/30 rounded-t-2xl flex flex-col items-center justify-center mt-2">
                  <span className="text-2xl font-bold text-slate-300">2</span>
                  <Badge className="bg-slate-500/20 text-slate-300 border-none text-[10px] mt-1">+7 ball</Badge>
                </div>
              </div>
            )}

            {/* 1st Place */}
            {battleState.leaderboard[0] && (
              <div className="flex-1 flex flex-col items-center -mt-6">
                <Crown className="h-6 w-6 text-amber-400 mb-1 animate-bounce" />
                <span className="text-base font-black text-amber-300 truncate max-w-[120px]">
                  {battleState.leaderboard[0].name}
                </span>
                <span className="text-xs text-amber-400 font-mono font-bold">{battleState.leaderboard[0].score} ball</span>
                <div className="w-full h-36 bg-amber-500/20 border border-amber-500/40 rounded-t-2xl flex flex-col items-center justify-center mt-2 shadow-xl shadow-amber-950/40">
                  <span className="text-3xl font-black text-amber-400">1</span>
                  <Badge className="bg-amber-500/30 text-amber-300 border-none text-xs mt-1 font-bold">+10 ball</Badge>
                </div>
              </div>
            )}

            {/* 3rd Place */}
            {battleState.leaderboard[2] && (
              <div className="flex-1 flex flex-col items-center">
                <span className="text-sm font-bold text-amber-600 truncate max-w-[100px]">
                  {battleState.leaderboard[2].name}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{battleState.leaderboard[2].score} b</span>
                <div className="w-full h-20 bg-amber-800/40 border border-amber-700/30 rounded-t-2xl flex flex-col items-center justify-center mt-2">
                  <span className="text-xl font-bold text-amber-600">3</span>
                  <Badge className="bg-amber-700/20 text-amber-400 border-none text-[10px] mt-1">+5 ball</Badge>
                </div>
              </div>
            )}
          </div>

          <Button
            type="button"
            size="lg"
            onClick={onClose}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-3 rounded-2xl shadow-xl shadow-emerald-950/40"
          >
            Bellashuvni Yakunlash ✅
          </Button>
        </div>
      )}
    </div>
  );
}
