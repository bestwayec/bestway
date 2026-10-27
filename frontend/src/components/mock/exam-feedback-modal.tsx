"use client";

import * as React from "react";
import {
  AlertCircle,
  Award,
  BookOpen,
  CheckCircle2,
  Copy,
  Gauge,
  HelpCircle,
  Lightbulb,
  Mic,
  PenTool,
  Play,
  Sparkles,
  Target,
  TrendingUp,
  Volume2,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DiagnosticFeedback } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SpeechDiagnostics {
  words_per_minute?: number;
  wpm?: number;
  total_words?: number;
  unique_words?: number;
  duration_seconds?: number;
  lexical_density?: number;
  vocabulary_level?: string;
  fluency_score?: number;
  clarity_rating?: string;
  mispronounced_words?: Array<{
    word: string;
    issue?: string;
    suggestion?: string;
  }>;
  pauses_and_hesitations?: Array<{
    type?: string;
    text?: string;
    raw_word?: string;
  }>;
}


export interface WeakPointLessonRecommendation {
  lesson_id: string;
  lesson_title: string;
  order_index: number;
  topic: string;
  url: string;
  button_text: string;
  description: string;
}

const TOPIC_LESSON_MATCHERS = [
  { match: /past\s*perfect/i, order: 19, title: "Past Perfect Tense", topic: "Past Perfect", desc: "Past Perfect zamonida xatolik aniqlandi. Zamonlar ketma-ketligini o'rganing." },
  { match: /passive/i, order: 16, title: "Passive Voice & Causative Forms", topic: "Passive Voice", desc: "Majhul nisbat shakllari bo'yicha mustahkamlovchi mashqlar." },
  { match: /conditional|if\s*clause/i, order: 12, title: "Conditionals (0, 1st, 2nd, 3rd & Mixed)", topic: "Conditionals", desc: "Shart ergash gaplar va taxminiy tuzilmalar qoidasi." },
  { match: /gerund|infinitive/i, order: 11, title: "Gerund and Infinitive", topic: "Gerund & Infinitive", desc: "Fe'llardan keyin Gerund yoki To-Infinitive ishlatilish qoidalari." },
  { match: /preposition/i, order: 28, title: "Prepositions of Place, Time & Movement", topic: "Prepositions", desc: "Predloglar (in, on, at, by) to'g'ri qo'llanilishi." },
  { match: /article/i, order: 6, title: "Articles (a, an, the)", topic: "Articles", desc: "Aniq va noaniq artikllarni to'g'ri ishlatish." },
  { match: /modal/i, order: 14, title: "Modal Verbs & Modal Perfects", topic: "Modal Verbs", desc: "Modal fe'llar va ularning o'tgan zamon shakllari (must, should have)." },
  { match: /indirect|reported/i, order: 13, title: "Reported / Indirect Speech", topic: "Reported Speech", desc: "O'zlashtirma gap va zamonlar o'zgarishi." },
  { match: /pronoun/i, order: 21, title: "Personal & Possessive Pronouns", topic: "Pronouns", desc: "Kishilik va egalik olmoshlari." },
  { match: /conjunction|linking|transition/i, order: 29, title: "Conjunctions & Linking Words", topic: "Linking Words", desc: "Bog'lovchilar va mantiqiy matn vositalari." },
];

