"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Heart,
  RotateCcw,
  Send,
  Sparkles,
  Trophy,
  Zap,
  Volume2,
  VolumeX,
  Play,
  Pause,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Link } from "@/i18n/navigation";

export interface RunnerQuestion {
  id: string;
  category: string;
  prompt: string;
  correct: string;
  options: string[];
  explanation?: string;
}

interface RunnerMistake {
  prompt: string;
  chosen: string;
  correct: string;
  explanation?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
}

// ---------------------------------------------------------------------------
// Pure Web Audio Synthesizer (No external audio files needed)
// ---------------------------------------------------------------------------
class RunnerSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === "undefined") return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  playJump() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      /* ignore */
    }
  }

  playSlide() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
    } catch {
      /* ignore */
    }
  }

  playCorrectChime() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 (Major chord)
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.05);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.05 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.05);
        osc.stop(ctx.currentTime + idx * 0.05 + 0.35);
      });
    } catch {
      /* ignore */
    }
  }

  playThud() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      /* ignore */
    }
  }

  playGameOver() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const notes = [440, 392, 349.23, 293.66]; // A4, G4, F4, D4
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.4);
      });
    } catch {
      /* ignore */
    }
  }
}

const sounds = new RunnerSoundEngine();

// ---------------------------------------------------------------------------
// Main VocabRunnerGame Component
// ---------------------------------------------------------------------------
export function VocabRunnerGame() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Game Engine State
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isPaused, setIsPaused] = React.useState(false);
  const [isGameOver, setIsGameOver] = React.useState(false);
  const [soundEnabled, setSoundEnabled] = React.useState(true);

  // HUD and Player Stats
  const [score, setScore] = React.useState(0);
  const [highScore, setHighScore] = React.useState(0);
  const [isNewHighScore, setIsNewHighScore] = React.useState(false);
  const [lives, setLives] = React.useState(3);
  const [combo, setCombo] = React.useState(1);
  const [distance, setDistance] = React.useState(0);
  const [correctCount, setCorrectCount] = React.useState(0);
  const [xpEarned, setXpEarned] = React.useState(0);
  const [totalXp, setTotalXp] = React.useState<number | null>(null);
  const [mistakes, setMistakes] = React.useState<RunnerMistake[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);

  // Question Management
  const [questions, setQuestions] = React.useState<RunnerQuestion[]>([]);
  const [currentQIndex, setCurrentQIndex] = React.useState(0);
  const currentQuestion = questions[currentQIndex] || null;

  // Refs for Animation Loop (To avoid closure stale state)
  const animFrameIdRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number>(0);
  const startTimeRef = React.useRef<number>(0);

  // 3-Lane Runner Coordinates: Lane indices -1 (Left), 0 (Center), 1 (Right)
  const playerLaneRef = React.useRef<number>(0);
  const playerCurrentXRef = React.useRef<number>(0);
  const playerStateRef = React.useRef<"run" | "jump" | "slide">("run");
  const jumpProgressRef = React.useRef<number>(0);
  const slideProgressRef = React.useRef<number>(0);

  // Wave / Gates: Approaches from z = 1.0 (horizon) down to z = 0.0 (player)
  const gateZRef = React.useRef<number>(1.0);
  const gateSpeedRef = React.useRef<number>(0.28); // units per second
  const particlesRef = React.useRef<Particle[]>([]);
  const trackOffsetRef = React.useRef<number>(0);
  const screenShakeRef = React.useRef<number>(0);

  // Sync Audio Setting
  React.useEffect(() => {
    sounds.enabled = soundEnabled;
  }, [soundEnabled]);

  // Load High Score from localStorage on mount
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("bestway_runner_highscore");
      if (saved) setHighScore(parseInt(saved, 10) || 0);
    } catch {
      /* ignore */
    }
  }, []);

  // Fetch Questions from API
  const fetchQuestions = React.useCallback(async () => {
    try {
      const res = await apiClient.get<RunnerQuestion[]>("/v1/games/runner/questions?limit=40");
      if (res && Array.isArray(res) && res.length > 0) {
        setQuestions(res);
        return res;
      }
    } catch {
      /* fallback */
    }
    // Hardcoded high-yield fallback questions if offline
    const fallbackList: RunnerQuestion[] = [
      { id: "f1", category: "Irregular Verbs", prompt: "Past Participle: CHOOSE", correct: "Chosen", options: ["Chose", "Chosen", "Choosed"] },
      { id: "f2", category: "Prepositions", prompt: "Interested ___ learning English", correct: "in", options: ["in", "at", "about"] },
      { id: "f3", category: "Collocations", prompt: "Make or Do? ___ a mistake", correct: "Make", options: ["Do", "Make", "Have"] },
      { id: "f4", category: "CEFR B2", prompt: "Synonym of: ABUNDANT", correct: "Plentiful", options: ["Scarce", "Plentiful", "Fragile"] },
      { id: "f5", category: "Irregular Verbs", prompt: "Past Participle: FLY", correct: "Flown", options: ["Flew", "Flown", "Flied"] },
      { id: "f6", category: "Collocations", prompt: "Catch or Take? ___ a cold", correct: "Catch", options: ["Take", "Catch", "Hold"] },
      { id: "f7", category: "CEFR C1", prompt: "Synonym of: METICULOUS", correct: "Thorough", options: ["Careless", "Thorough", "Hasty"] },
      { id: "f8", category: "Prepositions", prompt: "It depends ___ the weather", correct: "on", options: ["from", "on", "of"] },
    ];
    setQuestions(fallbackList);
    return fallbackList;
  }, []);

  React.useEffect(() => {
    void fetchQuestions();
  }, [fetchQuestions]);

  // Spawn particle explosion
  const spawnParticles = (x: number, y: number, color: string, count: number = 20) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 120 + 40;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: Math.random() * 4 + 2,
        alpha: 1.0,
      });
    }
  };

  // Switch Lanes
  const moveLane = React.useCallback((dir: -1 | 1) => {
    if (!isPlaying || isPaused || isGameOver) return;
    const current = playerLaneRef.current;
    const next = Math.max(-1, Math.min(1, current + dir));
    if (next !== current) {
      playerLaneRef.current = next;
    }
  }, [isPlaying, isPaused, isGameOver]);

  // Jump
  const jump = React.useCallback(() => {
    if (!isPlaying || isPaused || isGameOver) return;
    if (playerStateRef.current === "run") {
      playerStateRef.current = "jump";
      jumpProgressRef.current = 0;
      sounds.playJump();
    }
  }, [isPlaying, isPaused, isGameOver]);

  // Slide
  const slide = React.useCallback(() => {
    if (!isPlaying || isPaused || isGameOver) return;
    if (playerStateRef.current === "run") {
      playerStateRef.current = "slide";
      slideProgressRef.current = 0;
      sounds.playSlide();
    }
  }, [isPlaying, isPaused, isGameOver]);

  // Start / Restart Game
  const startGame = React.useCallback(async () => {
    await fetchQuestions();
    setIsPlaying(true);
    setIsPaused(false);
    setIsGameOver(false);
    setIsNewHighScore(false);
    setScore(0);
    setLives(3);
    setCombo(1);
    setDistance(0);
    setCorrectCount(0);
    setXpEarned(0);
    setMistakes([]);
    setCurrentQIndex(0);

    playerLaneRef.current = 0;
    playerCurrentXRef.current = 0;
    playerStateRef.current = "run";
    gateZRef.current = 1.0;
    gateSpeedRef.current = 0.32;
    particlesRef.current = [];
    trackOffsetRef.current = 0;
    screenShakeRef.current = 0;

    startTimeRef.current = Date.now();
    lastTimeRef.current = performance.now();
  }, [fetchQuestions]);

  // Submit Final Score to Backend
  const submitScore = React.useCallback(
    async (finalScore: number, finalDistance: number, finalCorrect: number, recordedMistakes: RunnerMistake[]) => {
      setIsSaving(true);
      const durationSeconds = Math.max(1, (Date.now() - startTimeRef.current) / 1000);
      try {
        const res = await apiClient.post<{
          score: number;
          distance_meters: number;
          correct_count: number;
          xp_earned: number;
          total_xp: number;
          saved: boolean;
        }>("/v1/games/runner/submit-score", {
          score: finalScore,
          distance_meters: finalDistance,
          duration_seconds: durationSeconds,
          correct_count: finalCorrect,
          mistakes: recordedMistakes,
        });

        if (res) {
          setXpEarned(res.xp_earned);
          if (res.total_xp) setTotalXp(res.total_xp);
        }
      } catch {
        // Fallback local XP calculation
        const localXp = Math.min(150, Math.floor(finalScore / 15) + finalCorrect * 5);
        setXpEarned(localXp);
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  // Trigger Game Over
  const triggerGameOver = React.useCallback(
    (finalScore: number, finalDistance: number, finalCorrect: number, recordedMistakes: RunnerMistake[]) => {
      setIsPlaying(false);
      setIsGameOver(true);
      sounds.playGameOver();

      if (finalScore > highScore) {
        setHighScore(finalScore);
        setIsNewHighScore(true);
        try {
          localStorage.setItem("bestway_runner_highscore", String(finalScore));
        } catch {
          /* ignore */
        }
      }

      void submitScore(finalScore, finalDistance, finalCorrect, recordedMistakes);
    },
    [highScore, submitScore]
  );

  // Keyboard Event Handlers
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }

      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        moveLane(-1);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        moveLane(1);
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w" || e.key === " ") {
        jump();
      } else if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
        slide();
      } else if (e.key.toLowerCase() === "p") {
        setIsPaused((p) => !p);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveLane, jump, slide]);

  // Touch / Mobile Swipe Gesture Controls
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < -30) moveLane(-1);
      else if (dx > 30) moveLane(1);
    } else {
      if (dy < -30) jump();
      else if (dy > 30) slide();
    }
  };

  // Main 60 FPS Render & Simulation Loop
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let localScore = score;
    let localLives = lives;
    let localCombo = combo;
    let localDistance = distance;
    let localCorrect = correctCount;
    let localMistakes = [...mistakes];
    let localQIdx = currentQIndex;

    const render = (time: number) => {
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = time;

      const width = canvas.width;
      const height = canvas.height;

      // 1. Simulation Update
      if (isPlaying && !isPaused && !isGameOver) {
        // Track offset & distance
        const currentSpeed = gateSpeedRef.current;
        trackOffsetRef.current = (trackOffsetRef.current + currentSpeed * dt * 4) % 1;
        localDistance += currentSpeed * dt * 60;
        setDistance(Math.floor(localDistance));

        // Player Jump Physics
        if (playerStateRef.current === "jump") {
          jumpProgressRef.current += dt * 2.2;
          if (jumpProgressRef.current >= 1.0) {
            playerStateRef.current = "run";
            jumpProgressRef.current = 0;
          }
        }

        // Player Slide Physics
        if (playerStateRef.current === "slide") {
          slideProgressRef.current += dt * 2.2;
          if (slideProgressRef.current >= 1.0) {
            playerStateRef.current = "run";
            slideProgressRef.current = 0;
          }
        }

        // Smooth Lerp for player X transition
        const targetX = playerLaneRef.current;
        playerCurrentXRef.current += (targetX - playerCurrentXRef.current) * Math.min(dt * 14, 1.0);

        // Move Gates forward
        gateZRef.current -= currentSpeed * dt;

        // Collision Check when gate reaches player (z <= 0.08)
        if (gateZRef.current <= 0.08) {
          const q = questions[localQIdx];
          if (q) {
            const laneOptions = q.options; // 3 options for lanes -1, 0, 1
            const playerLane = playerLaneRef.current;
            const chosenOption = laneOptions[playerLane + 1] || "";
            const isCorrect = chosenOption.trim().toLowerCase() === q.correct.trim().toLowerCase();

            if (isCorrect) {
              sounds.playCorrectChime();
              localScore += 100 * localCombo;
              localCombo += 1;
              localCorrect += 1;
              setScore(localScore);
              setCombo(localCombo);
              setCorrectCount(localCorrect);

              // Particles burst
              spawnParticles(width * (0.5 + playerLane * 0.22), height * 0.72, "#10B981", 30);

              // Slightly ramp up speed for endless runner thrill!
              gateSpeedRef.current = Math.min(0.75, gateSpeedRef.current + 0.015);
            } else {
              sounds.playThud();
              localLives -= 1;
              localCombo = 1;
              setLives(localLives);
              setCombo(1);
              screenShakeRef.current = 14;

              // Record mistake
              const mistakeEntry: RunnerMistake = {
                prompt: q.prompt,
                chosen: chosenOption || "None",
                correct: q.correct,
                explanation: q.explanation,
              };
              localMistakes.push(mistakeEntry);
              setMistakes([...localMistakes]);

              spawnParticles(width * (0.5 + playerLane * 0.22), height * 0.72, "#EF4444", 25);

              if (localLives <= 0) {
                triggerGameOver(localScore, localDistance, localCorrect, localMistakes);
                return;
              }
            }
          }

          // Advance to next question
          localQIdx = (localQIdx + 1) % Math.max(1, questions.length);
          setCurrentQIndex(localQIdx);
          gateZRef.current = 1.0; // Reset gate to horizon
        }

        // Decay screen shake
        if (screenShakeRef.current > 0) {
          screenShakeRef.current = Math.max(0, screenShakeRef.current - dt * 35);
        }
      }

      // 2. Clear Screen
      ctx.save();
      if (screenShakeRef.current > 0) {
        const shakeX = (Math.random() - 0.5) * screenShakeRef.current;
        const shakeY = (Math.random() - 0.5) * screenShakeRef.current;
        ctx.translate(shakeX, shakeY);
      }

      // Deep Obsidian background
      ctx.fillStyle = "#0B0F17";
      ctx.fillRect(0, 0, width, height);

      // Starry sky / Neon grid horizon
      const horizonY = height * 0.36;
      const vanishingX = width * 0.5;

      // Horizon Gradient Glow
      const horizonGlow = ctx.createLinearGradient(0, horizonY - 80, 0, horizonY + 80);
      horizonGlow.addColorStop(0, "transparent");
      horizonGlow.addColorStop(0.5, "rgba(16, 185, 129, 0.22)");
      horizonGlow.addColorStop(1, "transparent");
      ctx.fillStyle = horizonGlow;
      ctx.fillRect(0, horizonY - 80, width, 160);

      // 3. Draw 3-Lane Track with 2.5D Perspective
      const laneWidthBottom = width * 0.26;
      const trackLeftBottom = vanishingX - laneWidthBottom * 1.5;
      const trackRightBottom = vanishingX + laneWidthBottom * 1.5;
      const trackWidthHorizon = width * 0.06;

      // Track Floor
      const floorGrad = ctx.createLinearGradient(0, horizonY, 0, height);
      floorGrad.addColorStop(0, "#0F172A");
      floorGrad.addColorStop(1, "#0B0F17");
      ctx.fillStyle = floorGrad;
      ctx.beginPath();
      ctx.moveTo(vanishingX - trackWidthHorizon * 1.5, horizonY);
      ctx.lineTo(vanishingX + trackWidthHorizon * 1.5, horizonY);
      ctx.lineTo(trackRightBottom, height);
      ctx.lineTo(trackLeftBottom, height);
      ctx.closePath();
      ctx.fill();

      // Moving Grid Ties (Horizontal Track Ties)
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const t = (i / 14 + trackOffsetRef.current / 14) % 1;
        // Exponential depth projection
        const p = Math.pow(t, 2.5);
        const y = horizonY + p * (height - horizonY);
        const curW = (trackWidthHorizon * 3) + p * ((trackRightBottom - trackLeftBottom) - trackWidthHorizon * 3);
        const x1 = vanishingX - curW / 2;
        const x2 = vanishingX + curW / 2;

        ctx.strokeStyle = `rgba(16, 185, 129, ${p * 0.45})`;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
      }

      // Lane Divider Lines
      [-1.5, -0.5, 0.5, 1.5].forEach((laneIndex) => {
        const xBottom = vanishingX + laneIndex * laneWidthBottom;
        const xTop = vanishingX + laneIndex * trackWidthHorizon;

        ctx.strokeStyle = Math.abs(laneIndex) === 1.5 ? "#10B981" : "rgba(16, 185, 129, 0.35)";
        ctx.lineWidth = Math.abs(laneIndex) === 1.5 ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(xTop, horizonY);
        ctx.lineTo(xBottom, height);
        ctx.stroke();
      });

      // 4. Draw Approaching Gates (3 Lanes: -1, 0, 1)
      const gz = gateZRef.current; // 1.0 (horizon) -> 0.0 (player)
      if (gz > 0.02 && gz < 1.0) {
        const gateP = Math.pow(1 - gz, 2.2); // Projection scale 0..1
        const gateY = horizonY + gateP * (height * 0.72 - horizonY);
        const gateScale = 0.2 + gateP * 0.85;

        const q = questions[localQIdx];
        const options = q?.options || ["A", "B", "C"];

        [-1, 0, 1].forEach((lIdx) => {
          const laneX = vanishingX + lIdx * laneWidthBottom * gateP;
          const optText = options[lIdx + 1] || "";
          const isTargetCorrect = q && optText.trim().toLowerCase() === q.correct.trim().toLowerCase();

          // Gate Arch Dimensions
          const gw = 110 * gateScale;
          const gh = 130 * gateScale;

          // Gate Holo Glow
          const gateColor = isTargetCorrect ? "rgba(16, 185, 129, 0.9)" : "rgba(59, 130, 246, 0.85)";
          const gateFill = isTargetCorrect ? "rgba(16, 185, 129, 0.18)" : "rgba(59, 130, 246, 0.12)";

          ctx.fillStyle = gateFill;
          ctx.strokeStyle = gateColor;
          ctx.lineWidth = 3 * gateScale;

          ctx.beginPath();
          ctx.roundRect(laneX - gw / 2, gateY - gh, gw, gh, [14 * gateScale, 14 * gateScale, 0, 0]);
          ctx.fill();
          ctx.stroke();

          // Gate Option Label
          ctx.font = `bold ${Math.max(10, Math.floor(18 * gateScale))}px Inter, sans-serif`;
          ctx.fillStyle = "#FFFFFF";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(optText, laneX, gateY - gh * 0.55);

          // Lane Marker Indicator at bottom
          ctx.font = `bold ${Math.max(8, Math.floor(12 * gateScale))}px monospace`;
          ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          ctx.fillText(`LANE ${lIdx + 2}`, laneX, gateY - gh * 0.2);
        });
      }

      // 5. Draw Player Avatar (Neon Cyber Runner)
      const playerLaneX = vanishingX + playerCurrentXRef.current * laneWidthBottom;
      let playerBaseY = height * 0.76;

      // Jump Arc (Parabola)
      if (playerStateRef.current === "jump") {
        const j = jumpProgressRef.current;
        const jumpH = Math.sin(j * Math.PI) * 110;
        playerBaseY -= jumpH;
      }

      // Player Shadow
      const shadowW = 54 * (playerStateRef.current === "slide" ? 1.4 : 1.0);
      const shadowH = 16;
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.ellipse(playerLaneX, height * 0.78, shadowW / 2, shadowH / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Player Body / Neon Suit
      ctx.save();
      ctx.translate(playerLaneX, playerBaseY);

      if (playerStateRef.current === "slide") {
        // Sliding: Low crouching horizontal capsule
        ctx.fillStyle = "#10B981";
        ctx.shadowColor = "#10B981";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.roundRect(-30, -18, 60, 24, 12);
        ctx.fill();

        // Visor
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(-15, -12, 30, 8);
      } else {
        // Running / Jumping: Upright Cyber Runner
        ctx.shadowColor = "#10B981";
        ctx.shadowBlur = 16;

        // Torso
        ctx.fillStyle = "#10B981";
        ctx.beginPath();
        ctx.roundRect(-16, -56, 32, 42, 8);
        ctx.fill();

        // Head / Helmet
        ctx.fillStyle = "#0F172A";
        ctx.beginPath();
        ctx.arc(0, -68, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Glowing Visor
        ctx.fillStyle = "#38BDF8";
        ctx.shadowColor = "#38BDF8";
        ctx.shadowBlur = 10;
        ctx.fillRect(-9, -71, 18, 6);

        // Running Legs Animation
        const runCycle = Math.sin(time * 0.018);
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";

        // Left Leg
        ctx.beginPath();
        ctx.moveTo(-8, -14);
        ctx.lineTo(-8 + runCycle * 14, 6);
        ctx.stroke();

        // Right Leg
        ctx.beginPath();
        ctx.moveTo(8, -14);
        ctx.lineTo(8 - runCycle * 14, 6);
        ctx.stroke();
      }
      ctx.restore();

      // 6. Draw Particle System
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.alpha -= dt * 1.8;

        if (p.alpha <= 0) {
          particlesRef.current.splice(i, 1);
        } else {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      }

      ctx.restore();

      if (isPlaying && !isPaused && !isGameOver) {
        animFrameIdRef.current = requestAnimationFrame(render);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [isPlaying, isPaused, isGameOver, questions, score, lives, combo, distance, correctCount, mistakes, currentQIndex, triggerGameOver]);

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center select-none">
      {/* Top HUD Header */}
      <div className="mb-3 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-[#0B0F17]/90 px-5 py-3 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-6">
          <Link
            href="/vocabulary"
            className="flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Lug&apos;atga qaytish</span>
          </Link>

          {/* Hearts (Lives) */}
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((heart) => (
              <Heart
                key={heart}
                className={`h-5 w-5 transition-all duration-300 ${
                  heart <= lives
                    ? "fill-red-500 text-red-500 scale-100 filter drop-shadow-[0_0_6px_rgba(239,68,68,0.7)]"
                    : "fill-gray-800 text-gray-800 scale-90"
                }`}
              />
            ))}
          </div>

          {/* Combo Multiplier Badge */}
          {combo > 1 && (
            <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-3 py-0.5 text-xs font-black text-emerald-400 animate-pulse">
              <Zap className="h-3.5 w-3.5 fill-current" />
              <span>COMBO {combo}x</span>
            </div>
          )}
        </div>

        {/* Live Score & Distance */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold tracking-widest text-gray-400">Masofa</span>
            <p className="font-mono text-sm font-bold text-teal-400">{distance} m</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold tracking-widest text-gray-400">Ball</span>
            <p className="font-mono text-xl font-black text-emerald-400">{score}</p>
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            className="rounded-xl border border-white/10 p-2 text-gray-400 hover:bg-white/10 hover:text-white transition"
            title="Ovozni yoqish / o'chirish"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Target Question Floating HUD Card */}
      {isPlaying && !isGameOver && currentQuestion && (
        <div className="mb-3 w-full rounded-2xl border border-emerald-500/30 bg-[#111827]/95 p-4 text-center shadow-2xl backdrop-blur-md animate-fadeIn">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              {currentQuestion.category}
            </span>
            <span className="text-xs text-gray-400 font-mono">
              Savol {currentQIndex + 1}/{questions.length}
            </span>
          </div>
          <h2 className="text-lg md:text-xl font-extrabold text-white tracking-wide">
            {currentQuestion.prompt}
          </h2>
          <p className="mt-1 text-[11px] text-gray-400">
            To&apos;g&apos;ri javob joylashgan yo&apos;lakka (1, 2 yoki 3) o&apos;ting!
          </p>
        </div>
      )}

      {/* Main Canvas Viewport with Touch Listener */}
      <div
        className="relative w-full aspect-[16/9] max-h-[580px] overflow-hidden rounded-3xl border border-white/15 shadow-2xl bg-[#0B0F17]"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          className="h-full w-full object-contain"
        />

        {/* Start / Overlay Screen */}
        {!isPlaying && !isGameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md p-6 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-2xl shadow-emerald-500/40 text-white animate-bounce-slow">
              <Zap className="h-10 w-10 fill-current" />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white mb-2">
              SUBWAY VOCAB RUNNER
            </h1>
            <p className="max-w-md text-xs md:text-sm text-gray-300 leading-relaxed mb-6">
              3 yo&apos;lakli cheksiz yugurish o&apos;yini. CEFR so&apos;z boyligi, noto&apos;g&apos;ri fe&apos;llar va kollokatsiyalarni tezkor yugurish davomida o&apos;rganing va profilingizga +XP to&apos;plang!
            </p>

            <div className="mb-6 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-300">
              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
                ⬅️ ➡️ Yo&apos;lak almashtirish (A / D)
              </span>
              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
                ⬆️ Sakrash (W / Space)
              </span>
              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
                ⬇️ Sirpanish (S)
              </span>
            </div>

            <button
              type="button"
              onClick={() => void startGame()}
              className="inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black px-8 py-4 text-base shadow-2xl shadow-emerald-950/60 transition cursor-pointer hover:scale-105 active:scale-95"
            >
              <Play className="h-5 w-5 fill-current" />
              <span>O&apos;yinni Boshlash</span>
            </button>
          </div>
        )}

        {/* Pause Overlay Screen */}
        {isPlaying && isPaused && !isGameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm p-6 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">O&apos;YIN TO&apos;XTATILDI (PAUSE)</h2>
            <button
              type="button"
              onClick={() => setIsPaused(false)}
              className="rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 text-sm shadow-xl transition"
            >
              Davom ettirish
            </button>
          </div>
        )}

        {/* Game Over Screen */}
        {isGameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-6 text-center overflow-y-auto">
            <div className="w-full max-w-lg rounded-3xl border border-red-500/40 bg-[#0B0F17] p-6 shadow-2xl text-center text-white relative">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 shadow-lg">
                <Trophy className="h-8 w-8 text-amber-400" />
              </div>

              <h2 className="text-2xl font-black text-white mb-1">RUNNER YAKUNLANDI!</h2>

              {isNewHighScore && (
                <div className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-0.5 text-xs font-black text-amber-400 mb-4 animate-bounce">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>YANGI REKORD!</span>
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3 my-4">
                <div className="rounded-2xl bg-[#111827] border border-white/5 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-gray-400">Yakuniy Ball</span>
                  <p className="font-mono text-xl font-black text-emerald-400">{score}</p>
                </div>
                <div className="rounded-2xl bg-[#111827] border border-white/5 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-gray-400">Masofa</span>
                  <p className="font-mono text-xl font-black text-teal-400">{distance}m</p>
                </div>
                <div className="rounded-2xl bg-[#111827] border border-white/5 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-gray-400">To&apos;g&apos;ri so&apos;zlar</span>
                  <p className="font-mono text-xl font-black text-white">{correctCount}</p>
                </div>
              </div>

              {/* XP Awarded Banner */}
              <div className="mb-5 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-emerald-400 fill-current" />
                  <span className="text-xs font-bold text-emerald-300">
                    {isSaving ? "XP hisoblanmoqda..." : `+${xpEarned} XP hisobingizga yozildi!`}
                  </span>
                </div>
                {totalXp !== null && (
                  <span className="text-xs font-mono font-bold text-white">
                    Jami: {totalXp} XP
                  </span>
                )}
              </div>

              {/* Mistakes Review (if any) */}
              {mistakes.length > 0 && (
                <div className="mb-5 max-h-36 overflow-y-auto rounded-2xl bg-[#111827] border border-white/5 p-3 text-left">
                  <span className="text-[10px] uppercase font-bold text-gray-400 block mb-2">
                    Xatolar tahlili ({mistakes.length} ta xato):
                  </span>
                  <div className="space-y-2">
                    {mistakes.map((m, idx) => (
                      <div key={idx} className="flex items-start justify-between border-b border-white/5 pb-1 text-xs">
                        <div>
                          <p className="font-bold text-white">{m.prompt}</p>
                          <p className="text-[11px] text-red-400">Siz: {m.chosen}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-emerald-400">To&apos;g&apos;ri: {m.correct}</p>
                          {m.explanation && <p className="text-[10px] text-gray-400">{m.explanation}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void startGame()}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3 px-4 shadow-xl text-xs md:text-sm transition cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Qayta o&apos;ynash</span>
                </button>

                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent("https://bestwayec.uz/en/vocabulary/runner")}&text=${encodeURIComponent(
                    `⚡️ Subway Vocab Runner'da ${score} ball to'pladim (${distance}m masofa)! Sen ham ingliz tili so'z boyligingni sinab ko'r!`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 font-bold py-3 px-4 text-xs md:text-sm transition cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                  <span>Ulashish</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* On-Screen Mobile Action Buttons */}
      <div className="mt-4 flex w-full items-center justify-between gap-3 md:hidden">
        <button
          type="button"
          onClick={() => moveLane(-1)}
          className="flex-1 flex items-center justify-center rounded-2xl bg-[#111827] border border-white/10 p-4 text-white active:bg-emerald-600/30 transition"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={jump}
          className="flex-1 flex flex-col items-center justify-center rounded-2xl bg-[#111827] border border-white/10 p-4 text-white active:bg-emerald-600/30 transition text-xs font-bold"
        >
          <ArrowUp className="h-6 w-6" />
          <span>Sakrash</span>
        </button>
        <button
          type="button"
          onClick={slide}
          className="flex-1 flex flex-col items-center justify-center rounded-2xl bg-[#111827] border border-white/10 p-4 text-white active:bg-emerald-600/30 transition text-xs font-bold"
        >
          <ArrowDown className="h-6 w-6" />
          <span>Sirpanish</span>
        </button>
        <button
          type="button"
          onClick={() => moveLane(1)}
          className="flex-1 flex items-center justify-center rounded-2xl bg-[#111827] border border-white/10 p-4 text-white active:bg-emerald-600/30 transition"
        >
          <ArrowRight className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
