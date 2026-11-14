"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VocabularyQuizRunner } from "@/components/vocabulary/VocabularyQuizRunner";

type QuizModeType = "mixed" | "eng_uzb" | "uzb_eng" | "spelling";

export default function VocabularyDetailPage() {
  const t = useTranslations("vocabulary");
  const tm = useTranslations("vocabulary.mode");
  const tq = useTranslations("vocabQuiz");
  const params = useParams();
  const setId = params.id as string;

  // The set's own title, level and size from the server; nothing is shown until (or unless) it loads.
  const setQ = useQuery({
    queryKey: ["vocabulary-set", setId],
    queryFn: () => api.get<{ title: string; level: string; wordCount: number }>(`/v1/vocabulary/sets/${setId}`),
    enabled: !!setId,
  });

  const [mode, setMode] = React.useState<QuizModeType>("mixed");
  const [isQuizStarted, setIsQuizStarted] = React.useState(false);

  const MODES: Array<{ id: QuizModeType; label: string; desc: string }> = [
    { id: "mixed", label: tm("mixed"), desc: tm("mixedDesc") },
    { id: "eng_uzb", label: tm("engUzb"), desc: tm("engUzbDesc") },
    { id: "uzb_eng", label: tm("uzbEng"), desc: tm("uzbEngDesc") },
    { id: "spelling", label: tm("spelling"), desc: tm("spellingDesc") },
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
          <Button variant="ghost" size="sm" className="text-fg-muted hover:text-fg">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToCatalog")}
          </Button>
        </Link>
      </div>

      {/* Mode Selection Header */}
      <div className="rounded-2xl border border-border bg-surface p-6 md:p-8 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-full bg-brand/10 border border-brand/20 text-brand-subtle-fg mb-2">
            <Sparkles className="h-8 w-8" />
          </div>
          {setQ.data && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-lg font-bold text-fg">{setQ.data.title}</span>
              {setQ.data.level && <Badge variant="brand" className="text-xs">{setQ.data.level}</Badge>}
              <span className="text-sm text-fg-muted">{t("words", { count: setQ.data.wordCount })}</span>
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl font-extrabold text-fg">
            {tm("title")}
          </h1>
          <p className="text-sm text-fg-muted max-w-md mx-auto">
            {tq("pointsRule")}
          </p>
        </div>

        {/* Mode cards */}
        <div role="radiogroup" aria-label={tm("title")} className="space-y-3">
          {MODES.map((m) => {
            const isSelected = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setMode(m.id)}
                className={`w-full rounded-xl border p-4 text-left transition-all duration-200 flex items-center justify-between gap-4 ${
                  isSelected
                    ? "border-brand bg-brand/10 shadow-md shadow-brand/5 ring-1 ring-brand"
                    : "border-border bg-surface hover:bg-bg-subtle/50 hover:border-border"
                }`}
              >
                <div className="space-y-1">
                  <div className="font-semibold text-fg text-sm flex items-center gap-2">
                    <span>{m.label}</span>
                    {isSelected && (
                      <Badge className="bg-brand text-brand-fg text-[10px] h-4 px-1.5">
                        {tm("selected")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-fg-muted">{m.desc}</p>
                </div>
                <div
                  className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${
                    isSelected ? "border-brand bg-brand text-brand-fg" : "border-border-strong"
                  }`}
                >
                  {isSelected && <div className="h-2 w-2 rounded-full bg-surface" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Start CTA */}
        <Button
          type="button"
          onClick={() => setIsQuizStarted(true)}
          className="w-full bg-brand hover:bg-brand-hover text-brand-fg h-12 text-base font-semibold shadow-lg shadow-brand/20"
        >
          {tm("start")}
        </Button>
      </div>
    </div>
  );
}
