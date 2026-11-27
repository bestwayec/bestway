"use client";

import * as React from "react";
import { Check, ExternalLink, Flag, MessageSquare, ShieldAlert, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { GuardAlertIncident, GuardIncidentStatus, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  GuardAlertsContext,
  useTeacherGuardAlerts,
  type GuardAlertsContextValue,
} from "./guard-alerts-context";

interface GuardAlertsResponse {
  incidents: GuardAlertIncident[];
  unreadCount: number;
  seq: number;
  serverTime: string;
}

export { useTeacherGuardAlerts };

function playSoftPing() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    window.setTimeout(() => { void ctx.close().catch(() => {}); }, 250);
  } catch {
    // Audio playback can fail without prior gesture; keep silent
  }
}

function eventLabel(tl: (key: string, values?: Record<string, string | number>) => string, eventType: string) {
  const known = [
    "tab_switch",
    "window_blur",
    "exit_fullscreen",
    "fullscreen_exit",
    "mouse_leave",
    "copy_blocked",
    "cut_blocked",
    "paste_blocked",
    "contextmenu_blocked",
    "devtools_attempt",
    "view_source_attempt",
  ];
  return known.includes(eventType) ? tl(`events.${eventType}`) : tl("events.other", { event: eventType });
}

export function TeacherGuardAlertsProvider({
  role,
  children,
}: {
  role: Role;
  children?: React.ReactNode;
}) {
  const tg = useTranslations("liveMonitoring.guard");
  const tl = useTranslations("mock.examLog");
  const enabled = role === "teacher" || role === "admin" || role === "super_admin";

  const [incidents, setIncidents] = React.useState<GuardAlertIncident[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [muted, setMuted] = React.useState(false);

  const hydratedRef = React.useRef(false);
  const lastSeqRef = React.useRef(0);
  const seenIdsRef = React.useRef<Set<string>>(new Set());
  const mutedRef = React.useRef(muted);
  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    try {
      setMuted(window.localStorage.getItem("bw_guard_alerts_muted") === "1");
    } catch {
      // storage unavailable
    }
  }, []);

  const toggleMute = React.useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("bw_guard_alerts_muted", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const reviewIncident = React.useCallback(
    async (incidentId: string, status: Exclude<GuardIncidentStatus, "new">, note = "") => {
      const updated = await api.post<GuardAlertIncident>(
        `/teacher/guard-alerts/${encodeURIComponent(incidentId)}/review`,
        { status, note },
      );
      setIncidents((prev) => {
        const next = prev.map((item) => (item.id === incidentId ? { ...item, ...updated } : item));
        setUnreadCount(next.filter((item) => item.status === "new").length);
        return next;
      });
      toast.success(tg("acknowledgedToast"));
    },
    [tg],
  );

  const fetchAlerts = React.useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await api.get<GuardAlertsResponse>("/teacher/guard-alerts?limit=25");
      if (!data || !Array.isArray(data.incidents)) return;
      setIncidents(data.incidents);
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : data.incidents.filter((i) => i.status === "new").length);

      if (!hydratedRef.current) {
        hydratedRef.current = true;
        lastSeqRef.current = data.seq ?? 0;
        for (const item of data.incidents) {
          seenIdsRef.current.add(item.id);
        }
        return;
      }

      const fresh = data.incidents.filter(
        (item) => item.status === "new" && !seenIdsRef.current.has(item.id),
      );
      for (const item of data.incidents) {
        seenIdsRef.current.add(item.id);
      }
      if ((data.seq ?? 0) > lastSeqRef.current || fresh.length > 0) {
        lastSeqRef.current = Math.max(lastSeqRef.current, data.seq ?? 0);
        const latest = fresh[0];
        if (latest) {
          if (!mutedRef.current) playSoftPing();
          toast.warning(
            tg("toastTitle", {
              student: latest.studentName,
              event: eventLabel(tl, latest.eventType),
            }),
            {
              description: tg("toastMeta", {
                group: latest.groupName || "—",
                skill: latest.skill || latest.examTitle || "—",
              }),
              action: {
                label: tg("acknowledge"),
                onClick: () => {
                  void reviewIncident(latest.id, "acknowledged");
                },
              },
            },
          );
        }
      }
    } catch {
      // keep polling quietly on transient errors
    }
  }, [enabled, reviewIncident, tg, tl]);

  React.useEffect(() => {
    if (!enabled) return;
    void fetchAlerts();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchAlerts();
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [enabled, fetchAlerts]);

  const value = React.useMemo<GuardAlertsContextValue>(
    () => ({
      enabled,
      incidents,
      unreadCount,
      muted,
      toggleMute,
      reviewIncident,
      refresh: fetchAlerts,
    }),
    [enabled, incidents, unreadCount, muted, toggleMute, reviewIncident, fetchAlerts],
  );

  return <GuardAlertsContext.Provider value={value}>{children}</GuardAlertsContext.Provider>;
}

