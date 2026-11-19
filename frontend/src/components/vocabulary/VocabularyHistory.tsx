"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMe } from "@/hooks/use-me";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { VocabularyLearnerHistory, VocabularyReviewHistory } from "@/lib/group-contract.generated";

export function VocabularyHistory({ review = false }: { review?: boolean }) {
  const t = useTranslations("vocabularyHistory");
  const { data: me } = useMe();
  const [page, setPage] = useState(1);
  const result = useQuery<VocabularyReviewHistory | VocabularyLearnerHistory>({
    queryKey: ["vocabulary-history", me?.user.id, review, page],
    queryFn: () => review
      ? api.get<VocabularyReviewHistory>("/vocabulary/srs/history", { page, limit: 10 })
      : api.get<VocabularyLearnerHistory>("/student/vocabulary/history", { page, limit: 10 }),
    enabled: Boolean(me?.user.id),
  });
  const rows = result.data?.entries;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">{t(review ? "reviews" : "results")}</h2>
      {result.isPending && <p role="status">{t("loading")}</p>}
      {result.isError && <p role="alert">{t("failed")} <Button onClick={() => void result.refetch()}>{t("retry")}</Button></p>}
      {rows && !rows.length && <p>{t("empty")}</p>}
      {rows && <ul className="space-y-2">
        {rows.map(row => "review__word__english" in row ? (
          <li key={row.id}>{row.review__word__english} · {t(row.correct ? "correct" : "incorrect")} · {t("interval", { days: row.interval_days })} · {t(row.mastered ? "mastered" : "learning")} · {new Date(row.next_review_at).toLocaleString()}</li>
        ) : (
          <li key={row.assignment_id}>{row.assignment__title} · {row.score_percent}% · {new Date(row.completed_at).toLocaleDateString()}</li>
        ))}
      </ul>}
      {result.data && (page > 1 || result.data.hasNext) && <div className="flex gap-2">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("previous")}</Button>
        <Button variant="outline" disabled={!result.data.hasNext} onClick={() => setPage(page + 1)}>{t("next")}</Button>
      </div>}
    </section>
  );
}
