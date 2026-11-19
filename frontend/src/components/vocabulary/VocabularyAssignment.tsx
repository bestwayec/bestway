"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api-client";
import type { VocabularyCard, VocabularyFlashcardChange, VocabularyFlashcards, VocabularyMode } from "@/lib/group-contract.generated";
import { useMe } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { VocabularyQuizRunner } from "@/components/vocabulary/VocabularyQuizRunner";

export function VocabularyAssignment({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("vocabularyAssignment");
  const te = useTranslations("vocabularyEditor");
  const [mode, setMode] = useState<VocabularyMode>();
  const [revealed, setRevealed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioErrorFor, setAudioErrorFor] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const { data: me } = useMe();
  const enabled = me?.user.role === "student";
  const client = useQueryClient();
  const path = `/student/assignments/${encodeURIComponent(assignmentId)}/vocabulary`;
  const progressKey = ["vocabulary-flashcards", me?.user.id, assignmentId] as const;
  const cards = useQuery({
    queryKey: ["vocabulary-assignment-cards", me?.user.id, assignmentId],
    enabled,
    queryFn: () => api.get<VocabularyCard[]>(path + "/words"),
  });
  const progress = useQuery({
    queryKey: progressKey,
    enabled,
    queryFn: () => api.get<VocabularyFlashcards>(path + "/flashcards"),
    refetchOnWindowFocus: true,
  });
  const save = useMutation({
    mutationFn: (body: VocabularyFlashcardChange) => api.patch<VocabularyFlashcards>(path + "/flashcards", body),
    onSuccess: data => client.setQueryData(progressKey, data),
  });
  const order = progress.data?.order.length ? progress.data.order : cards.data?.map(card => card.id) ?? [];
  const index = Math.max(0, order.indexOf(progress.data?.lastWordId ?? ""));
  const card = cards.data?.find(item => item.id === order[index]);
  const canSpeak = typeof window !== "undefined" && !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;

  if (mode) {
    return <VocabularyQuizRunner assignmentId={assignmentId} mode={mode} onExit={() => setMode(undefined)} />;
  }

  function navigate(step: number) {
    if (!order.length || save.isPending) return;
    save.mutate({ lastWordId: order[(index + step + order.length) % order.length] });
    setRevealed(false);
  }

  function shuffle() {
    const shuffled = [...order];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    save.mutate({ order: shuffled, lastWordId: shuffled[0] });
    setRevealed(false);
  }

  async function pronounce() {
    if (!card || muted) return;
    setAudioErrorFor(undefined);
    const recording = audio.current;
    if (recording) {
      try {
        if (recording.readyState) recording.currentTime = 0;
        await recording.play();
        return;
      } catch (error) {
        if (recording !== audio.current || recording.muted || (error instanceof DOMException && error.name === "AbortError")) return;
      }
    }
    if (!canSpeak) {
      setAudioErrorFor(card.id);
      return;
    }
    const speech = new SpeechSynthesisUtterance(card.english);
    speech.lang = "en-US";
    speech.onerror = event => {
      if (event.error !== "canceled" && event.error !== "interrupted") setAudioErrorFor(card.id);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
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
        {(cards.isPending || progress.isPending) && <p role="status">{t("loading")}</p>}
        {(cards.isError || progress.isError) && <p role="alert">{t("failed")} <Button onClick={() => { void cards.refetch(); void progress.refetch(); }}>{t("retry")}</Button></p>}
        {card && progress.isSuccess && (
          <>
            <Button className="min-h-24 w-full text-lg" variant="outline" aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>
              {revealed ? card.uzbek : card.english}
            </Button>
            {revealed && <div className="space-y-1 text-sm">
              {card.definition && <p>{card.definition}</p>}
              {card.contextSentence && <p>{card.contextSentence}</p>}
              {card.synonyms?.length ? <p>{card.synonyms.join(", ")}</p> : null}
              {card.pronunciation && <p>{card.pronunciation}</p>}
              {card.level && <p>{card.level}</p>}
            </div>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={save.isPending} onClick={() => navigate(-1)}>{t("previous")}</Button>
              <span aria-live="polite">{index + 1} / {order.length}</span>
              <Button variant="outline" disabled={save.isPending} onClick={() => navigate(1)}>{t("next")}</Button>
              <Button variant="outline" disabled={save.isPending} onClick={shuffle}>{te("shuffle")}</Button>
              {(["known", "practice"] as const).map(status => (
                <Button key={status} variant="outline" disabled={save.isPending} aria-pressed={progress.data.familiarity[card.id] === status}
                  onClick={() => save.mutate({ lastWordId: card.id, wordId: card.id, status })}>{te(status)}</Button>
              ))}
              {(card.audioUrl || canSpeak) && <>
                <Button variant="outline" disabled={muted} onClick={() => void pronounce()}>{te("pronounce")}</Button>
                <Button variant="outline" aria-pressed={muted} onClick={() => {
                  audio.current?.pause();
                  window.speechSynthesis?.cancel();
                  setMuted(value => !value);
                }}>
                  {te(muted ? "unmute" : "mute")}
                </Button>
              </>}
            </div>
            {card.audioUrl && <audio key={card.id} ref={audio} muted={muted} preload="none" src={card.audioUrl} />}
            {audioErrorFor === card.id && <p role="status">{te("audioUnavailable")}</p>}
            {save.isPending && <p role="status">{te(save.isPaused ? "pendingOffline" : "sync")}</p>}
            {save.isSuccess && <p role="status">{te("saved")}</p>}
            {save.isError && <p role="alert">{save.error instanceof Error ? save.error.message : t("failed")}</p>}
          </>
        )}
      </div>
    </section>
  );
}
