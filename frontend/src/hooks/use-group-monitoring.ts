"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { GroupLiveMonitoringData, LiveMonitoringStudent } from "@/lib/group-monitoring-types";

export function useGroupLiveMonitoring(groupId: string) {
  return useQuery({
    queryKey: ["group-live-monitoring", groupId],
    queryFn: async () => {
      try {
        const res = await api.get<GroupLiveMonitoringData | LiveMonitoringStudent[]>(
          `/assessment/groups/${encodeURIComponent(groupId)}/live-monitoring`
        );
        if (Array.isArray(res)) {
          return {
            groupId,
            groupName: "",
            activeCount: res.length,
            students: res,
          } as GroupLiveMonitoringData;
        }
        return res;
      } catch {
        return {
          groupId,
          groupName: "",
          activeCount: 0,
          students: [],
        } as GroupLiveMonitoringData;
      }
    },
    enabled: !!groupId,
    refetchInterval: 10_000,
  });
}
