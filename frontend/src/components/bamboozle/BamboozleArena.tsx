"use client";

import * as React from "react";
import {
  AlertCircle,
  Bomb,
  CheckCircle,
  Clock,
  Crown,
  Eye,
  Maximize,
  Minimize,
  RefreshCw,
  Sparkles,
  Swords,
  Send,
  Copy,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "motion/react";

export interface BamboozleCard {
  id: string;
  order_index: number;
  card_type: "question" | "swap" | "steal" | "double" | "bomb";
  points: number;
  question_text: string;
  options?: string[];
  correct_answer?: string;
  is_revealed?: boolean;
}

export interface BamboozleArenaProps {
  deckTitle: string;
  category?: string;
  cards: BamboozleCard[];
  roomCode?: string;
  shareUrl?: string;
  telegramShareUrl?: string;
  team1Name?: string;
  team2Name?: string;
  onExit?: () => void;
  onGameEnd?: (winner: { team: number; score: number }) => void;
}

// ============================================================================
// WEB AUDIO API SOUND SYNTHESIZER
// ============================================================================

function createSoundPlayer() {
  let ctx: AudioContext | null = null;

  const getContext = () => {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  };

  return {
    playSuccess: () => {
      const c = getContext();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    },
    playWrong: () => {
      const c = getContext();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.linearRampToValueAtTime(120, now + 0.25);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    },
    playSurprise: () => {
      const c = getContext();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.3);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    },
    playBomb: () => {
      const c = getContext();
      if (!c) return;
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.5);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.55);
    },
  };
}