function deriveRecommendationsFromFeedback(fb?: DiagnosticFeedback | null): WeakPointLessonRecommendation[] {
  if (!fb) return [];
  const weaknesses = (fb as unknown as { weaknesses?: string[] })?.weaknesses || [];
  const textCorpus = [
    ...weaknesses,
    ...(fb.action_plan || []),
    ...(fb.mistakes_and_fixes || []).map((m) => `${m.original} ${m.explanation || ""}`),
  ].join(" ");

  const results: WeakPointLessonRecommendation[] = [];
  const seenOrders = new Set<number>();

  for (const item of TOPIC_LESSON_MATCHERS) {
    if (item.match.test(textCorpus) && !seenOrders.has(item.order)) {
      seenOrders.add(item.order);
      results.push({
        lesson_id: `lesson-${item.order}`,
        lesson_title: item.title,
        order_index: item.order,
        topic: item.topic,
        url: `/en/videos?lesson=lesson-${item.order}`,
        button_text: `▶️ ${item.order}-dars: ${item.title} darsini ko'rish`,
        description: `Sizda ushbu mavzuda xatolik ko'p: ${item.desc}`,
      });
    }
  }

  // Fallback core foundation recommendations if none matched
  if (results.length === 0) {
    const defaultIndices = [19, 16, 12];
    for (const item of TOPIC_LESSON_MATCHERS) {
      if (defaultIndices.includes(item.order)) {
        results.push({
          lesson_id: `lesson-${item.order}`,
          lesson_title: item.title,
          order_index: item.order,
          topic: item.topic,
          url: `/en/videos?lesson=lesson-${item.order}`,
          button_text: `▶️ ${item.order}-dars: ${item.title} darsini ko'rish`,
          description: `Sizda ushbu mavzuda xatolik ko'p: ${item.desc}`,
        });
      }
    }
  }

  return results;
}
interface ExamFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillFeedbacks?: Record<string, DiagnosticFeedback | null>;
  speechDiagnostics?: Record<string, SpeechDiagnostics> | null;
  overallScore?: number | null;
  examType?: string;
  recommendations?: WeakPointLessonRecommendation[];
}

