"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { assessmentPollingInterval } from "@/lib/assessment-model";
import type { AssessmentReviewInput, AttemptAssessments } from "@/lib/assessment-types";

export function useAttemptAssessments(attemptId: string, enabled = true) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [requests, setRequests] = useState(0);
  const query = useQuery({
    queryKey: ["attempt-assessments", attemptId],
    queryFn: async () => {
      setRequests((count) => count + 1);
      return api.get<AttemptAssessments>(`/assessment/attempts/${encodeURIComponent(attemptId)}`);
    },
    enabled: enabled && !!attemptId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
    refetchInterval: (current) => assessmentPollingInterval(current.state.data, requests, Date.now() - startedAt, !!current.state.error),
  });
  return {
    ...query,
    refresh: () => {
      setStartedAt(Date.now());
      setRequests(0);
      return query.refetch();
    },
    // A request is made every 15 seconds, so the request cap is also the
    // five-minute wall-clock cap. Avoid reading Date.now() during render.
    pollingStopped: !!query.data && (requests >= 20 || assessmentPollingInterval(query.data, requests, 0, query.isError) === false),
  };
}

export function useReviewAssessment(attemptId: string, jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssessmentReviewInput) => api.post(`/assessment/jobs/${encodeURIComponent(jobId)}/review`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attempt-assessments", attemptId] });
      qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] });
      qc.invalidateQueries({ queryKey: ["mock-attempts"] });
      qc.invalidateQueries({ queryKey: ["mock-attempts-mine"] });
    },
  });
}
