"use client";

import * as React from "react";
import {
  Bomb,
  Check,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface QuizDeckCreatorProps {
  onSuccess?: (deckId: string) => void;
  onCancel?: () => void;
  initialLessonId?: string;
  isLessonTiedDefault?: boolean;
}

interface NewCardItem {
  id: string;
  card_type: "question" | "swap" | "steal" | "double" | "bomb";
  points: number;
  question_text: string;
  options: string[];
  correct_answer: string;
}

export function QuizDeckCreator({
  onSuccess,
  onCancel,
  initialLessonId,
  isLessonTiedDefault = false,
}: QuizDeckCreatorProps) {
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("Vocabulary");
  const [isLessonTied, setIsLessonTied] = React.useState(isLessonTiedDefault);
  const [lessonId, setLessonId] = React.useState(initialLessonId || "");
  const [cards, setCards] = React.useState<NewCardItem[]>([
    {
      id: "1",
      card_type: "question",
      points: 10,
      question_text: "Misol: What is the synonym of 'rapid'?",
      options: ["Fast", "Slow", "Heavy", "Dark"],
      correct_answer: "Fast",
    },
    {
      id: "2",
      card_type: "swap",
      points: 0,
      question_text: "SYURPRIZ: Ballarni Almashtirish!",
      options: [],
      correct_answer: "",
    },
    {
      id: "3",
      card_type: "question",
      points: 15,
      question_text: "Misol: Choose the antonym of 'expand'",
      options: ["Contract", "Grow", "Widen", "Spread"],
      correct_answer: "Contract",
    },
    {
      id: "4",
      card_type: "bomb",
      points: 0,
      question_text: "BOMBA: -15 Ball Jarima!",
      options: [],
      correct_answer: "",
    },
  ]);

  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleAddCard = (type: "question" | "swap" | "steal" | "double" | "bomb" = "question") => {
    const newId = String(Date.now());
    if (type === "question") {
      setCards((prev) => [
        ...prev,
        {
          id: newId,
          card_type: "question",
          points: 10,
          question_text: "",
          options: ["", "", "", ""],
          correct_answer: "",
        },
      ]);
    } else {
      const descriptions = {
        swap: "SYURPRIZ: Ballarni Almashtirish (Swap)!",
        steal: "SYURPRIZ: Raqibdan 15 Ball O'g'irlash (Steal)!",
        double: "SYURPRIZ: 2x Multiplier Ball!",
        bomb: "BOMBA: -15 Ball Jarima (Bomb)!",
      };
      setCards((prev) => [
        ...prev,
        {
          id: newId,
          card_type: type,
          points: 0,
          question_text: descriptions[type],
          options: [],
          correct_answer: "",
        },
      ]);
    }
  };

  const handleRemoveCard = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const handleCardChange = (id: string, field: keyof NewCardItem, value: any) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const handleOptionChange = (cardId: string, optIndex: number, val: string) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== cardId) return c;
        const nextOpts = [...(c.options || [])];
        nextOpts[optIndex] = val;
        return { ...c, options: nextOpts };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Iltimos, to'plam nomini kiriting");
      return;
    }
    if (cards.length < 4) {
      setError("To'plamda kamida 4 ta karta bo'lishi kerak");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const res = await api.post<any>("/v1/quiz-decks/create", {
        title: title.trim(),
        category,
        is_lesson_tied: isLessonTied,
        lesson_id: isLessonTied && lessonId ? lessonId : null,
        cards: cards.map((c, idx) => ({
          order_index: idx + 1,
          card_type: c.card_type,
          points: c.card_type === "question" ? c.points : 0,
          question_text: c.question_text,
          options: c.options.filter((o) => o.trim().length > 0),
          correct_answer: c.correct_answer,
        })),
      });

      const deckId = res.data?.data?.id || res.data?.id;
      if (onSuccess && deckId) onSuccess(deckId);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || "Saqlashda xatolik yuz berdi");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-[#0B0F17] text-white rounded-2xl border border-emerald-500/20 p-6 shadow-2xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
        <div>
          <h2 className="text-xl font-black text-white">Yangi Bamboozle Quiz Deck Yaratish</h2>
          <p className="text-xs text-slate-400">Jamoaviy o&apos;yin uchun savollar va syurpriz kartalar to&apos;plami</p>
        </div>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm font-semibold">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Meta Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">To&apos;plam Nomi</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Masalan: IELTS Band 7+ Vocab Arena"
              className="w-full px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:border-emerald-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Kategoriya</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:border-emerald-500 outline-none"
            >
              <option value="Vocabulary">Vocabulary (Lug&apos;at)</option>
              <option value="Grammar">Grammar (Grammatika)</option>
              <option value="IELTS">IELTS</option>
              <option value="General">Umumiy Bilimlar</option>
            </select>
          </div>
        </div>

        {/* Lesson-tied checkbox */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800">
          <input
            type="checkbox"
            id="tiedCheck"
            checked={isLessonTied}
            onChange={(e) => setIsLessonTied(e.target.checked)}
            className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
          />
          <label htmlFor="tiedCheck" className="text-xs text-slate-300 cursor-pointer">
            <strong className="text-white">Darsga biriktirish (Lesson-Tied Mode):</strong> O&apos;quvchi dars videosini to&apos;liq ko&apos;rib bo&apos;lgandagina bu test qulfdan chiqariladi.
          </label>
        </div>

        {/* Cards Header and Add Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-white text-sm">Kartalar Ro&apos;yxati ({cards.length} ta)</h4>
            <Badge variant="neutral" className="bg-emerald-500/20 text-emerald-400 text-xs">
              Tavsiya: 16 ta karta
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => handleAddCard("question")}
              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Savol Qo&apos;shish</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleAddCard("swap")}
              className="bg-slate-800 hover:bg-slate-700 text-xs text-amber-300 border border-amber-500/30"
            >
              🔄 Swap
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleAddCard("steal")}
              className="bg-slate-800 hover:bg-slate-700 text-xs text-purple-300 border border-purple-500/30"
            >
              🥷 Steal
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleAddCard("double")}
              className="bg-slate-800 hover:bg-slate-700 text-xs text-blue-300 border border-blue-500/30"
            >
              ⚡️ 2x
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleAddCard("bomb")}
              className="bg-slate-800 hover:bg-slate-700 text-xs text-red-300 border border-red-500/30"
            >
              💣 Bomba
            </Button>
          </div>
        </div>

        {/* Cards Editor List */}
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
          {cards.map((c, idx) => (
            <div
              key={c.id}
              className={`p-4 rounded-xl border ${
                c.card_type === "question"
                  ? "bg-slate-900 border-slate-800"
                  : "bg-slate-950/80 border-amber-500/40"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-400">#{idx + 1}</span>
                  <Badge
                    variant="neutral"
                    className={`text-xs ${
                      c.card_type === "question"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {c.card_type.toUpperCase()}
                  </Badge>
                  {c.card_type === "question" && (
                    <select
                      value={c.points}
                      onChange={(e) => handleCardChange(c.id, "points", Number(e.target.value))}
                      className="px-2 py-0.5 rounded bg-slate-800 text-xs text-emerald-400 font-bold border border-slate-700"
                    >
                      <option value={10}>10 Ball</option>
                      <option value={15}>15 Ball</option>
                      <option value={20}>20 Ball</option>
                    </select>
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveCard(c.id)}
                  className="text-slate-500 hover:text-red-400 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {c.card_type === "question" ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={c.question_text}
                    onChange={(e) => handleCardChange(c.id, "question_text", e.target.value)}
                    placeholder="Savol matnini kiriting..."
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm outline-none focus:border-emerald-500"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {c.options.map((opt, optIdx) => (
                      <input
                        key={optIdx}
                        type="text"
                        value={opt}
                        onChange={(e) => handleOptionChange(c.id, optIdx, e.target.value)}
                        placeholder={`Variant ${String.fromCharCode(65 + optIdx)}`}
                        className="px-3 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 outline-none"
                      />
                    ))}
                  </div>
                  <input
                    type="text"
                    value={c.correct_answer}
                    onChange={(e) => handleCardChange(c.id, "correct_answer", e.target.value)}
                    placeholder="To'g'ri javob matni..."
                    className="w-full px-3 py-1 rounded bg-slate-950 border border-emerald-500/40 text-emerald-300 text-xs outline-none"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-300 font-medium">{c.question_text}</p>
              )}
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} className="text-slate-400 hover:text-white">
              Bekor Qilish
            </Button>
          )}
          <Button
            type="submit"
            disabled={isSaving}
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-6 py-2.5 rounded-xl flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? "Saqlanmoqda..." : "Quiz To'plamini Saqlash"}</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
