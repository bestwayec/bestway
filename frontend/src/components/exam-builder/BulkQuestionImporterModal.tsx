"use client";

import * as React from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Copy,
  Headphones,
  Loader2,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";
import { parseBulkQuestions, type ParsedQuestionItem } from "./bulk-question-parser";

interface BulkQuestionImporterModalProps {
  open: boolean;
  onClose: () => void;
  examId?: string;
  examTitle?: string;
  initialSkill?: "reading" | "listening";
  onQuestionsImported?: (
    questions: ParsedQuestionItem[],
    targetSkill: "reading" | "listening",
  ) => void;
}

const SAMPLE_BULK_TEXT = `1. Choose the correct plural form of 'child':
A) childs
B) children*
C) childrens
D) childes

2. She is interested ___ modern art.
A) at
B) on
C) in*
D) with

3. The scientists conducted a series of ___ to verify the hypothesis.
A) experiments*
B) experimentations
C) experimental
D) experimentally

4. Which word is a synonym for 'abundant'?
A) Scarce
B) Plentiful*
C) Rare
D) Limited`;

export function BulkQuestionImporterModal({
  open,
  onClose,
  examId,
  examTitle,
  initialSkill = "reading",
  onQuestionsImported,
}: BulkQuestionImporterModalProps) {
  const [text, setText] = React.useState("");
  const [skill, setSkill] = React.useState<"reading" | "listening">(initialSkill);
  const [parsedList, setParsedList] = React.useState<ParsedQuestionItem[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [hasParsed, setHasParsed] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Sync skill when prop changes
  React.useEffect(() => {
    setSkill(initialSkill);
  }, [initialSkill]);

  const handleParse = () => {
    if (!text.trim()) {
      toast.warning("Iltimos, avval test matnini kiriting");
      return;
    }
    const result = parseBulkQuestions(text);
    setParsedList(result.questions);
    setWarnings(result.warnings);
    setHasParsed(true);

    if (result.questions.length > 0) {
      toast.success(`${result.questions.length} ta savol muvaffaqiyatli aniqlandi!`);
    } else {
      toast.error("Savollar aniqlanmadi. Savollar '1. Savol...' va 'A) Variant...' formatida ekanligini tekshiring.");
    }
  };

  const handleLoadSample = () => {
    setText(SAMPLE_BULK_TEXT);
    setHasParsed(false);
    setParsedList([]);
    setWarnings([]);
    toast.info("Namuna matni kiritildi. Endi 'Matnni tahlil qilish' tugmasini bosing.");
  };

  const handleClear = () => {
    setText("");
    setParsedList([]);
    setWarnings([]);
    setHasParsed(false);
  };

  const handleOptionCorrectChange = (questionId: string, newCorrect: "A" | "B" | "C" | "D") => {
    setParsedList((prev) =>
      prev.map((q) => (q.id === questionId ? { ...q, correctAnswer: newCorrect } : q)),
    );
  };

  const handleSaveAndAttach = async () => {
    if (parsedList.length === 0) {
      toast.warning("Saqlash uchun kamida 1 ta savol bo'lishi kerak");
      return;
    }

    setIsSubmitting(true);
    try {
      if (onQuestionsImported) {
        onQuestionsImported(parsedList, skill);
        toast.success(`${parsedList.length} ta savol tahrirlagichga muvaffaqiyatli biriktirildi!`);
        onClose();
      } else if (examId) {
        const payloadQuestions = parsedList.map((q) => ({
          prompt: q.prompt.trim(),
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: 1,
        }));

        await api.post(`/mock/exams/${examId}/quick-content`, {
          [skill]: payloadQuestions,
        });

        toast.success(
          `${parsedList.length} ta ${skill === "reading" ? "Reading" : "Listening"} savollari saqlandi!`,
        );
        onClose();
      } else {
        toast.success(`${parsedList.length} ta savol tayyorlandi!`);
        onClose();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Savollarni saqlashda xatolik yuz berdi";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw] max-w-3xl max-h-[92dvh] overflow-hidden flex flex-col p-0 bg-[#0B0F17] border border-emerald-500/30 shadow-2xl rounded-2xl text-slate-100">
        <DialogHeader className="p-5 pb-3 border-b border-emerald-500/20 bg-slate-900/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Zap className="size-5 fill-emerald-400" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
                  <span>Tezkor Matn Orqali Kiritish (Smart Bulk Paste)</span>
                  <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
                    Auto-Parser
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  {examTitle ? `Imtihon: ${examTitle}` : "Word yoki Telegram'dan ko'chirilgan test matnini to'g'ridan-to'g'ri joylang."}
                </DialogDescription>
              </div>
            </div>

            {/* Target Skill Toggle */}
            <div className="flex items-center rounded-xl bg-slate-900 border border-slate-800 p-1">
              <button
                type="button"
                onClick={() => setSkill("reading")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  skill === "reading"
                    ? "bg-emerald-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <BookOpen className="size-3.5" />
                <span>Reading</span>
              </button>
              <button
                type="button"
                onClick={() => setSkill("listening")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  skill === "listening"
                    ? "bg-emerald-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Headphones className="size-3.5" />
                <span>Listening</span>
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Format Hint Card */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-slate-300 flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-emerald-300 mb-1">
                Format qoidasi: Savollar raqamlangan (1., 2.), variantlar esa A), B), C), D) ko&apos;rinishida bo&apos;lsin.
              </p>
              <p className="text-slate-400 text-[11px]">
                To&apos;g&apos;ri javobni variant oxiriga yulduzcha <strong className="text-emerald-300">*</strong> yoki <strong className="text-emerald-300">[x]</strong> qo&apos;yib belgilang (masalan: <code className="text-emerald-300">B) children*</code>).
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleLoadSample}
              className="shrink-0 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 text-xs h-7"
            >
              <Sparkles className="size-3.5 mr-1 text-emerald-400" />
              Namuna yuklash
            </Button>
          </div>

          {/* Raw Text Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Test matni (Paste area):</label>
              {text && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  Tozalash
                </button>
              )}
            </div>
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setHasParsed(false);
              }}
              placeholder={`1. Choose the correct plural form of 'child':\nA) childs\nB) children*\nC) childrens\nD) childes\n\n2. She is interested ___ modern art.\nA) at\nB) on\nC) in*\nD) with`}
              rows={8}
              className="w-full bg-slate-950/80 border-slate-800 text-slate-100 font-mono text-xs rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 p-3 leading-relaxed"
            />
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              size="sm"
              onClick={handleParse}
              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 rounded-xl shadow-md shadow-emerald-500/20"
            >
              <Zap className="size-4 mr-1.5 fill-slate-950" />
              Matnni tahlil qilish (Parse)
            </Button>

            {hasParsed && (
              <div className="flex items-center gap-2">
                <Badge variant="success" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                  {parsedList.length} ta savol tayyor
                </Badge>
              </div>
            )}
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertCircle className="size-4 text-amber-400" />
                Diqqat (Ogohlantirishlar):
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-200/80">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Live Preview of Parsed Questions */}
          {hasParsed && parsedList.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-emerald-400" />
                Jonli Ko&apos;rish (Parsed Questions Preview):
              </h4>
              <div className="grid gap-3">
                {parsedList.map((q, idx) => (
                  <div
                    key={q.id || idx}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-2.5 backdrop-blur-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-100">
                        <span className="text-emerald-400 font-bold mr-1.5">#{q.number}</span>
                        {q.prompt}
                      </p>
                      <Badge
                        variant="neutral"
                        className="text-[10px] bg-slate-800 text-slate-300 border-slate-700 shrink-0"
                      >
                        To&apos;g&apos;ri: {q.correctAnswer}
                      </Badge>
                    </div>

                    {/* Options grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {(["A", "B", "C", "D"] as const).map((letter, optIdx) => {
                        const optText = q.options[optIdx] || "—";
                        const isCorrect = q.correctAnswer === letter;
                        return (
                          <div
                            key={letter}
                            onClick={() => handleOptionCorrectChange(q.id, letter)}
                            className={`flex items-center gap-2 p-2 rounded-lg text-xs cursor-pointer border transition-all ${
                              isCorrect
                                ? "bg-emerald-500/20 border-emerald-500 text-emerald-300 font-semibold shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                                : "bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            <span
                              className={`size-5 rounded flex items-center justify-center text-[10px] font-bold ${
                                isCorrect ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {letter}
                            </span>
                            <span className="truncate flex-1">{optText}</span>
                            {isCorrect && <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 ml-auto" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-emerald-500/20 bg-slate-900/40 flex items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-slate-800 text-slate-400 hover:text-white"
          >
            Bekor qilish
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={parsedList.length === 0 || isSubmitting}
            onClick={handleSaveAndAttach}
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-5 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin mr-1.5" />
            ) : (
              <CheckCircle2 className="size-4 mr-1.5 text-slate-950" />
            )}
            Saqlash va Biriktirish ({parsedList.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
