"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api-client";
import type { VocabularyCard, VocabularyMode } from "@/lib/group-contract.generated";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { VocabularyQuizRunner } from "@/components/vocabulary/VocabularyQuizRunner";

export function VocabularyAssignment({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("vocabularyAssignment");
  const [mode, setMode] = useState<VocabularyMode>();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const { data: me } = useMe();
  const cards = useQuery({
    queryKey: ["vocabulary-assignment-cards", me?.user.id, assignmentId],
    enabled: me?.user.role === "student",
    queryFn: () => api.get<VocabularyCard[]>(`/student/assignments/${encodeURIComponent(assignmentId)}/vocabulary/words`),
  });
  const card = cards.data?.[index];

  if (mode) {
    return <VocabularyQuizRunner assignmentId={assignmentId} mode={mode} onExit={() => setMode(undefined)} />;
  }

  function navigate(step: number) {
    const length = cards.data?.length ?? 0;
    if (length) setIndex(current => (current + step + length) % length);
    setRevealed(false);
  }

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">{t("heading")}</h1>
      <div className="flex flex-wrap gap-2">
        {(["mixed", "spelling", "eng_uzb", "uzb_eng"] as const).map(value => (
          <Button type="button" key={value} onClick={() => setMode(value)}>{t(value)}</Button>
        ))}
        <Button asChild variant="outline"><Link href="/vocabulary/srs">{t("review")}</Link></Button>
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold">{t("cards")}</h2>
        {cards.isPending && <p role="status">{t("loading")}</p>}
        {cards.isError && <p role="alert">{t("failed")} <Button onClick={() => void cards.refetch()}>{t("retry")}</Button></p>}
        {card && (
          <>
            <Button className="min-h-24 w-full text-lg" variant="outline" aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>
              {revealed ? card.uzbek : card.english}
            </Button>
            {revealed && card.contextSentence && <p>{card.contextSentence}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => navigate(-1)}>{t("previous")}</Button>
              <span aria-live="polite">{index + 1} / {cards.data?.length}</span>
              <Button variant="outline" onClick={() => navigate(1)}>{t("next")}</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