export function GuardAlertsBell() {
  const ctx = useTeacherGuardAlerts();
  const tg = useTranslations("liveMonitoring.guard");
  const tl = useTranslations("mock.examLog");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ctx || !ctx.enabled) return null;

  async function onReview(id: string, status: Exclude<GuardIncidentStatus, "new">) {
    setBusyId(id);
    try {
      await ctx?.reviewIncident(id, status);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen((v) => !v)}
        aria-label={tg("bellTitle")}
        aria-expanded={open}
        data-testid="guard-alerts-bell"
        className="relative"
      >
        <ShieldAlert
          className={cn("size-4", ctx.unreadCount > 0 ? "text-warning" : "text-fg-muted")}
          aria-hidden
        />
        {ctx.unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-bg tabular-nums">
            {ctx.unreadCount > 99 ? "99+" : ctx.unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={tg("bellTitle")}
          className="fixed inset-x-3 top-16 z-50 rounded-card border border-border bg-surface p-3 shadow-e3 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-warning" aria-hidden />
              <span className="text-sm font-semibold text-fg">{tg("bellTitle")}</span>
              {ctx.unreadCount > 0 && (
                <Badge variant="warning">{tg("unreadBadge", { count: ctx.unreadCount })}</Badge>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={ctx.toggleMute}
              title={ctx.muted ? tg("unmuteSound") : tg("muteSound")}
              aria-label={ctx.muted ? tg("unmuteSound") : tg("muteSound")}
            >
              {ctx.muted ? <VolumeX className="size-4 text-fg-muted" /> : <Volume2 className="size-4 text-fg" />}
            </Button>
          </div>

          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto overscroll-contain">
            {ctx.incidents.length === 0 ? (
              <p className="py-6 text-center text-xs text-fg-muted">{tg("emptyBell")}</p>
            ) : (
              ctx.incidents.slice(0, 12).map((inc) => (
                <div
                  key={inc.id}
                  className={cn(
                    "rounded-control border p-2.5 text-xs",
                    inc.status === "new"
                      ? "border-warning-border bg-warning-bg"
                      : "border-border bg-bg-subtle",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{inc.studentName}</p>
                      <p className="truncate text-fg-muted">
                        {eventLabel(tl, inc.eventType)}
                        {inc.occurrenceCount > 1 ? ` · ${tg("occurrences", { count: inc.occurrenceCount })}` : ""}
                      </p>
                      <p className="truncate text-[11px] text-fg-subtle">
                        {inc.groupName || "—"} {inc.skill ? `· ${inc.skill}` : ""}
                      </p>
                    </div>
                    <Badge variant={inc.status === "flagged" ? "danger" : inc.status === "new" ? "warning" : "neutral"}>
                      {tg(`statuses.${inc.status}`)}
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {inc.status === "new" && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === inc.id}
                          onClick={() => void onReview(inc.id, "acknowledged")}
                          className="h-7 px-2 text-[11px]"
                        >
                          <Check className="mr-1 size-3" aria-hidden />
                          {tg("acknowledge")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === inc.id}
                          onClick={() => void onReview(inc.id, "explained")}
                          className="h-7 px-2 text-[11px]"
                        >
                          <MessageSquare className="mr-1 size-3" aria-hidden />
                          {tg("explained")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busyId === inc.id}
                          onClick={() => void onReview(inc.id, "flagged")}
                          className="h-7 px-2 text-[11px] text-danger"
                        >
                          <Flag className="mr-1 size-3" aria-hidden />
                          {tg("flag")}
                        </Button>
                      </>
                    )}
                    {inc.groupId && (
                      <Link
                        href={`/groups/${inc.groupId}?tab=guard`}
                        onClick={() => setOpen(false)}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                      >
                        {tg("viewGroup")}
                        <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
