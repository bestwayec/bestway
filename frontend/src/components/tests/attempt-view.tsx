"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { TestRunner } from "@/components/tests/test-runner";
import { AttemptReview } from "@/components/tests/attempt-review";
import { useAttempt } from "@/hooks/use-tests";

export function AttemptView({ attemptId }: { attemptId: string }) {
  const tc = useTranslations("common");
  const { data, isLoading, isError, refetch } = useAttempt(attemptId);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState
          title={tc("error")}
          description={tc("unknownError")}
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
        <Skeleton className="h-14 w-full rounded-card" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
        <Card className="p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-3 h-10 w-full" />
          <Skeleton className="mt-2 h-24 w-full" />
        </Card>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (data.status === "in_progress") {
    return <TestRunner attempt={data} />;
  }

  // grading | completed both show review (staff can grade, student sees result)
  return <AttemptReview attempt={data} />;
}
