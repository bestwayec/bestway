"use client";

import * as React from "react";
import { MonitorSmartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { api, ApiError, EXAM_SESSION_ELSEWHERE_EVENT, setExamSession } from "@/lib/api-client";

/** How often the holding tab tells the server it is still here (the server lease is 90 s). */
export const EXAM_SESSION_HEARTBEAT_MS = 30_000;
const CHANNEL = "bw-exam-session";

type SessionState = { status: "checking" | "active" } | { status: "elsewhere"; claimedAt: number | null };

function newSessionId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `tab-${random}`;
}

/**
 * This tab's session id for an attempt. Kept in sessionStorage so a reload stays the same
 * session; a duplicated tab copies sessionStorage, so `useExamSession` asks the other tabs
 * and takes a new id when one of them already uses it.
 */
function storedSessionId(attemptId: string): string {
  const key = `bw_exam_session_${attemptId}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = newSessionId();
    window.sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return newSessionId();
  }
}

/**
 * One active exam session per attempt. The tab that holds the attempt sends its session id
 * with every change; when another tab or device takes over, this tab learns it from the
 * heartbeat or from a refused save and shows the gate. Answers typed here stay in the
 * device queue and are sent after "continue here".
 */
export function useExamSession(attemptId: string, enabled: boolean, onRegained?: () => void) {
  const [state, setState] = React.useState<SessionState>({ status: "checking" });
  const sessionRef = React.useRef<string | null>(null);
  const onRegainedRef = React.useRef(onRegained);
  React.useEffect(() => { onRegainedRef.current = onRegained; }, [onRegained]);

  const claim = React.useCallback(async (takeover: boolean) => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    try {
      await api.post(`/mock/attempts/${attemptId}/session`, { sessionId, takeover });
      setState((previous) => {
        if (previous.status === "elsewhere") queueMicrotask(() => onRegainedRef.current?.());
        return { status: "active" };
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "EXAM_SESSION_ELSEWHERE") return; // the event below sets the state
      // Offline or a server error: never block the student; the next heartbeat tries again.
      setState((previous) => (previous.status === "checking" ? { status: "active" } : previous));
    }
  }, [attemptId]);

  React.useEffect(() => {
    if (!enabled) { setExamSession(attemptId, null); return; }
    let sessionId = storedSessionId(attemptId);
    sessionRef.current = sessionId;
    setExamSession(attemptId, sessionId);

    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(CHANNEL); } catch { channel = null; }
    const onMessage = (event: MessageEvent<{ type: string; attemptId: string; sessionId: string }>) => {
      const message = event.data;
      if (!message || message.attemptId !== attemptId) return;
      if (message.type === "hello" && message.sessionId === sessionRef.current) {
        channel?.postMessage({ type: "duplicate", attemptId, sessionId: message.sessionId });
      } else if (message.type === "duplicate" && message.sessionId === sessionRef.current && !answeredHello) {
        // This tab is a copy of another one: become a separate session.
        sessionId = newSessionId();
        try { window.sessionStorage.setItem(`bw_exam_session_${attemptId}`, sessionId); } catch { /* ignore */ }
        sessionRef.current = sessionId;
        setExamSession(attemptId, sessionId);
        void claim(false);
      }
    };
    // Tabs that were already open answer "duplicate"; this tab only reacts to answers to its own hello.
    let answeredHello = false;
    channel?.addEventListener("message", onMessage);
    channel?.postMessage({ type: "hello", attemptId, sessionId });
    const settle = window.setTimeout(() => { answeredHello = true; }, 1000);

    void claim(false);
    const heartbeat = window.setInterval(() => void claim(false), EXAM_SESSION_HEARTBEAT_MS);
    const onElsewhere = (event: Event) => {
      const detail = (event as CustomEvent<{ attemptId?: string; claimedAt?: number | null }>).detail;
      if (detail?.attemptId === attemptId) setState({ status: "elsewhere", claimedAt: detail.claimedAt ?? null });
    };
    window.addEventListener(EXAM_SESSION_ELSEWHERE_EVENT, onElsewhere);
    const release = () => {
      const id = sessionRef.current;
      if (!id) return;
      void fetch(`/api/backend/mock/attempts/${attemptId}/session/release`, {
        method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: id }),
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.clearTimeout(settle);
      window.clearInterval(heartbeat);
      window.removeEventListener(EXAM_SESSION_ELSEWHERE_EVENT, onElsewhere);
      window.removeEventListener("pagehide", release);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      setExamSession(attemptId, null);
    };
  }, [attemptId, enabled, claim]);

  const takeOver = React.useCallback(() => claim(true), [claim]);
  return { state, takeOver, elsewhere: state.status === "elsewhere" };
}

export function ExamSessionGate({ claimedAt, onTakeOver }: { claimedAt: number | null; onTakeOver: () => Promise<void> | void }) {
  const t = useTranslations("mock.examSession");
  const [busy, setBusy] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { buttonRef.current?.focus(); }, []);
  // 24-hour HH:MM in both languages (the browser's own locale would give "11:42 AM" inside Uzbek text).
  const time = claimedAt ? (() => { const d = new Date(claimedAt); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })() : null;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-session-title"
      aria-describedby="exam-session-body"
      data-testid="exam-session-elsewhere"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-warning-bg text-warning">
          <MonitorSmartphone className="size-7" aria-hidden />
        </div>
        <h2 id="exam-session-title" className="text-xl font-bold text-fg">{t("title")}</h2>
        <p id="exam-session-body" className="mt-2 text-sm leading-relaxed text-fg-muted">
          {time ? t("bodyWithTime", { time }) : t("body")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t("answersSafe")}</p>
        <Button
          ref={buttonRef}
          className="mt-6 min-h-[48px] w-full font-semibold"
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onTakeOver(); } finally { setBusy(false); } }}
        >
          {t("continueHere")}
        </Button>
      </div>
    </div>
  );
}
