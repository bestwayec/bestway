"use client";

import * as React from "react";
import type { GuardAlertIncident, GuardIncidentStatus } from "@/lib/types";

export interface GuardAlertsContextValue {
  enabled: boolean;
  incidents: GuardAlertIncident[];
  unreadCount: number;
  muted: boolean;
  toggleMute: () => void;
  reviewIncident: (incidentId: string, status: Exclude<GuardIncidentStatus, "open">, note?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const GuardAlertsContext = React.createContext<GuardAlertsContextValue | null>(null);

export function useTeacherGuardAlerts() {
  return React.useContext(GuardAlertsContext);
}
