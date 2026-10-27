"use client";

import * as React from "react";
import {
  Award,
  BookMarked,
  CheckCircle,
  Clock,
  Compass,
  FileQuestion,
  Hash,
  HelpCircle,
  Layers,
  MessageSquare,
  Repeat,
  Scale,
  Shield,
  Sparkles,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";

interface CourseCardThumbnailProps {
  title: string;
  className?: string;
}

export function CourseCardThumbnail({ title, className = "" }: CourseCardThumbnailProps) {
  const lower = title.toLowerCase();

  // 1. NOUN TEST & PRACTICAL ANALYSIS
  if (lower.includes("noun test") || (lower.includes("test") && lower.includes("noun"))) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-indigo-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-indigo-500/25 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[10px] font-black uppercase tracking-wider">
            Practice #2
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <CheckCircle className="w-2.5 h-2.5" /> 100% Mastery
          </span>
        </div>

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

  // 2. NOUNS (COUNTABLE & UNCOUNTABLE)
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

  // 7. PRESENT SIMPLE & CONTINUOUS & PERFECT
  if (lower.includes("present simple") || (lower.includes("present") && !lower.includes("perfect") && !lower.includes("continuous"))) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-teal-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#14b8a6_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider">
            Tense Mastery
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Routine &bull; Facts
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-2 mb-2.5 font-mono">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-teal-500/40 text-xs font-bold text-teal-300">
            S + V1 / V-s
          </div>
          <span className="text-xs text-emerald-400 font-bold">&bull;</span>
          <div className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400 text-xs font-bold text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            Do / Does
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-teal-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Present Simple Tense
        </span>
        <span className="relative z-10 text-[10px] text-teal-300/80 font-medium mt-0.5">
          Habits &bull; Universal Truths &bull; Adverbs of Frequency
        </span>
      </div>
    );
  }

  if (lower.includes("present continuous")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-cyan-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-cyan-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-black uppercase tracking-wider">
            Ongoing Action
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-cyan-400" /> Right Now
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-2 mb-2.5 font-mono">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-cyan-500/40 text-xs font-bold text-cyan-300">
            am / is / are
          </div>
          <span className="text-xs text-cyan-400 font-extrabold">+</span>
          <div className="px-2.5 py-1 rounded-xl bg-cyan-500/20 border border-cyan-400 text-xs font-bold text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]">
            V-ing
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Present Continuous Tense
        </span>
        <span className="relative z-10 text-[10px] text-cyan-300/80 font-medium mt-0.5">
          Actions at Moment of Speech &bull; Temporary Situations
        </span>
      </div>
    );
  }

  if (lower.includes("present perfect continuous")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-emerald-950/90 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Duration Flow
          </span>
          <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Repeat className="w-2.5 h-2.5" /> Since / For
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-emerald-500/40 text-[11px] font-bold text-emerald-300">
            have / has been
          </span>
          <span className="text-xs text-emerald-400 font-extrabold">+</span>
          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-[11px] font-bold text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            V-ing
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-white uppercase tracking-wider text-center">
          Present Perfect Continuous
        </span>
        <span className="relative z-10 text-[10px] text-emerald-400/80 font-medium mt-0.5">
          Duration from Past up to Now &bull; Unfinished Actions
        </span>
      </div>
    );
  }

  if (lower.includes("present perfect")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-emerald-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -bottom-10 -right-10 w-36 h-36 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Past + Present Link
          </span>
          <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5 text-emerald-400" /> Result Now
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-2 mb-2.5 font-mono">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs font-bold text-emerald-300">
            have / has
          </div>
          <span className="text-xs text-emerald-400 font-extrabold">+</span>
          <div className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400 text-xs font-bold text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            V3 / -ed
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-white uppercase tracking-wider text-center">
          Present Perfect Tense
        </span>
        <span className="relative z-10 text-[10px] text-emerald-300/80 font-medium mt-0.5">
          Life Experiences &bull; Already &bull; Just &bull; Yet &bull; Ever
        </span>
      </div>
    );
  }

  // 8. SO / SUCH / TOO / ENOUGH (Lesson #27)
  if (lower.includes("so") && (lower.includes("such") || lower.includes("enough") || lower.includes("too") || lower.includes("confusing"))) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-violet-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-violet-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#8b5cf6_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #27
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Scale className="w-2.5 h-2.5" /> Degree &bull; Intensifiers
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-violet-500/30 text-[11px] font-bold text-violet-300">
            so + adj
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-violet-500/30 text-[11px] font-bold text-violet-300">
            such a + noun
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-violet-500/20 border border-violet-400 text-[11px] font-bold text-white shadow-[0_0_12px_rgba(139,92,246,0.3)]">
            adj + enough
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          So vs Such &bull; Too vs Enough
        </span>
        <span className="relative z-10 text-[10px] text-violet-300/80 font-medium mt-0.5">
          Degree Adverbs &bull; High vs Tall &bull; Confusing Pairs
        </span>
      </div>
    );
  }

  // 9. SOME AND ANY (Lesson #28)
  if (lower.includes("some") && lower.includes("any")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-emerald-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #28
          </span>
          <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider">
            Quantifier Contrast
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-2 mb-2.5 font-mono">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs font-bold text-emerald-300 flex items-center gap-1">
            <span>➕</span> <span>Some</span>
          </div>
          <span className="text-xs text-emerald-400 font-bold">vs</span>
          <div className="px-2.5 py-1 rounded-xl bg-teal-500/20 border border-teal-400 text-xs font-bold text-teal-200 shadow-[0_0_12px_rgba(20,184,166,0.3)] flex items-center gap-1">
            <span>❓/➖</span> <span>Any</span>
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-white uppercase tracking-wider text-center">
          Some vs Any &amp; Compounds
        </span>
        <span className="relative z-10 text-[10px] text-emerald-300/80 font-medium mt-0.5">
          Somebody &bull; Anybody &bull; Polite Requests &bull; Offers
        </span>
      </div>
    );
  }

  // 10. QUESTION TAGS (Lesson #29)
  if (lower.includes("tag") || lower.includes("question tags")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-blue-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-blue-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #29
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <HelpCircle className="w-2.5 h-2.5" /> Confirmation Rules
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono text-xs">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300">
            Positive Statement
          </span>
          <span className="text-emerald-400 font-extrabold">➔</span>
          <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 border border-blue-400 text-blue-300 font-bold shadow-[0_0_12px_rgba(59,130,246,0.3)]">
            , aren&apos;t they?
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Tag Questions / Question Tags
        </span>
        <span className="relative z-10 text-[10px] text-blue-300/80 font-medium mt-0.5">
          Intonation &bull; Imperatives &bull; Special Cases (I am, Let&apos;s)
        </span>
      </div>
    );
  }

  // 11. FUTURE CONTINUOUS (Lesson #7)
  if (lower.includes("future continuous")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-teal-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-teal-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#14b8a6_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider">
            Lesson #7
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Future In-Progress
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-2 mb-2.5 font-mono">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-teal-500/40 text-xs font-bold text-teal-300">
            will be
          </div>
          <span className="text-xs text-emerald-400 font-extrabold">+</span>
          <div className="px-2.5 py-1 rounded-xl bg-teal-500/20 border border-teal-400 text-xs font-bold text-white shadow-[0_0_12px_rgba(20,184,166,0.3)]">
            V-ing
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-teal-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Future Continuous Tense
        </span>
        <span className="relative z-10 text-[10px] text-teal-300/80 font-medium mt-0.5">
          Action in progress at specific point in future
        </span>
      </div>
    );
  }

  // 12. CONDITIONALS & IF CLAUSES
  if (lower.includes("if") || lower.includes("conditional")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-indigo-950/80 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -bottom-10 -right-10 w-36 h-36 rounded-full bg-indigo-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[10px] font-black uppercase tracking-wider">
            Logic &amp; Hypotheses
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Types 0 &bull; 1 &bull; 2 &bull; 3
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono text-xs">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-indigo-500/40 text-indigo-300 font-bold">
            If + Condition
          </span>
          <span className="text-emerald-400 font-extrabold">➔</span>
          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-white font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            Result Clause
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Conditional Clauses (If)
        </span>
        <span className="relative z-10 text-[10px] text-indigo-300/80 font-medium mt-0.5">
          Zero &bull; First &bull; Second &bull; Third &bull; Mixed Conditionals
        </span>
      </div>
    );
  }

  // 13. PASSIVE VOICE
  if (lower.includes("passive")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-emerald-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Focus on Action
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-700/50 border border-slate-600 text-slate-300 text-[10px] font-black uppercase tracking-wider">
            Agent by...
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-2 mb-2.5 font-mono">
          <div className="px-2.5 py-1 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs font-bold text-emerald-300">
            Object + to be
          </div>
          <span className="text-xs text-emerald-400 font-extrabold">+</span>
          <div className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-400 text-xs font-bold text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            V3 / Participle
          </div>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-200 to-white uppercase tracking-wider text-center">
          Passive Voice Mastery
        </span>
        <span className="relative z-10 text-[10px] text-emerald-400/80 font-medium mt-0.5">
          All Tenses &bull; Impersonal Passive &bull; Causative Form
        </span>
      </div>
    );
  }

  // 14. MODAL VERBS
  if (lower.includes("modal")) {
    return (
      <div
        className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-amber-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
      >
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-amber-500/25 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#f59e0b_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-black uppercase tracking-wider">
            Modality &bull; Attitude
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
            Ability &bull; Obligation
          </span>
        </div>

        <div className="relative z-10 flex items-center gap-1.5 mb-2.5 font-mono text-xs">
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 font-bold">
            Can / Must
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-amber-500/40 text-amber-300 font-bold">
            Should / May
          </span>
          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            + Bare Inf
          </span>
        </div>

        <span className="relative z-10 text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-emerald-200 to-white uppercase tracking-wider text-center">
          Modal Verbs &amp; Semi-Modals
        </span>
        <span className="relative z-10 text-[10px] text-amber-300/80 font-medium mt-0.5">
          Certainty &bull; Permission &bull; Past Modals (should have done)
        </span>
      </div>
    );
  }

  // 15. DEFAULT / TOPIC FALLBACK (Obsidian-Emerald Luxury Style)
  return (
    <div
      className={`relative size-full overflow-hidden bg-gradient-to-br from-[#0B0F17] via-emerald-950/70 to-slate-950 flex flex-col items-center justify-center p-4 select-none ${className}`}
    >
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-teal-500/20 blur-2xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-15" />

      <div className="relative z-10 flex items-center gap-1.5 mb-2.5">
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
          Grammar Masterclass
        </span>
        <span className="px-2 py-0.5 rounded-full bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
          <Sparkles className="w-2.5 h-2.5" /> CEFR Standard
        </span>
      </div>

      <div className="relative z-10 w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 mb-2 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
        <div className="size-full rounded-2xl bg-[#0B0F17] flex items-center justify-center text-emerald-400">
          <BookMarked className="w-6 h-6" />
        </div>
      </div>

      <span className="relative z-10 text-xs font-black text-white tracking-wide uppercase line-clamp-1 max-w-[85%] text-center">
        {title}
      </span>
      <span className="relative z-10 text-[10px] text-emerald-400/90 font-medium mt-0.5">
        Interactive Video &bull; Solo Test &bull; Arena
      </span>
    </div>
  );
}
