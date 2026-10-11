"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AiRankingSkill, GroupAiRankingData } from "@/lib/ai-ranking-types";

export function useGroupAiRanking(groupId: string, examId?: string, skill: AiRankingSkill = "writing") {
  const query = new URLSearchParams({ skill });
  if (examId) query.set("examId", examId);
  return useQuery({
    queryKey: ["group-ai-ranking", groupId, examId ?? null, skill],
    queryFn: () => api.get<GroupAiRankingData>(`/assessment/groups/${encodeURIComponent(groupId)}/rankings?${query}`),
    enabled: !!groupId,
    refetchInterval: examId ? 30_000 : false,
  });
}
