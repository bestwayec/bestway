"use client";

import * as React from "react";
import {
  BookOpenText,
  CheckCircle2,
  Headphones,
  Mic,
  PenLine,
  Plus,
  Rocket,
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
import { Input, Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";
import type { MockExamListItem } from "@/lib/types";
import { BulkQuestionImporterModal } from "./BulkQuestionImporterModal";
import type { ParsedQuestionItem } from "./bulk-question-parser";

interface ExamQuestionsEditorDialogProps {
  open: boolean;
  onClose: () => void;
  exam: MockExamListItem;
  onSuccess?: () => void;
}

interface ObjectiveQ {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correctAnswer: "A" | "B" | "C" | "D";
}

export function ExamQuestionsEditorDialog({
  open,
  onClose,
  exam,
  onSuccess,
}: ExamQuestionsEditorDialogProps) {
  const isMultilevel = exam.type === "multilevel";

  // Active tab: default to writing or first available skill
  const [activeTab, setActiveTab] = React.useState<"writing" | "speaking" | "listening" | "reading">(
    exam.skills.includes("writing") ? "writing" : exam.skills.includes("speaking") ? "speaking" : "writing",
  );

  // --- Writing State ---
  const [wTask1Prompt, setWTask1Prompt] = React.useState(
    isMultilevel
      ? "Write a letter to your friend who loves music festivals. Say what you liked most and suggest going together next year. Write about 50 words."
      : "The chart below shows information about energy consumption by sector between 2010 and 2025. Summarise the information by selecting and reporting the main features.",
  );
  const [wTask1Passage, setWTask1Passage] = React.useState(
    isMultilevel
      ? "Dear guest, Thank you for joining us at the summer music festival! We would love to hear what you enjoyed most and suggestions for future events. — Festival Team"
      : "The bar chart illustrates household energy use across five categories over a 15-year period.",
  );
  const [wTask1ImageKey, setWTask1ImageKey] = React.useState(
    isMultilevel ? "multilevel/assets/speaking-1.2-two-picture.png" : "",
  );
  const [wTask1WordLimit, setWTask1WordLimit] = React.useState(isMultilevel ? 50 : 150);

  const [wTask2Prompt, setWTask2Prompt] = React.useState(
    isMultilevel
      ? "Some people believe that studying online is more effective than learning in a traditional classroom. Do you agree or disagree? Write a post giving reasons and examples (180–200 words)."
      : "Some people believe that universities should focus exclusively on providing graduates with job-related skills, while others feel they should offer broader knowledge regardless of career outcomes. Discuss both views and give your own opinion.",
  );
  const [wTask2WordLimit, setWTask2WordLimit] = React.useState(isMultilevel ? 200 : 250);

  // --- Speaking State ---
  const [sp1Q1, setSp1Q1] = React.useState("What do you usually do in your free time?");
  const [sp1Q2, setSp1Q2] = React.useState("Do you prefer spending your free time alone or with friends? Why?");
  const [sp1Q3, setSp1Q3] = React.useState("Is there a new hobby or activity you would like to try in the future?");

  const [sp2CueCard, setSp2CueCard] = React.useState(
    "Describe a person who has had a positive influence on your life.\n\nYou should say:\n• Who this person is\n• How you met this person\n• What qualities this person has\n• And explain how this person has influenced your life.",
  );

  const [sp3Discussion, setSp3Discussion] = React.useState(
    "In what ways do role models and influential figures shape the values of young people in modern society? How has the concept of a role model changed with social media?",
  );

  // --- Listening / Reading State ---
  const [readingQuestions, setReadingQuestions] = React.useState<ObjectiveQ[]>([
    {
      id: "r1",
      prompt: "According to the passage, what is the primary benefit of spaced repetition in language learning?",
      options: [
        "It eliminates the need for active vocabulary recall.",
        "It optimizes memory retention intervals based on forgetting curves.",
        "It requires significantly less total study time each session.",
        "It only functions effectively for grammar memorization.",
      ],
      correctAnswer: "B",
    },
    {
      id: "r2",
      prompt: "What does the author suggest about traditional cramming methods?",
      options: [
        "They yield higher long-term fluency outcomes.",
        "They cause rapid cognitive decay following exam completion.",
        "They are superior for auditory comprehension tasks.",
        "They are recommended by cognitive neuroscientists.",
      ],
      correctAnswer: "B",
    },
  ]);

  const [listeningQuestions, setListeningQuestions] = React.useState<ObjectiveQ[]>([
    {
      id: "l1",
      prompt: "What time does the international conference opening ceremony commence?",
      options: ["8:30 AM", "9:00 AM", "9:45 AM", "10:15 AM"],
      correctAnswer: "B",
    },
  ]);

  const [saving, setSaving] = React.useState(false);
  const [bulkImporterOpen, setBulkImporterOpen] = React.useState(false);

  const handleBulkImport = (
    newQuestions: ParsedQuestionItem[],
    targetSkill: "reading" | "listening",
  ) => {
    const mapped: ObjectiveQ[] = newQuestions.map((q, idx) => ({
      id: `${targetSkill[0]}_${Date.now()}_${idx + 1}`,
      prompt: q.prompt,
      options: q.options,
      correctAnswer: q.correctAnswer,
    }));

    if (targetSkill === "reading") {
      setReadingQuestions((prev) => [...prev, ...mapped]);
      setActiveTab("reading");
    } else {
      setListeningQuestions((prev) => [...prev, ...mapped]);
      setActiveTab("listening");
    }
  };

  // Load Preset Template
  const handleLoadStandardTemplate = () => {
    if (isMultilevel) {
      setWTask1Prompt("Write a letter to your friend who loves music festivals. Say what you liked most and suggest going together next year. Write about 50 words.");
      setWTask1Passage("Dear guest, Thank you for joining us at the summer music festival! We would love to hear what you enjoyed most. — Festival Team");
      setWTask1WordLimit(50);
      setWTask2Prompt("Some people believe that studying online is more effective than learning in a traditional classroom. Do you agree or disagree? Write a post giving reasons and examples (180–200 words).");
      setWTask2WordLimit(200);
      setSp1Q1("1. What do you usually do in your free time?");
      setSp1Q2("2. Do you prefer spending your free time alone or with friends? Why?");
      setSp1Q3("3. Is there a new hobby you would like to try in the future?");
      setSp2CueCard("Describe a person who has had a positive influence on your life.\n\nYou should say:\n• Who this person is\n• How you met this person\n• What qualities this person has\n• And explain how this person has influenced your life.");
      setSp3Discussion("In what ways do role models shape the values of young people in modern society? How has social media changed this?");
    } else {
      setWTask1Prompt("The chart below shows information about energy consumption by sector between 2010 and 2025. Summarise the information by selecting and reporting the main features.");
      setWTask1Passage("The chart illustrates household energy use across five categories.");
      setWTask1WordLimit(150);
      setWTask2Prompt("Some people believe that universities should focus exclusively on providing graduates with job-related skills, while others feel they should offer broader knowledge regardless of career outcomes. Discuss both views and give your own opinion.");
      setWTask2WordLimit(250);
      setSp1Q1("What is your hometown like? What do you like most about living there?");
      setSp1Q2("Do you work or are you a student? What are your future career aspirations?");
      setSp1Q3("How important is learning foreign languages in your country?");
      setSp2CueCard("Describe an interesting book or article you recently read.\n\nYou should say:\n• What it was about\n• Why you chose to read it\n• What you learned from it\n• And explain why you found it interesting.");
      setSp3Discussion("Do you think reading books will be replaced entirely by digital media in the near future? Why or why not?");
    }
    toast.info("Standart savollar shabloni to'ldirildi");
  };

  const handleSaveAndPublish = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        publish: true,
        isPublished: true,
      };

      // Add writing if present or edited
      if (wTask1Prompt || wTask2Prompt) {
        payload.writing = {
          task1: {
            prompt: wTask1Prompt.trim(),
            passageText: wTask1Passage.trim() || undefined,
            imageKey: wTask1ImageKey.trim() || undefined,
            wordLimit: Number(wTask1WordLimit) || (isMultilevel ? 50 : 150),
          },
          task2: {
            prompt: wTask2Prompt.trim(),
            wordLimit: Number(wTask2WordLimit) || (isMultilevel ? 200 : 250),
          },
        };
      }

      // Add speaking if present
      if (sp1Q1 || sp2CueCard || sp3Discussion) {
        payload.speaking = {
          part1: [sp1Q1.trim(), sp1Q2.trim(), sp1Q3.trim()].filter(Boolean),
          part2: {
            cueCard: sp2CueCard.trim(),
          },
          part3: {
            discussion: sp3Discussion.trim(),
          },
        };
      }

      // Add reading if present
      if (readingQuestions.length > 0) {
        payload.reading = readingQuestions.map((q) => ({
          prompt: q.prompt.trim(),
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: 1,
        }));
      }

      // Add listening if present
      if (listeningQuestions.length > 0) {
        payload.listening = listeningQuestions.map((q) => ({
          prompt: q.prompt.trim(),
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: 1,
        }));
      }

      await api.post(`/mock/exams/${exam.id}/quick-content`, payload);
      toast.success("Barcha savollar saqlandi va test muvaffaqiyatli 'Ready / Published' holatiga o'tkazildi!");
      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Savollarni saqlashda xatolik yuz berdi";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border border-slate-800 bg-[#0B0F17]/95 p-6 text-slate-100 shadow-2xl backdrop-blur-2xl">
        <DialogHeader className="border-b border-slate-800/80 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <Sparkles className="size-5 text-emerald-400" />
                Savollar Redaktori — {exam.title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-slate-400">
                Savollarni to&apos;g&apos;ridan-to&apos;g&apos;ri tahrirlang yoki standart shablonni yuklab, 1-klikda nashr qiling.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setBulkImporterOpen(true)}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold shadow-md shadow-emerald-500/20"
              >
                <Zap className="size-3.5 fill-slate-950" />
                ⚡️ Tezkor Matn Orqali Kiritish (Bulk Paste)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleLoadStandardTemplate}
                className="border-emerald-600/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50 hover:text-emerald-100"
              >
                <Sparkles className="size-3.5" />
                Standart Shablonni Yuklash
              </Button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("writing")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "writing"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/40"
                  : "bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <PenLine className="size-3.5" />
              Writing (Task 1 & Task 2)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("speaking")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "speaking"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/40"
                  : "bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <Mic className="size-3.5" />
              Speaking (Parts 1, 2, 3)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("reading")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "reading"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/40"
                  : "bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <BookOpenText className="size-3.5" />
              Reading ({readingQuestions.length} ta savol)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("listening")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "listening"
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/40"
                  : "bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <Headphones className="size-3.5" />
              Listening ({listeningQuestions.length} ta savol)
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* ================= WRITING TAB ================= */}
          {activeTab === "writing" && (
            <div className="space-y-5">
              {/* Task 1 Card */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                    <PenLine className="size-4 text-emerald-400" />
                    {isMultilevel ? "Task 1.1 & 1.2 — Letter Tasks" : "Task 1 — Visual / Report Prompt"}
                  </h4>
                  <span className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-xs text-slate-300">
                    Min: {wTask1WordLimit} so&apos;z
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Savol matni (Prompt):
                    </label>
                    <Textarea
                      value={wTask1Prompt}
                      onChange={(e) => setWTask1Prompt(e.target.value)}
                      rows={3}
                      className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                      placeholder="Talabaga ko'rinadigan vazifa sharti..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Bog&apos;lovchi matn / Stimulus text (Passage):
                    </label>
                    <Textarea
                      value={wTask1Passage}
                      onChange={(e) => setWTask1Passage(e.target.value)}
                      rows={2}
                      className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                      placeholder="Email yoki grafik tavsifi matni..."
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Rasm kaliti (Image Key / URL):
                      </label>
                      <Input
                        value={wTask1ImageKey}
                        onChange={(e) => setWTask1ImageKey(e.target.value)}
                        className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                        placeholder="masalan: multilevel/assets/chart.png"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-300">
                        Minimal so&apos;zlar soni (Word limit):
                      </label>
                      <Input
                        type="number"
                        value={wTask1WordLimit}
                        onChange={(e) => setWTask1WordLimit(Number(e.target.value))}
                        className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Task 2 Card */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                    <PenLine className="size-4 text-emerald-400" />
                    {isMultilevel ? "Task 2 — Publication / Opinion" : "Task 2 — Essay Prompt"}
                  </h4>
                  <span className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-xs text-slate-300">
                    Min: {wTask2WordLimit} so&apos;z
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Essay mavzusi (Prompt):
                    </label>
                    <Textarea
                      value={wTask2Prompt}
                      onChange={(e) => setWTask2Prompt(e.target.value)}
                      rows={4}
                      className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                      placeholder="Essay savoli va talablari..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">
                      Minimal so&apos;zlar soni (Word limit):
                    </label>
                    <Input
                      type="number"
                      value={wTask2WordLimit}
                      onChange={(e) => setWTask2WordLimit(Number(e.target.value))}
                      className="w-48 border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= SPEAKING TAB ================= */}
          {activeTab === "speaking" && (
            <div className="space-y-5">
              {/* Part 1 */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                  <Mic className="size-4 text-emerald-400" />
                  Part 1 — Interview Savollari (3 ta savol)
                </h4>
                <div className="space-y-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">1-savol:</label>
                    <Input
                      value={sp1Q1}
                      onChange={(e) => setSp1Q1(e.target.value)}
                      className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">2-savol:</label>
                    <Input
                      value={sp1Q2}
                      onChange={(e) => setSp1Q2(e.target.value)}
                      className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">3-savol:</label>
                    <Input
                      value={sp1Q3}
                      onChange={(e) => setSp1Q3(e.target.value)}
                      className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Part 2 */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                  <Mic className="size-4 text-emerald-400" />
                  Part 2 — Cue Card (1 daqiqa tayyorgarlik, 2 daqiqa gapirish)
                </h4>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Cue Card mavzusi va bandlari (Bullet points):
                  </label>
                  <Textarea
                    value={sp2CueCard}
                    onChange={(e) => setSp2CueCard(e.target.value)}
                    rows={5}
                    className="border-slate-800 bg-slate-950/80 font-mono text-sm text-slate-100 focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Part 3 */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                  <Mic className="size-4 text-emerald-400" />
                  Part 3 — Chuqurlashtirilgan Muhokama (Discussion)
                </h4>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Discussion savollari:
                  </label>
                  <Textarea
                    value={sp3Discussion}
                    onChange={(e) => setSp3Discussion(e.target.value)}
                    rows={4}
                    className="border-slate-800 bg-slate-950/80 text-slate-100 focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================= READING TAB ================= */}
          {activeTab === "reading" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Multiple Choice savollari: savol matni, 4 ta variant va to&apos;g&apos;ri javob kaliti.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setBulkImporterOpen(true)}
                    className="border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50 text-xs"
                  >
                    <Zap className="size-3.5 mr-1 text-emerald-400" />
                    ⚡️ Bulk Paste
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setReadingQuestions((prev) => [
                        ...prev,
                        {
                          id: `r_${Date.now()}`,
                          prompt: "Yangi reading savoli matni...",
                          options: ["Variant A", "Variant B", "Variant C", "Variant D"],
                          correctAnswer: "A",
                        },
                      ])
                    }
                    className="border-slate-700 bg-slate-800 text-xs text-slate-200"
                  >
                    <Plus className="size-3.5" /> Savol Qo&apos;shish
                  </Button>
                </div>
              </div>

              {readingQuestions.map((q, idx) => (
                <div key={q.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">Savol #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => setReadingQuestions((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <Textarea
                    value={q.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setReadingQuestions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, prompt: val } : item)),
                      );
                    }}
                    rows={2}
                    className="mb-3 border-slate-800 bg-slate-950 text-xs text-slate-100"
                  />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(["A", "B", "C", "D"] as const).map((letter, optIdx) => (
                      <div key={letter} className="flex items-center gap-1.5">
                        <span
                          onClick={() => {
                            setReadingQuestions((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, correctAnswer: letter } : item,
                              ),
                            );
                          }}
                          className={`flex size-6 cursor-pointer items-center justify-center rounded-md font-bold ${
                            q.correctAnswer === letter
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {letter}
                        </span>
                        <Input
                          value={q.options[optIdx]}
                          onChange={(e) => {
                            const val = e.target.value;
                            setReadingQuestions((prev) =>
                              prev.map((item, i) => {
                                if (i !== idx) return item;
                                const nextOpts = [...item.options] as [string, string, string, string];
                                nextOpts[optIdx] = val;
                                return { ...item, options: nextOpts };
                              }),
                            );
                          }}
                          className="h-7 border-slate-800 bg-slate-950 text-xs text-slate-200"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ================= LISTENING TAB ================= */}
          {activeTab === "listening" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Listening Multiple Choice savollari: audio asosidagi savollar va javob kalitlari.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setBulkImporterOpen(true)}
                    className="border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/50 text-xs"
                  >
                    <Zap className="size-3.5 mr-1 text-emerald-400" />
                    ⚡️ Bulk Paste
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setListeningQuestions((prev) => [
                        ...prev,
                        {
                          id: `l_${Date.now()}`,
                          prompt: "Yangi listening savoli...",
                          options: ["Variant A", "Variant B", "Variant C", "Variant D"],
                          correctAnswer: "A",
                        },
                      ])
                    }
                    className="border-slate-700 bg-slate-800 text-xs text-slate-200"
                  >
                    <Plus className="size-3.5" /> Savol Qo&apos;shish
                  </Button>
                </div>
              </div>

              {listeningQuestions.map((q, idx) => (
                <div key={q.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">Listening Savol #{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => setListeningQuestions((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <Textarea
                    value={q.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setListeningQuestions((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, prompt: val } : item)),
                      );
                    }}
                    rows={2}
                    className="mb-3 border-slate-800 bg-slate-950 text-xs text-slate-100"
                  />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(["A", "B", "C", "D"] as const).map((letter, optIdx) => (
                      <div key={letter} className="flex items-center gap-1.5">
                        <span
                          onClick={() => {
                            setListeningQuestions((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, correctAnswer: letter } : item,
                              ),
                            );
                          }}
                          className={`flex size-6 cursor-pointer items-center justify-center rounded-md font-bold ${
                            q.correctAnswer === letter
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {letter}
                        </span>
                        <Input
                          value={q.options[optIdx]}
                          onChange={(e) => {
                            const val = e.target.value;
                            setListeningQuestions((prev) =>
                              prev.map((item, i) => {
                                if (i !== idx) return item;
                                const nextOpts = [...item.options] as [string, string, string, string];
                                nextOpts[optIdx] = val;
                                return { ...item, options: nextOpts };
                              }),
                            );
                          }}
                          className="h-7 border-slate-800 bg-slate-950 text-xs text-slate-200"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 flex flex-col-reverse items-center justify-between gap-3 border-t border-slate-800/80 pt-4 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="border-slate-800 bg-slate-900/60 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={onClose}
            disabled={saving}
          >
            Bekor qilish
          </Button>

          <Button
            type="button"
            className="border border-emerald-500/50 bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500"
            onClick={handleSaveAndPublish}
            loading={saving}
          >
            <Rocket className="size-4 shrink-0" />
            Saqlash va Nashr Qilish (Ready/Published)
          </Button>
        </DialogFooter>
      </DialogContent>

      {bulkImporterOpen && (
        <BulkQuestionImporterModal
          open={bulkImporterOpen}
          onClose={() => setBulkImporterOpen(false)}
          examId={exam.id}
          examTitle={exam.title}
          initialSkill={activeTab === "listening" ? "listening" : "reading"}
          onQuestionsImported={handleBulkImport}
        />
      )}
    </Dialog>
  );
}