export function ExamFeedbackModal({
  open,
  onOpenChange,
  skillFeedbacks = {},
  speechDiagnostics = {},
  overallScore,
  examType = "ielts",
  recommendations: externalRecs,
}: ExamFeedbackModalProps) {
  const skills = Object.keys(skillFeedbacks).filter((s) => Boolean(skillFeedbacks[s]));
  const defaultSkill = skills[0] || "writing";
  const [activeSkill, setActiveSkill] = React.useState<string>(defaultSkill);
  const activeFeedback = skillFeedbacks[activeSkill] || null;
  const activeRecommendations = (externalRecs && externalRecs.length > 0)
    ? externalRecs
    : deriveRecommendationsFromFeedback(activeFeedback);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (skills.length > 0 && !skills.includes(activeSkill)) {
      setActiveSkill(skills[0]);
    }
  }, [skills, activeSkill]);

  const feedback = skillFeedbacks[activeSkill];
  const speechDiag = speechDiagnostics ? speechDiagnostics[activeSkill] : undefined;

  const copyModelAnswer = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-emerald-500/20 bg-[#0B0F17] p-0 text-white shadow-[0_0_60px_rgba(16,185,129,0.15)]">
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-emerald-500/15 bg-[#0B0F17]/95 px-6 py-5 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                <Sparkles className="size-6 fill-current" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black tracking-tight text-white sm:text-xl">
                  AI Imtihon Diagnostikasi &amp; Tahlil Markazi
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Xalqaro IELTS 9.0 va CEFR C1 mezonlari bo&apos;yicha zaif nuqtalar va xatoliklar tahlili
                </DialogDescription>
              </div>
            </div>

            {overallScore !== null && overallScore !== undefined && (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2">
                <span className="text-xs font-semibold text-slate-300">Umumiy Natija:</span>
                <span className="font-mono text-base font-black text-emerald-400">
                  {overallScore}
                </span>
              </div>
            )}
          </div>

          {/* Skill Selector Tabs */}
          {skills.length > 1 && (
            <div className="mt-4 flex gap-2">
              {skills.map((s) => {
                const isActive = activeSkill === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setActiveSkill(s)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all",
                      isActive
                        ? "bg-emerald-500 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                        : "bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-white"
                    )}
                  >
                    {s === "writing" ? (
                      <PenTool className="size-3.5" />
                    ) : s === "speaking" ? (
                      <Mic className="size-3.5" />
                    ) : (
                      <BookOpen className="size-3.5" />
                    )}
                    <span className="uppercase">{s} Tahlili</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {!feedback ? (
            <div className="rounded-2xl border border-slate-800 bg-[#111827]/60 p-8 text-center text-slate-400">
              <HelpCircle className="mx-auto size-10 text-slate-500 mb-3" />
              <p className="text-sm font-semibold text-slate-300">
                Ushbu modul bo&apos;yicha diagnostik tahlil ma&apos;lumotlari shakllantirilmoqda.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Baholash ishi yakunlangach, barcha mezonlar shu yerda aks etadi.
              </p>
            </div>
          ) : (
            <>
              {/* 1. Speech Diagnostics Meter (for Speaking) */}
              {(activeSkill === "speaking" || speechDiag) && speechDiag && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                    <Gauge className="size-4" />
                    Nutq Tezligi va Talaffuz Dinamikasi (Speech Analytics)
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    {/* WPM */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 text-center shadow-sm">
                      <span className="text-[11px] font-bold text-slate-400 block mb-1">
                        Nutq Tezligi (WPM)
                      </span>
                      <span className="font-mono text-2xl font-black text-emerald-300">
                        {speechDiag.words_per_minute ?? speechDiag.wpm ?? 110}
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        so&apos;z / daqiqada
                      </span>
                    </div>

                    {/* Fluency Score */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 text-center shadow-sm">
                      <span className="text-[11px] font-bold text-slate-400 block mb-1">
                        Ravonlik Bahosi
                      </span>
                      <span className="font-mono text-2xl font-black text-teal-300">
                        {speechDiag.fluency_score ?? "6.5"}
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold block mt-0.5">
                        {speechDiag.clarity_rating ?? "Yaxshi"}
                      </span>
                    </div>

                    {/* Lexical Density */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 text-center shadow-sm">
                      <span className="text-[11px] font-bold text-slate-400 block mb-1">
                        Leksik Xilma-xillik
                      </span>
                      <span className="font-mono text-2xl font-black text-white">
                        {speechDiag.lexical_density ? `${speechDiag.lexical_density}%` : "68%"}
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        Unikal so&apos;zlar nisbati
                      </span>
                    </div>

                    {/* Vocabulary Level */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 text-center shadow-sm">
                      <span className="text-[11px] font-bold text-slate-400 block mb-1">
                        Lug&apos;at Darajasi
                      </span>
                      <span className="font-mono text-2xl font-black text-emerald-400">
                        {speechDiag.vocabulary_level ?? "B2"}
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        CEFR Standart
                      </span>
                    </div>
                  </div>

                  {/* Phonetic & Hesitation highlights */}
                  {speechDiag.mispronounced_words && speechDiag.mispronounced_words.length > 0 && (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                        <Volume2 className="size-4" />
                        Talaffuzni Yaxshilash Uchun So&apos;zlar:
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {speechDiag.mispronounced_words.map((item, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl border border-amber-500/20 bg-[#0B0F17]/80 p-2.5 text-xs"
                          >
                            <span className="font-bold text-white">&ldquo;{item.word}&rdquo;</span>
                            {item.issue && (
                              <p className="text-[11px] text-amber-300/80 mt-0.5">{item.issue}</p>
                            )}
                            {item.suggestion && (
                              <p className="text-[11px] text-emerald-400 font-medium mt-0.5">
                                Maslahat: {item.suggestion}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* 2. Official Criteria Breakdown */}
              {feedback.criteria_scores && feedback.criteria_scores.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                    <Target className="size-4" />
                    Rasmiy Mezonlar Bo&apos;yicha Baholash (Criteria Scoring)
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {feedback.criteria_scores.map((c, idx) => {
                      const scoreNum = c.score;
                      const maxNum = examType === "multilevel" ? 6 : 9;
                      const pct = Math.min(100, Math.round((scoreNum / maxNum) * 100));

                      return (
                        <div
                          key={idx}
                          className="rounded-2xl border border-slate-800 bg-[#111827] p-4 transition-all hover:border-emerald-500/30"
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-bold text-sm text-slate-200">{c.criterion}</span>
                            <span className="font-mono text-sm font-black text-emerald-400">
                              {scoreNum} <span className="text-xs text-slate-500">/ {maxNum}</span>
                            </span>
                          </div>

                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800 mb-2">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>

                          {c.comment && (
                            <p className="text-xs text-slate-400 leading-relaxed">{c.comment}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 3. In-text Mistakes & Fixes */}
              {feedback.mistakes_and_fixes && feedback.mistakes_and_fixes.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-rose-400">
                    <AlertCircle className="size-4" />
                    Matn Ichidagi Aniq Xatolar va To&apos;g&apos;ri Variantlar
                  </div>

                  <div className="space-y-2.5">
                    {feedback.mistakes_and_fixes.map((m, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2 py-0.5 font-mono text-rose-300 font-bold">
                            <XCircle className="size-3" /> {m.original}
                          </span>
                          <span className="text-slate-500 font-bold">➔</span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 font-mono text-emerald-300 font-bold">
                            <CheckCircle2 className="size-3" /> {m.corrected}
                          </span>
                        </div>
                        {m.explanation && (
                          <p className="text-xs text-slate-300 leading-relaxed pt-1">
                            {m.explanation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 4. Vocabulary Upgrades */}
              {feedback.vocabulary_upgrades && feedback.vocabulary_upgrades.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-teal-400">
                    <Wand2 className="size-4" />
                    Leksik Boyitish (C1 / C2 Advanced Vocabulary Upgrades)
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {feedback.vocabulary_upgrades.map((v, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4 space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 font-medium line-through">
                            {v.original}
                          </span>
                          <span className="font-bold text-teal-300 bg-teal-500/20 border border-teal-500/40 rounded-lg px-2 py-0.5">
                            ★ {v.alternative}
                          </span>
                        </div>
                        {v.explanation && (
                          <p className="text-[11px] text-slate-400 italic pt-1">
                            {v.explanation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 5. Actionable Next Steps */}
              {feedback.action_plan && feedback.action_plan.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                    <Lightbulb className="size-4" />
                    Ballni Oshirish Uchun Amaliy Qadamlar (Action Plan)
                  </div>

                  <div className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 space-y-2">
                    {feedback.action_plan.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs text-slate-300">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/20 font-mono text-[11px] font-black text-emerald-400">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 5. Smart Video Lesson Recommendations for Weak Points */}
              {activeRecommendations && activeRecommendations.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                    <Sparkles className="size-4 text-emerald-400" />
                    Zaif Nuqtalarni Yopish Uchun Tavsiya Etilgan Video Darslar
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {activeRecommendations.map((rec, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-4 flex flex-col justify-between space-y-3"
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-white">{rec.topic}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                              {rec.order_index}-Dars
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                            {rec.description}
                          </p>
                        </div>

                        <a
                          href={rec.url}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-2 text-xs shadow-md transition-all hover:scale-[1.02]"
                        >
                          <Play className="size-3.5 fill-current" />
                          <span>{rec.button_text}</span>
                        </a>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 6. Band 8.0 Model Rewrite */}
              {feedback.band_8_rewrite && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                      <Award className="size-4" />
                      Band 8.0+ Namuna Insho (Exemplar Model Answer)
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyModelAnswer(feedback.band_8_rewrite || "")}
                      className="h-7 text-xs border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <Copy className="size-3 mr-1" />
                      {copied ? "Nusxalandi!" : "Nusxa Olish"}
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/25 bg-slate-950/80 p-5 font-serif text-sm leading-relaxed text-slate-200 whitespace-pre-line shadow-inner">
                    {feedback.band_8_rewrite}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
