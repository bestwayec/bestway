"use client";

import * as React from "react";
import {
  Award,
  BookMarked,
  CheckCircle,
  Hash,
  Layers,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

interface CourseCardThumbnailProps {
  title: string;
  className?: string;
}

export function CourseCardThumbnail({ title, className = "" }: CourseCardThumbnailProps) {
  const lower = title.toLowerCase();

  // 2. NOUN TEST & PRACTICAL ANALYSIS
  if (lower.includes("noun test") || (lower.includes("test") && lower.includes("noun"))) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-indigo-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        {/* Glow Effects */}
        <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-indigo-500/25 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        {/* Header Tags */}
        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[10px] font-black uppercase tracking-wider">
            Practice #2
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <CheckCircle className="w-2.5 h-2.5" /> 100% Mastery
          </span>
        </div>

        {/* Center Badge Graphic */}
        <div className="relative z-10 flex items-center justify-center mb-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-emerald-400 p-0.5 shadow-[0_0_25px_rgba(99,102,241,0.35)]">
            <div className="size-full rounded-2xl bg-[#0B0F17] flex flex-col items-center justify-center">
              <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-emerald-300">
                A+
              </span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">
                Analysis
              </span>
            </div>
          </div>
        </div>

        <span className="relative z-10 text-xs font-black text-white tracking-wider uppercase text-center">
          Noun Test &amp; Exam Review
        </span>
        <span className="relative z-10 text-[10px] text-indigo-300/80 font-medium mt-0.5">
          Irregular Plurals &bull; Tricky Exceptions
        </span>
      </div>
    );
  }

  // 1. NOUNS (COUNTABLE & UNCOUNTABLE)
  if (lower.includes("noun")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-emerald-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #1
          </span>
          <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider">
            Core Foundation
          </span>
        </div>

        {/* Concept Visual Pill */}
        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900/90 border border-emerald-500/40 shadow-sm flex items-center gap-1.5">
            <span className="text-sm">📦</span>
            <span className="text-[11px] font-black text-emerald-300">Singular</span>
          </div>
          <span className="text-xs text-emerald-400 font-extrabold">➔</span>
          <div className="px-2.5 py-1 rounded-xl bg-slate-900/90 border border-teal-500/40 shadow-sm flex items-center gap-1.5">
            <span className="text-sm">📚</span>
            <span className="text-[11px] font-black text-teal-300">Plural (-s/-es)</span>
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-white uppercase tracking-wider text-center">
          Nouns &bull; Plurals &bull; Quantifiers
        </span>
        <span className="relative z-10 text-[10px] text-emerald-400/80 font-medium mt-0.5">
          Much vs Many &bull; Uncountable Rules
        </span>
      </div>
    );
  }

  // 3. ADJECTIVES (COMPARISON & DEGREES)
  if (lower.includes("adjective") || lower.includes("sifat")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-amber-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-amber-500/25 blur-2xl pointer-events-none" />
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#f59e0b_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #3
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            OSASCOMP Order
          </span>
        </div>

        {/* Visual 3-tier step */}
        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700 text-[10px] font-semibold text-slate-300">
            Good
          </span>
          <span className="text-[10px] text-amber-400 font-black">➔</span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-amber-500/40 text-[10px] font-bold text-amber-300">
            Better
          </span>
          <span className="text-[10px] text-amber-400 font-black">➔</span>
          <span className="px-2.5 py-0.5 rounded-lg bg-gradient-to-r from-amber-500 to-emerald-500 text-slate-950 text-[10px] font-black shadow-[0_0_15px_rgba(245,158,11,0.4)]">
            ★ Best
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Degrees of Comparison
        </span>
        <span className="relative z-10 text-[10px] text-amber-300/80 font-medium mt-0.5">
          Positive &bull; Comparative &bull; Superlative
        </span>
      </div>
    );
  }

  // 4. ADVERBS (FORMATION & USAGE)
  if (lower.includes("adverb") || lower.includes("ravish")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-cyan-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-cyan-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #4
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-cyan-400" /> Dynamic Usage
          </span>
        </div>

        {/* Visual Suffix Formula */}
        <div className="relative z-10 flex items-center gap-2 mb-2.5">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-cyan-500/30 text-[11px] font-mono font-bold text-cyan-300 flex items-center gap-1">
            <span>Quick</span>
            <span className="text-emerald-400 font-black">+ly</span>
          </div>
          <span className="text-xs text-cyan-400 font-extrabold">➔</span>
          <div className="px-2.5 py-1 rounded-xl bg-cyan-500/20 border border-cyan-400 text-[11px] font-bold text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            ⚡️ Quickly
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Adverbs &amp; Sentence Positions
        </span>
        <span className="relative z-10 text-[10px] text-cyan-300/80 font-medium mt-0.5">
          Irregulars: Fast &bull; Hard &bull; Late &bull; Well
        </span>
      </div>
    );
  }

  // 5. NUMERALS (CARDINAL, ORDINAL & FRACTIONS)
  if (lower.includes("numeral") || lower.includes("sonlar") || lower.includes("fraction")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-purple-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-purple-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#a855f7_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #5
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Hash className="w-2.5 h-2.5" /> Mathematics &bull; Dates
          </span>
        </div>

        {/* Visual Numerals Matrix */}
        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-purple-500/30 text-[11px] font-bold text-purple-300">
            1st &bull; 2nd
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">
            2/3 &bull; 3.75
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-purple-500/20 border border-purple-400 text-[11px] font-bold text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]">
            40th
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Cardinal, Ordinal &amp; Fractions
        </span>
        <span className="relative z-10 text-[10px] text-purple-300/80 font-medium mt-0.5">
          Hundreds vs Hundreds of &bull; Decimals
        </span>
      </div>
    );
  }

  // 6. ARTICLES (A, AN, THE & ZERO ARTICLE)
  if (lower.includes("article") || lower.includes("artikl")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-rose-950/60 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -bottom-10 -right-10 w-36 h-36 rounded-full bg-rose-500/25 blur-2xl pointer-events-none" />
        <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#f43f5e_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #6
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            A, An, The &bull; Zero
          </span>
        </div>

        {/* 4 Prominent Articles Tiles */}
        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-black text-slate-300">
            A
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-black text-slate-300">
            AN
          </span>
          <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-xs font-black text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            THE
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 border border-rose-400 text-xs font-bold text-rose-300">
            Ø Zero
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-rose-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Definite &amp; Indefinite Articles
        </span>
        <span className="relative z-10 text-[10px] text-rose-300/80 font-medium mt-0.5">
          Geographical Names &bull; Unique Objects
        </span>
      </div>
    );
  }

  // DEFAULT / TOPIC FALLBACK
  return (
    <div
      className={`relative size-full overflow-hidden bg-gradient-to-br from-emerald-950/60 via-[#0B0F17] to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
    >
      <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mb-2 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
        <BookMarked className="w-6 h-6" />
      </div>
      <span className="text-xs font-bold text-white tracking-wide uppercase line-clamp-1 max-w-[80%] text-center">
        {title}
      </span>
      <span className="text-[10px] text-emerald-400/80 font-medium mt-0.5">
        Video Lesson &bull; LMS Track
      </span>
    </div>
  );
}
