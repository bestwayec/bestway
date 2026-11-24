"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { useMockAttempt } from "@/hooks/use-mock";
import { useMe } from "@/hooks/use-me";
import { MockRunner } from "@/components/mock/mock-runner";
import { MockResultView } from "@/components/mock/mock-result-view";
import { loadQueue, rememberUnconfirmedSubmit, removeEdit } from "@/lib/answer-queue";
import type { MockAttemptDetail } from "@/lib/types";

function LocalAnswerRecovery({ attempt }: { attempt: MockAttemptDetail }) {
  const t = useTranslations("mock.runnerUx");
  const [queue, setQueue] = useState(() => loadQueue(attempt.id));
  useEffect(() => rememberUnconfirmedSubmit(attempt.id, false), [attempt.id]);
  const pending = attempt.sections.flatMap((section) => section.groups.flatMap((group) =>
    group.questions.flatMap((question) => queue[question.id] ? [{ question, edit: queue[question.id] }] : [])));
  if (!pending.length) return null;
  return (
    <details className="mx-auto mb-4 max-w-3xl rounded-control border border-warning-border p-4">
      <summary className="cursor-pointer font-medium">{t("localRecovery")}</summary>
      <p className="mt-2 text-sm">{t("localRecoveryHint")}</p>
      <ul className="my-3 space-y-3">
        {pending.map(({ question, edit }) => (
          <li key={question.id}>
            <p className="font-medium">{question.prompt}</p>
            <p className="whitespace-pre-wrap break-words">{edit.response}</p>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={() => {
        for (const { question, edit } of pending) removeEdit(attempt.id, question.id, edit);
        setQueue(loadQueue(attempt.id));
      }}>
        {t("discardLocalEdits")}
      </Button>
    </details>
  );
}

export function MockAttemptClient({ attemptId }: { attemptId: string }) {
  const tc = useTranslations("common");
  const { data, isLoading, isError, refetch } = useMockAttempt(attemptId);
  const { data: me } = useMe();
  const role = me?.user.role;
  const isStaff = role === "teacher" || role === "admin" || role === "super_admin";

  if (isError && !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  // Xodimga runner emas, kuzatuv + boshqaruv (force-submit/extend/reopen/delete) ko'rinadi.
  if (data.status === "in_progress" && !isStaff) return <MockRunner key={attemptId} attempt={data} refreshAttempt={refetch} />;
  return (
    <>
      {role === "student" && me?.user.id === data.studentId && data.status !== "in_progress" && <LocalAnswerRecovery key={attemptId} attempt={data} />}
      <MockResultView attempt={data} />
    </>
  );
}
