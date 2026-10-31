"use client";

import * as React from "react";
import {
  AlertCircle,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Send,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface CriteriaScore {
  criterion: string;
  score: number;
  band: number;
  feedback: string;
}

interface GrammarCorrection {
  original: string;
  corrected: string;
  explanation: string;
}

interface VocabularyUpgrade {
  original: string;
  alternative: string;
  explanation: string;
}

interface InstantEvaluationResponse {
  band: number;
  cefr_level: string;
  word_count: number;
  criteria_scores: {
    task_achievement: CriteriaScore;
    coherence_cohesion: CriteriaScore;
    lexical_resource: CriteriaScore;
    grammatical_range: CriteriaScore;
  };
  grammar_corrections: GrammarCorrection[];
  vocabulary_upgrades: VocabularyUpgrade[];
  model_answer: string;
  summary: string;
}

interface InstantAiCheckerModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPrompt?: string;
}

export function InstantAiCheckerModal({
  isOpen,
  onClose,
  defaultPrompt = "",
}: InstantAiCheckerModalProps) {
  const [text, setText] = React.useState("");
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<InstantEvaluationResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (defaultPrompt) {
      setPrompt(defaultPrompt);
    }
  }, [defaultPrompt]);

  const wordCount = React.useMemo(() => {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }, [text]);

  const handleEvaluate = async () => {
    if (!text.trim() || wordCount < 15) {
      toast.error("Iltimos, kamida 15 ta so'zdan iborat matn kiriting!");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await apiClient.post<InstantEvaluationResponse>(
        "/api/v1/assessment/instant-evaluate",
        {
          text: text.trim(),
          prompt: prompt.trim(),
          skill: "writing",
          task_type: "task2",
          program: "IELTS",
        }
      );
      setResult(res);
      toast.success("✅ AI tahlili muvaffaqiyatli yakunlandi!");
    } catch (err) {
      console.error("Evaluation error:", err);
      toast.error("Baholashda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyModelAnswer = () => {
    if (!result?.model_answer) return;
    navigator.clipboard.writeText(result.model_answer);
    setCopied(true);
    toast.success("C1 Namuna nusxalandi!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border border-emerald-500/30 bg-[#0B0F17] p-0 text-slate-100 shadow-2xl backdrop-blur-xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-[#0B0F17]/95 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-10 place-items-center rounded-xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 shadow-xs">
                <Sparkles className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-100 sm:text-lg flex items-center gap-2">
                  Instant AI Writing & Speaking Checker
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    Real-Time
                  </span>
                </DialogTitle>
                <p className="text-xs text-slate-400">
                  4 ta rasmiy mezon, xatolarni qizil/yashil tahlili va C1 darajasidagi namuna javob
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-5 sm:p-6 space-y-6">
          {/* Input Section */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Mavzu yoki Savol (Prompt) - Ixtiyoriy:
              </label>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Masalan: Some people think that universities should focus on vocational skills..."
                className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3.5 py-2 text-xs sm:text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-hidden focus:ring-1 focus:ring-emerald-500/40"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-slate-300 uppercase tracking-wider">
                  Matn yoki Insho (Essay):
                </label>
                <span className={cn("font-mono font-medium", wordCount >= 250 ? "text-emerald-400" : "text-slate-400")}>
                  {wordCount} ta so&apos;z (Tavsiya: 150-250+)
                </span>
              </div>
              <textarea
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Insho matningizni bu yerga kiriting yoki nusxalab tashlang..."
                className="w-full rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 text-xs sm:text-sm text-slate-200 leading-relaxed placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-hidden focus:ring-1 focus:ring-emerald-500/40"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <Button
                type="button"
                disabled={loading || wordCount < 15}
                onClick={handleEvaluate}
                className="rounded-xl bg-emerald-500 px-6 font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 flex items-center gap-2 shadow-md shadow-emerald-500/20"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>AI Baholamoqda...</span>
                  </>
                ) : (
                  <>
                    <Zap className="size-4 fill-slate-950" />
                    <span>Darhol Baholash (Instant Evaluate)</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Result Section */}
          {result && (
            <div className="space-y-6 pt-4 border-t border-slate-800/80 animate-in fade-in duration-300">
              {/* Overall Band Banner */}
              <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-slate-900/80 to-teal-950/30 p-5 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
                      <Award className="size-3.5" /> Rasmiy Natija
                    </span>
                    <h3 className="text-lg font-black text-slate-100">
                      Umumiy Baho: <span className="text-emerald-400 text-2xl font-black">{result.band.toFixed(1)} Band</span>
                    </h3>
                    <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
                      {result.summary}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-400">CEFR Daraja</p>
                      <p className="text-xl font-black text-emerald-400">{result.cefr_level}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-400">So&apos;zlar</p>
                      <p className="text-xl font-black text-teal-400">{result.word_count}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Criteria Grid */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <TrendingUp className="size-3.5 text-emerald-400" />
                  4 ta Rasmiy Baholash Mezoni (IELTS / Multilevel Criteria)
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(result.criteria_scores).map(([key, item]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-1.5 backdrop-blur-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">{item.criterion}</span>
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300">
                          {item.band.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {item.feedback}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Red / Green Grammar Corrections */}
              {result.grammar_corrections.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full bg-rose-500" />
                    Grammatik Xatolar & Tuzatishlar ({result.grammar_corrections.length} ta)
                  </h4>
                  <ul className="space-y-2.5">
                    {result.grammar_corrections.map((corr, idx) => (
                      <li
                        key={idx}
                        className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 text-xs sm:text-sm space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 font-mono text-rose-300 line-through">
                            {corr.original}
                          </span>
                          <span className="text-slate-500">→</span>
                          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono font-bold text-emerald-300">
                            {corr.corrected}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {corr.explanation}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Vocabulary Upgrades */}
              {result.vocabulary_upgrades.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full bg-teal-400" />
                    Lug&apos;at Boyligini Oshirish (C1/C2 Lexical Upgrades) ({result.vocabulary_upgrades.length} ta)
                  </h4>
                  <ul className="space-y-2.5">
                    {result.vocabulary_upgrades.map((upg, idx) => (
                      <li
                        key={idx}
                        className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 text-xs sm:text-sm space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-slate-400">{upg.original}</span>
                          <span className="text-teal-400">→</span>
                          <span className="rounded-md border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 font-mono font-bold text-teal-300">
                            {upg.alternative}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {upg.explanation}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* C1 Model Answer */}
              {result.model_answer && (
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-5 space-y-3 shadow-lg">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                      <Sparkles className="size-3.5" /> C1 Namuna Javob (Model Answer)
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyModelAnswer}
                      className="border-emerald-500/30 text-xs text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-1.5"
                    >
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      <span>{copied ? "Nusxalandi" : "Nusxa Olish"}</span>
                    </Button>
                  </div>

                  <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-[#0B0F17]/90 p-4 font-serif text-xs sm:text-sm leading-relaxed text-slate-200">
                    {result.model_answer}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