// ============================================================================
// CANVAS CONFETTI PARTICLE SYSTEM
// ============================================================================

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

    const colors = ["#10B981", "#F59E0B", "#3B82F6", "#EC4899", "#8B5CF6", "#F43F5E", "#EAB308"];
    const particles = Array.from({ length: 90 }).map(() => ({
      x: width * 0.5 + (Math.random() - 0.5) * 120,
      y: height * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 15,
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
      if (elapsed > 2800) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.45; // gravity
        p.rotation += p.rotSpeed;
        p.opacity = Math.max(0, 1 - elapsed / 2800);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
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
      className="pointer-events-none absolute inset-0 z-[60] w-full h-full"
    />
  );
}

export function BamboozleArena({
  deckTitle,
  category = "Umumiy",
  cards: initialCards,
  roomCode,
  shareUrl,
  telegramShareUrl,
  team1Name = "Team 1",
  team2Name = "Team 2",
  onExit,
  onGameEnd,
}: BamboozleArenaProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const soundPlayer = React.useMemo(() => createSoundPlayer(), []);

  // Game state
  const [cards, setCards] = React.useState<BamboozleCard[]>(() =>
    initialCards.map((c, i) => ({ ...c, order_index: i + 1, is_revealed: false }))
  );
  const [activeTeam, setActiveTeam] = React.useState<1 | 2>(1);
  const [team1Score, setTeam1Score] = React.useState(0);
  const [team2Score, setTeam2Score] = React.useState(0);
  const [team1Double, setTeam1Double] = React.useState(false);
  const [team2Double, setTeam2Double] = React.useState(false);

  // Active question modal
  const [activeCard, setActiveCard] = React.useState<BamboozleCard | null>(null);
  const [isAnswerRevealed, setIsAnswerRevealed] = React.useState(false);
  const [timerSeconds, setTimerSeconds] = React.useState(15);
  const [isTimerRunning, setIsTimerRunning] = React.useState(false);

  // Surprise event banner & visual modal
  const [eventNotice, setEventNotice] = React.useState<string | null>(null);
  const [surpriseModal, setSurpriseModal] = React.useState<{
    type: "swap" | "steal" | "double" | "bomb";
    title: string;
    subtitle: string;
    icon: string;
  } | null>(null);
  const [confettiActive, setConfettiActive] = React.useState(false);

  // Smart TV / Projector mode
  const [isProjectorMode, setIsProjectorMode] = React.useState(false);

  // WebSocket State Synchronization with Force-Sync on Reconnect
  const wsRef = React.useRef<WebSocket | null>(null);

  React.useEffect(() => {
    if (!roomCode) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = typeof window !== "undefined" ? window.location.host : "localhost:3000";
      const wsUrl = `${protocol}//${host}/ws/bamboozle/${roomCode}/`;

      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          // FORCE-SYNC TRIGGER: Immediately request latest authoritative full state upon connection or reconnection
          ws?.send(
            JSON.stringify({
              type: "SYNC_STATE",
              room_code: roomCode,
              timestamp: Date.now(),
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "STATE_SYNC" || data.type === "GAME_UPDATE") {
              const room = data.room;
              if (room && !isDisposed) {
                if (typeof room.team1_score === "number") setTeam1Score(room.team1_score);
                if (typeof room.team2_score === "number") setTeam2Score(room.team2_score);
                if (room.active_turn) setActiveTeam(room.active_turn as 1 | 2);
                if (Array.isArray(room.cards) && room.cards.length > 0) {
                  setCards(room.cards);
                }
                if (room.status === "finished") {
                  setGameOver(true);
                }
              }
            }
          } catch (e) {
            console.error("Bamboozle WebSocket message error:", e);
          }
        };

        ws.onclose = () => {
          if (!isDisposed) {
            reconnectTimer = setTimeout(connect, 2000);
          }
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch (_) {
        if (!isDisposed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
        ws = null;
      }
      wsRef.current = null;
    };
  }, [roomCode]);
  const [soundEnabled, setSoundEnabled] = React.useState(true);

  // Game over state
  const [gameOver, setGameOver] = React.useState(false);

  // Timer countdown
  React.useEffect(() => {
    let interval: any;
    if (isTimerRunning && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev - 1);
      }, 1000);
    } else if (timerSeconds === 0 && isTimerRunning) {
      setIsTimerRunning(false);
      if (soundEnabled) soundPlayer.playWrong();
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds, soundEnabled, soundPlayer]);

  // Check if all cards revealed
  React.useEffect(() => {
    const unrevealed = cards.some((c) => !c.is_revealed);
    if (!unrevealed && cards.length > 0 && !gameOver) {
      setGameOver(true);
      const winnerTeam = team1Score > team2Score ? 1 : team2Score > team1Score ? 2 : 0;
      const winnerScore = Math.max(team1Score, team2Score);
      if (soundEnabled) soundPlayer.playSuccess();
      if (onGameEnd) onGameEnd({ team: winnerTeam, score: winnerScore });
    }
  }, [cards, gameOver, team1Score, team2Score, soundEnabled, soundPlayer, onGameEnd]);

  // Handle card click
  const handleCardClick = (card: BamboozleCard) => {
    if (card.is_revealed || activeCard || gameOver) return;

    // Mark card as revealed
    setCards((prev) =>
      prev.map((c) => (c.id === card.id ? { ...c, is_revealed: true } : c))
    );

    if (card.card_type === "question") {
      setActiveCard(card);
      setIsAnswerRevealed(false);
      setTimerSeconds(15);
      setIsTimerRunning(true);
    } else {
      // Process surprise cards immediately
      handleSurpriseCard(card);
    }
  };

  // Process surprise cards: SWAP, STEAL, DOUBLE, BOMB with popup modal & confetti
  const handleSurpriseCard = (card: BamboozleCard) => {
    const isT1 = activeTeam === 1;

    if (card.card_type === "swap") {
      if (soundEnabled) soundPlayer.playSurprise();
      setTeam1Score(team2Score);
      setTeam2Score(team1Score);
      setSurpriseModal({
        type: "swap",
        title: "🔄 BALLAR ALMASHDI!",
        subtitle: `Team 1: ${team2Score} ball ⟷ Team 2: ${team1Score} ball!`,
        icon: "🔄",
      });
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 2500);
      showEventNotice(`🔄 SYURPRIZ: Ballar almashdi! (Team 1: ${team2Score}, Team 2: ${team1Score})`);
      switchTurn();
    } else if (card.card_type === "steal") {
      if (soundEnabled) soundPlayer.playSurprise();
      const stealPts = 15;
      if (isT1) {
        const actualSteal = Math.min(stealPts, team2Score);
        setTeam1Score((s) => s + actualSteal);
        setTeam2Score((s) => Math.max(0, s - actualSteal));
        setSurpriseModal({
          type: "steal",
          title: "🥷 15 BALL O'G'IRLANDI!",
          subtitle: `Team 1 raqibdan +${actualSteal} ball tortib oldi!`,
          icon: "🥷",
        });
        showEventNotice(`🥷 O'G'IRLASH: Team 1 raqibdan +${actualSteal} ball o'g'irladi!`);
      } else {
        const actualSteal = Math.min(stealPts, team1Score);
        setTeam2Score((s) => s + actualSteal);
        setTeam1Score((s) => Math.max(0, s - actualSteal));
        setSurpriseModal({
          type: "steal",
          title: "🥷 15 BALL O'G'IRLANDI!",
          subtitle: `Team 2 raqibdan +${actualSteal} ball tortib oldi!`,
          icon: "🥷",
        });
        showEventNotice(`🥷 O'G'IRLASH: Team 2 raqibdan +${actualSteal} ball o'g'irladi!`);
      }
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 2500);
      switchTurn();
    } else if (card.card_type === "double") {
      if (soundEnabled) soundPlayer.playSurprise();
      if (isT1) {
        setTeam1Double(true);
        showEventNotice(`⚡️ 2X MULTIPLIER: Team 1 uchun keyingi savol 2 barobar ball beradi!`);
      } else {
        setTeam2Double(true);
        showEventNotice(`⚡️ 2X MULTIPLIER: Team 2 uchun keyingi savol 2 barobar ball beradi!`);
      }
      setSurpriseModal({
        type: "double",
        title: "⚡️ 2X MULTIPLIER!",
        subtitle: `Team ${activeTeam} uchun keyingi to'g'ri javob 2 barobar ball keltiradi!`,
        icon: "⚡️",
      });
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 2500);
      switchTurn();
    } else if (card.card_type === "bomb") {
      if (soundEnabled) soundPlayer.playBomb();
      const bombPts = 15;
      if (isT1) {
        setTeam1Score((s) => Math.max(0, s - bombPts));
        showEventNotice(`💣 BOMBA! Team 1 dan -${bombPts} ball ayirildi!`);
      } else {
        setTeam2Score((s) => Math.max(0, s - bombPts));
        showEventNotice(`💣 BOMBA! Team 2 dan -${bombPts} ball ayirildi!`);
      }
      setSurpriseModal({
        type: "bomb",
        title: "💣 BOMBA PORTLADI!",
        subtitle: `Team ${activeTeam} dan -${bombPts} ball ayirildi!`,
        icon: "💣",
      });
      switchTurn();
    }
  };

  const showEventNotice = (msg: string) => {
    setEventNotice(msg);
    setTimeout(() => setEventNotice(null), 3500);
  };

  const switchTurn = () => {
    setActiveTeam((prev) => (prev === 1 ? 2 : 1));
  };

  // Evaluate question answer
  const handleAnswerResult = (isCorrect: boolean) => {
    setIsTimerRunning(false);

    if (activeCard) {
      const isT1 = activeTeam === 1;
      const hasDouble = isT1 ? team1Double : team2Double;
      const mult = hasDouble ? 2 : 1;
      const pts = activeCard.points * mult;

      if (isCorrect) {
        if (soundEnabled) soundPlayer.playSuccess();
        if (isT1) {
          setTeam1Score((s) => s + pts);
          setTeam1Double(false);
        } else {
          setTeam2Score((s) => s + pts);
          setTeam2Double(false);
        }
        showEventNotice(`✅ Team ${activeTeam} +${pts} ball to'pladi!`);
      } else {
        if (soundEnabled) soundPlayer.playWrong();
        showEventNotice(`❌ Team ${activeTeam} noto'g'ri javob berdi.`);
        if (isT1) setTeam1Double(false);
        else setTeam2Double(false);
      }
    }

    setActiveCard(null);
    switchTurn();
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsProjectorMode(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsProjectorMode(false)).catch(() => {});
    }
  };

  const handleRestart = () => {
    setCards(initialCards.map((c, i) => ({ ...c, order_index: i + 1, is_revealed: false })));
    setTeam1Score(0);
    setTeam2Score(0);
    setTeam1Double(false);
    setTeam2Double(false);
    setActiveTeam(1);
    setActiveCard(null);
    setGameOver(false);
    setEventNotice("O'yin qayta boshlandi! Team 1 boshlaydi.");
    setTimeout(() => setEventNotice(null), 2500);
  };

  return (
    <div
      ref={containerRef}
      className={`w-full min-h-[500px] md:min-h-[600px] bg-[#0B0F17] text-white rounded-2xl border border-emerald-500/20 p-4 sm:p-6 pb-12 sm:pb-6 flex flex-col justify-between select-none relative overflow-hidden ${
        isProjectorMode ? "p-8 max-w-full" : ""
      }`}
    >
      {/* Top Bar: Title, Category, Projector Mode & Fullscreen Controls */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Swords className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white drop-shadow">{deckTitle}</h2>
              <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-300 text-xs">
                {category}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">Bamboozle 2-Jamoaviy Bellashuv Rejimi</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="text-slate-400 hover:text-white"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-red-400" />}
          </Button>

          {roomCode && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs">
              <span className="text-slate-400 font-mono">Xona:</span>
              <span className="font-mono font-bold text-emerald-400 tracking-wider">{roomCode}</span>
              {telegramShareUrl && (
                <a
                  href={telegramShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 ml-1 px-2 py-0.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-[11px] shadow-sm transition-all"
                >
                  <Send className="w-3 h-3" />
                  <span>Telegram</span>
                </a>
              )}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setIsProjectorMode(!isProjectorMode)}
            className={`text-xs ${isProjectorMode ? "bg-emerald-500/20 text-emerald-400 font-bold" : "text-slate-400"}`}
          >
            📺 Proyektor Rejimi
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            className="text-slate-400 hover:text-white"
          >
            {isProjectorMode ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </Button>

          {onExit && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onExit}
              className="text-slate-400 hover:text-white ml-2"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Team Scoreboards Banner */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* TEAM 1 (Zumrad / Emerald) */}
        <div
          className={`p-4 rounded-2xl border transition-all ${
            activeTeam === 1
              ? "bg-emerald-950/60 border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.3)] ring-2 ring-emerald-500/40"
              : "bg-slate-900/40 border-slate-800 opacity-75"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
              <h4 className="font-black text-emerald-400 text-lg uppercase tracking-wider">{team1Name || "Team 1"}</h4>
              {team1Double && (
                <Badge variant="neutral" className="bg-amber-500/20 text-amber-300 text-xs font-bold animate-bounce">
                  ⚡️ 2X FAOL
                </Badge>
              )}
            </div>
            {activeTeam === 1 && (
              <span className="text-xs bg-emerald-500 text-slate-950 font-extrabold px-2 py-0.5 rounded-full">
                Navbat
              </span>
            )}
          </div>
          <div className={`font-black text-white font-mono ${isProjectorMode ? "text-5xl" : "text-4xl"}`}>
            {team1Score} <span className="text-xs font-sans text-emerald-400/80">ball</span>
          </div>
        </div>

        {/* TEAM 2 (Amber / Indigo) */}
        <div
          className={`p-4 rounded-2xl border transition-all ${
            activeTeam === 2
              ? "bg-amber-950/60 border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.3)] ring-2 ring-amber-500/40"
              : "bg-slate-900/40 border-slate-800 opacity-75"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
              <h4 className="font-black text-amber-400 text-lg uppercase tracking-wider">{team2Name || "Team 2"}</h4>
              {team2Double && (
                <Badge variant="neutral" className="bg-amber-500/20 text-amber-300 text-xs font-bold animate-bounce">
                  ⚡️ 2X FAOL
                </Badge>
              )}
            </div>
            {activeTeam === 2 && (
              <span className="text-xs bg-amber-500 text-slate-950 font-extrabold px-2 py-0.5 rounded-full">
                Navbat
              </span>
            )}
          </div>
          <div className={`font-black text-white font-mono ${isProjectorMode ? "text-5xl" : "text-4xl"}`}>
            {team2Score} <span className="text-xs font-sans text-amber-400/80">ball</span>
          </div>
        </div>
      </div>

      {/* Surprise Event Toast Notification */}
      {eventNotice && (
        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-emerald-500/20 via-amber-500/20 to-purple-500/20 border border-emerald-500/40 text-center font-bold text-sm text-emerald-200 animate-in fade-in slide-in-from-top-2">
          {eventNotice}
        </div>
      )}

      {/* Cards Grid (16 or 24 Cards) */}
      <div
        className={`grid gap-3 sm:gap-4 my-auto ${
          cards.length <= 16
            ? "grid-cols-4 sm:grid-cols-4"
            : "grid-cols-4 sm:grid-cols-6"
        }`}
      >
        {cards.map((card) => {
          const isRevealed = card.is_revealed;

          return (
            <motion.button
              key={card.id}
              type="button"
              disabled={isRevealed || activeCard !== null || gameOver}
              onClick={() => handleCardClick(card)}
              whileHover={!isRevealed ? { scale: 1.05, y: -2 } : {}}
              whileTap={!isRevealed ? { scale: 0.95 } : {}}
              animate={{
                rotateY: isRevealed ? 180 : 0,
                scale: isRevealed ? 0.96 : 1,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ transformStyle: "preserve-3d" }}
              className={`relative rounded-xl border flex flex-col items-center justify-center font-black transition-colors ${
                isProjectorMode ? "h-28 text-3xl" : "h-20 sm:h-24 text-2xl"
              } ${
                isRevealed
                  ? "bg-slate-900/80 border-slate-700 text-slate-400 cursor-not-allowed opacity-90"
                  : activeTeam === 1
                  ? "bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-950 border-emerald-500/40 text-emerald-300 hover:border-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] cursor-pointer"
                  : "bg-gradient-to-br from-amber-950/80 via-slate-900 to-slate-950 border-amber-500/40 text-amber-300 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] cursor-pointer"
              }`}
            >
              {isRevealed ? (
                <div style={{ transform: "rotateY(180deg)" }} className="flex flex-col items-center justify-center text-xs">
                  {card.card_type === "swap" && (
                    <div className="flex flex-col items-center text-purple-400">
                      <span className="text-xl sm:text-2xl mb-0.5">🔄</span>
                      <span className="font-bold text-[11px]">Almashdi</span>
                    </div>
                  )}
                  {card.card_type === "steal" && (
                    <div className="flex flex-col items-center text-cyan-400">
                      <span className="text-xl sm:text-2xl mb-0.5">🥷</span>
                      <span className="font-bold text-[11px]">O&apos;g&apos;irlandi</span>
                    </div>
                  )}
                  {card.card_type === "double" && (
                    <div className="flex flex-col items-center text-amber-400">
                      <span className="text-xl sm:text-2xl mb-0.5">⚡️</span>
                      <span className="font-bold text-[11px]">2x Multi</span>
                    </div>
                  )}
                  {card.card_type === "bomb" && (
                    <div className="flex flex-col items-center text-red-400">
                      <span className="text-xl sm:text-2xl mb-0.5">💣</span>
                      <span className="font-bold text-[11px]">-15 Bomba</span>
                    </div>
                  )}
                  {card.card_type === "question" && (
                    <div className="flex flex-col items-center text-emerald-400">
                      <CheckCircle className="w-5 h-5 mb-0.5" />
                      <span className="font-mono font-bold text-xs">{card.points}pt</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="font-mono">{card.order_index}</span>
                  <span className="text-[10px] text-slate-400 font-normal">Karta</span>
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

            {/* Fullscreen Confetti Particle Burst */}
      <ConfettiCanvas active={confettiActive} />

      {/* Surprise Event Pop-up Modal */}
      <AnimatePresence>
        {surpriseModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSurpriseModal(null)}
            className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.5, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: -20 }}
              transition={{ type: "spring", damping: 15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md p-8 rounded-3xl bg-gradient-to-b from-slate-900 via-[#0B0F17] to-black border-2 border-amber-500/50 shadow-[0_0_50px_rgba(245,158,11,0.3)] flex flex-col items-center text-center relative"
            >
              <div className="text-6xl mb-3 animate-bounce">{surpriseModal.icon}</div>
              <h3 className="text-2xl font-black text-white mb-2 tracking-wide uppercase">
                {surpriseModal.title}
              </h3>
              <p className="text-sm text-slate-200 mb-6 font-medium max-w-xs leading-relaxed">
                {surpriseModal.subtitle}
              </p>
              <Button
                type="button"
                onClick={() => setSurpriseModal(null)}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black px-8 py-2.5 rounded-xl shadow-lg hover:scale-105 transition-transform"
              >
                Davom etish
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Question Modal */}
      {activeCard && (
        <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-200">
          <div className="w-full max-w-2xl bg-[#0B0F17] border-2 border-emerald-500/50 rounded-2xl p-6 shadow-2xl flex flex-col items-center">
            {/* Header: Turn + Points + Timer */}
            <div className="w-full flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <Badge
                variant="neutral"
                className={`text-sm font-bold ${
                  activeTeam === 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                }`}
              >
                Team {activeTeam} Navbati
              </Badge>

              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-bold">
                <Sparkles className="w-4 h-4" />
                <span>
                  {activeCard.points * ((activeTeam === 1 && team1Double) || (activeTeam === 2 && team2Double) ? 2 : 1)} Ball
                </span>
              </div>

              <div
                className={`flex items-center gap-1.5 text-sm font-mono font-bold transition-all ${
                  timerSeconds <= 5
                    ? "text-red-400 bg-red-500/20 border border-red-500/50 px-2.5 py-1 rounded-full animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.5)] scale-110"
                    : "text-amber-400"
                }`}
              >
                <Clock className={`w-4 h-4 ${timerSeconds <= 5 ? "animate-spin text-red-400" : ""}`} />
                <span className={timerSeconds <= 5 ? "text-red-400 font-black animate-ping-once" : ""}>
                  {timerSeconds}s
                </span>
              </div>
            </div>

            {/* Question Text */}
            <h3 className={`font-black text-white mb-6 ${isProjectorMode ? "text-3xl" : "text-xl sm:text-2xl"}`}>
              {activeCard.question_text}
            </h3>

            {/* Multiple Choice Options (if present) */}
            {activeCard.options && activeCard.options.length > 0 && (
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {activeCard.options.map((opt, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-left text-slate-200 font-medium text-sm"
                  >
                    <span className="font-mono text-emerald-400 mr-2">{String.fromCharCode(65 + i)})</span>
                    {opt}
                  </div>
                ))}
              </div>
            )}

            {/* Revealed Answer Box */}
            {isAnswerRevealed && (
              <div className="w-full p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 mb-6 text-emerald-300 font-bold text-lg animate-in fade-in">
                To&apos;g&apos;ri Javob: <span className="text-white underline">{activeCard.correct_answer || "—"}</span>
              </div>
            )}

            {/* Action Buttons: Reveal Answer / Grade */}
            <div className="w-full flex items-center justify-center gap-4">
              {!isAnswerRevealed ? (
                <Button
                  type="button"
                  onClick={() => setIsAnswerRevealed(true)}
                  className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-2 rounded-xl flex items-center gap-2"
                >
                  <Eye className="w-4 h-4" />
                  <span>Javobni Ko&apos;rish</span>
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={() => handleAnswerResult(true)}
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black px-6 py-3 rounded-xl flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)]"
                  >
                    <CheckCircle className="w-5 h-5" />
                    <span>To&apos;g&apos;ri Javob (+{activeCard.points})</span>
                  </Button>

                  <Button
                    type="button"
                    onClick={() => handleAnswerResult(false)}
                    className="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 font-bold px-6 py-3 rounded-xl flex items-center gap-2"
                  >
                    <X className="w-5 h-5" />
                    <span>Noto&apos;g&apos;ri (0)</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Game Over Celebration Modal */}
      {gameOver && (
        <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-300">
          <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-500/60 flex items-center justify-center text-amber-400 mb-4 shadow-[0_0_40px_rgba(245,158,11,0.4)] animate-bounce">
            <Trophy className="w-14 h-14" />
          </div>

          <h2 className="text-3xl sm:text-4xl font-black text-white mb-2">O&apos;YIN YAKUNLANDI!</h2>

          <p className="text-lg font-bold mb-6">
            {team1Score > team2Score ? (
              <span className="text-emerald-400">🏆 Team 1 G&apos;ALABA QOZONDI!</span>
            ) : team2Score > team1Score ? (
              <span className="text-amber-400">🏆 Team 2 G&apos;ALABA QOZONDI!</span>
            ) : (
              <span className="text-slate-300">🤝 DO&apos;STLIK G&apos;ALABA QOZONDI (DURANG)!</span>
            )}
          </p>

          <div className="flex items-center gap-8 mb-8 p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="text-center">
              <span className="text-xs text-slate-400">Team 1 Balli</span>
              <div className="text-3xl font-black text-emerald-400 font-mono">{team1Score}</div>
            </div>
            <div className="text-2xl font-black text-slate-600">VS</div>
            <div className="text-center">
              <span className="text-xs text-slate-400">Team 2 Balli</span>
              <div className="text-3xl font-black text-amber-400 font-mono">{team2Score}</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              type="button"
              onClick={handleRestart}
              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-6 py-2.5 rounded-xl flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Qayta O&apos;ynash</span>
            </Button>

            {onExit && (
              <Button
                type="button"
                variant="ghost"
                onClick={onExit}
                className="text-slate-400 hover:text-white"
              >
                Chiqish
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
