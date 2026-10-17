import type { MockSkill } from "./types";

export interface CheatAnomalyEvent {
  event: string;
  date: string;
  details?: string;
}

export interface LiveMonitoringStudent {
  studentId: string;
  name: string;
  phone?: string;
  avatarUrl?: string | null;
  attemptId: string;
  examId: string;
  examTitle: string;
  currentSection: MockSkill | string;
  startedAt: string;
  timeActiveSeconds?: number;
  antiCheatCount: number;
  anomalies?: CheatAnomalyEvent[];
}

export interface GroupLiveMonitoringData {
  groupId: string;
  groupName: string;
  activeCount: number;
  students: LiveMonitoringStudent[];
}
