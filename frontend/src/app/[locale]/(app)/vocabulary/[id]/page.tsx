"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen, Layers, Sparkles } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VocabularyQuizRunner } from "@/components/vocabulary/VocabularyQuizRunner";

type QuizModeType = "mixed" | "eng_uzb" | "uzb_eng" | "spelling";

export default function VocabularyDetailPage() {
  const params = useParams();
  const setId = params.id as string;

  const [mode, setMode] = React.useState<QuizModeType>("mixed");
  const [isQuizStarted, setIsQuizStarted] = React.useState(false);

  const MODES: Array<{ id: QuizModeType; label: string; desc: string }> = [
    {
      id: "mixed",
      label: "Aralash (Tavsiya etiladi)",
      desc: "Tanlov, tarjima va imlo mashqlari navbatma-navbat almashadi",
    },
    {
      id: "eng_uzb",
      label: "Inglizcha → O'zbekcha",
      desc: "Inglizcha so'z beriladi, to'g'ri o'zbekcha variantni tanlaysiz",
    },
    {
      id: "uzb_eng",
      label: "O'zbekcha → Inglizcha",
      desc: "O'zbekcha so'z beriladi, inglizcha to'g'ri variantni tanlaysiz",
    },
    {
      id: "spelling",
      label: "Imlo (Spelling)",
      desc: "So'zni eshitasiz yoki o'qiysiz, inglizcha to'g'ri yozasiz",
    },
  ];

  if (isQuizStarted) {
    return (
      <div className="max-w-4xl mx-auto py-4">
        <VocabularyQuizRunner
          setId={setId}
          mode={mode}
          onExit={() => setIsQuizStarted(false)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      {/* Back button */}
      <div>
        <Link href="/vocabulary">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Lug'atlar ro'yxatiga qaytish
          </Button>
        </Link>
      </div>

      {/* Mode Selection Header */}
      <div className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 mb-2">
            <Sparkles className="h-8 w-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground">
            Test Rejimini Tanlang
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            100% natija uchun <strong>+5 platforma balli</strong>, 80-99% uchun esa <strong>+3 ball</strong> qo'lga kiriting!
          </p>
        </div>

        {/* Mode cards */}
        <div className="space-y-3">
          {MODES.map((m) => {
            const isSelected = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`w-full rounded-xl border p-4 text-left transition-all duration-200 flex items-center justify-between gap-4 ${
                  isSelected
                    ? "border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500"
                    : "border-border bg-card hover:bg-muted/50 hover:border-border"
                }`}
              >
                <div className="space-y-1">
                  <div className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <span>{m.label}</span>
                    {isSelected && (
                      <Badge className="bg-emerald-600 text-white text-[10px] h-4 px-1.5">
                        Tanlandi
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </div>
                <div
                  className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${
                    isSelected ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground"
                  }`}
                >
                  {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Start CTA */}
        <Button
          type="button"
          onClick={() => setIsQuizStarted(true)}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white h-12 text-base font-semibold shadow-lg shadow-emerald-600/20"
        >
          Testni Boshlash
        </Button>
      </div>
    </div>
  );
}
