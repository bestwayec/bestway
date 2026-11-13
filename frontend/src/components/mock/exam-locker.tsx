"use client";

import * as React from "react";
import { Maximize2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FULLSCREEN_GUARD_EVENT } from "@/lib/microphone";

export interface ExamLockerProps {
  active: boolean;
  attemptId: string;
  onAnomaly: (event: string) => void;
  children: React.ReactNode;
}

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const doc = document as FullscreenDocument;
  return (
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    null
  );
}

export function ExamLocker({
  active,
  attemptId,
  onAnomaly,
  children,
}: ExamLockerProps) {
  const t = useTranslations("mock.locker");
  // Shown once per attempt: the browser's own "exit full screen" toast is system text we cannot
  // translate, so say in Uzbek what it is before the exam starts.
  const noticeKey = `bw_fullscreen_notice_${attemptId}`;
  const [noticeOpen, setNoticeOpen] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    try {
      if (window.sessionStorage.getItem(noticeKey)) return;
    } catch {
      // storage unavailable: show the notice every time
    }
    setNoticeOpen(true);
  }, [active, noticeKey]);
  const [isFullscreen, setIsFullscreen] = React.useState(true);
  const [warningsCount, setWarningsCount] = React.useState(0);
  const [warningModalOpen, setWarningModalOpen] = React.useState(false);
  // iPhone Safari and some embedded browsers have no full-screen API: nothing to ask for there.
  const [fullscreenSupported] = React.useState(() => {
    if (typeof document === "undefined") return false;
    const el = document.documentElement as FullscreenElement;
    return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
  });
  // Paused while the app itself leaves full screen for a moment (microphone permission prompt).
  const guardPausedRef = React.useRef(false);
  const lastViolationTimeRef = React.useRef(0);

  // Keep callback refs stable
  const onAnomalyRef = React.useRef(onAnomaly);
  React.useEffect(() => {
    onAnomalyRef.current = onAnomaly;
  }, [onAnomaly]);


  const requestFullscreenSafe = React.useCallback(async () => {
    try {
      if (getFullscreenElement()) {
        setIsFullscreen(true);
        return;
      }
      const el = document.documentElement as FullscreenElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      // Browser may require direct user interaction click
      setIsFullscreen(Boolean(getFullscreenElement()));
    }
  }, []);

  const triggerViolation = React.useCallback(
    (eventType: string) => {
      if (!active || guardPausedRef.current) return;

      onAnomalyRef.current(eventType);

      const now = Date.now();
      // Debounce strike increments: don't count multiple simultaneous events as multiple strikes
      if (now - lastViolationTimeRef.current < 1500) {
        return;
      }
      lastViolationTimeRef.current = now;

      setWarningsCount((prev) => {
        const next = prev + 1;
        setWarningModalOpen(true);

        // Recorded for the teacher; the exam is never stopped or handed in because of it.
        return next;
      });
    },
    [active]
  );

  // 1. Full screen is requested only from the student's click on the start notice (browsers
  //    refuse it without a user gesture), never automatically.

  // 2. Fullscreen tracking & enforcement
  React.useEffect(() => {
    if (!active) return;

    const handleFullscreenChange = () => {
      if (guardPausedRef.current) return;
      const full = Boolean(getFullscreenElement());
      setIsFullscreen(full);
      if (!full) {
        triggerViolation("exit_fullscreen");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [active, triggerViolation]);

  // 2b. Short, app-initiated full-screen exit (see requestMicrophoneStream)
  React.useEffect(() => {
    if (!active) return;
    let expire: ReturnType<typeof setTimeout> | undefined;
    const onGuard = (event: Event) => {
      const paused = Boolean((event as CustomEvent<{ paused?: boolean }>).detail?.paused);
      if (expire) clearTimeout(expire);
      guardPausedRef.current = paused;
      if (paused) {
        // Never stay unguarded: a permission prompt that is never answered must not disable the guard.
        expire = setTimeout(() => { guardPausedRef.current = false; setIsFullscreen(Boolean(getFullscreenElement())); }, 60_000);
      } else {
        lastViolationTimeRef.current = Date.now();
        setIsFullscreen(Boolean(getFullscreenElement()));
      }
    };
    window.addEventListener(FULLSCREEN_GUARD_EVENT, onGuard);
    return () => {
      if (expire) clearTimeout(expire);
      guardPausedRef.current = false;
      window.removeEventListener(FULLSCREEN_GUARD_EVENT, onGuard);
    };
  }, [active]);

  // 3. Tab switch & blur detection
  React.useEffect(() => {
    if (!active) return;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        triggerViolation("tab_switch");
      }
    };

    const handleBlur = () => {
      // If the document is already hidden, visibilitychange handles it
      if (document.visibilityState === "hidden") return;
      triggerViolation("window_blur");
    };

    const handleMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget && e.clientY <= 0) {
        triggerViolation("mouse_leave");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);
    document.documentElement.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [active, triggerViolation]);

  // 4. Clipboard & DevTools & Shortcut blocking
  React.useEffect(() => {
    if (!active) return;

    const lastReportTimeRef = new Map<string, number>();
    const reportAnomalyThrottled = (type: string) => {
      const now = Date.now();
      const last = lastReportTimeRef.get(type) ?? 0;
      if (now - last < 500) return;
      lastReportTimeRef.set(type, now);
      onAnomalyRef.current(type);
    };

    const blockEvent = (e: Event, type: string) => {
      e.preventDefault();
      e.stopPropagation();
      reportAnomalyThrottled(type);
    };

    const onCopy = (e: Event) => blockEvent(e, "copy_blocked");
    const onCut = (e: Event) => blockEvent(e, "cut_blocked");
    const onPaste = (e: Event) => blockEvent(e, "paste_blocked");
    const onContextMenu = (e: Event) => blockEvent(e, "contextmenu_blocked");

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      // Block F12
      if (key === "F12") {
        blockEvent(e, "devtools_attempt");
        return;
      }

      // Block Ctrl+Shift+I / J / C (DevTools on Win/Linux) or Cmd+Opt+I/J/C (DevTools on Mac)
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "J", "C"].includes(key.toUpperCase())) ||
        (e.metaKey && e.altKey && ["I", "J", "C"].includes(key.toUpperCase()))
      ) {
        blockEvent(e, "devtools_attempt");
        return;
      }

      // Block Ctrl+U / Cmd+U (View Source)
      if ((e.ctrlKey || e.metaKey) && (key === "u" || key === "U")) {
        blockEvent(e, "view_source_attempt");
        return;
      }
    };

    document.addEventListener("copy", onCopy, { capture: true });
    document.addEventListener("cut", onCut, { capture: true });
    document.addEventListener("paste", onPaste, { capture: true });
    document.addEventListener("contextmenu", onContextMenu, { capture: true });
    window.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      document.removeEventListener("copy", onCopy, { capture: true });
      document.removeEventListener("cut", onCut, { capture: true });
      document.removeEventListener("paste", onPaste, { capture: true });
      document.removeEventListener("contextmenu", onContextMenu, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [active]);

  return (
    <>
      {children}

      {active && noticeOpen && (
        <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="exam-fullscreen-notice-title" data-testid="fullscreen-notice">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-subtle text-brand-subtle-fg"><Maximize2 className="size-7" /></div>
            <h3 id="exam-fullscreen-notice-title" className="text-xl font-bold text-fg">{t("startTitle")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t("startBody")}</p>
            <Button
              className="mt-6 min-h-[48px] w-full bg-brand font-semibold text-brand-fg touch-manipulation"
              onClick={() => {
                try { window.sessionStorage.setItem(noticeKey, "1"); } catch { /* ignore */ }
                setNoticeOpen(false);
                void requestFullscreenSafe();
              }}
            >
              {t("startButton")}
            </Button>
          </div>
        </div>
      )}

      {/* Non-blocking notices: the exam always stays usable; every exit is only recorded. */}
      {active && !noticeOpen && (warningModalOpen || (!isFullscreen && fullscreenSupported)) && (
        <div
          role="status"
          aria-live="polite"
          data-testid="exam-integrity-notice"
          className="fixed inset-x-3 top-3 z-[9998] mx-auto flex max-w-xl flex-col gap-2 rounded-[12px] border border-warning-border bg-surface p-3 text-sm text-fg shadow-lg sm:flex-row sm:items-center"
        >
          <ShieldAlert className="size-5 shrink-0 text-warning" aria-hidden />
          <p className="flex-1">
            {warningModalOpen ? t("recorded", { count: warningsCount }) : t("notFullscreen")}
          </p>
          <div className="flex gap-2">
            {!isFullscreen && fullscreenSupported && (
              <Button size="sm" className="min-h-[44px]" onClick={() => { setWarningModalOpen(false); lastViolationTimeRef.current = Date.now(); void requestFullscreenSafe(); }}>
                <Maximize2 className="size-4" aria-hidden />
                {t("returnFullscreen")}
              </Button>
            )}
            {warningModalOpen && (
              <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setWarningModalOpen(false)}>
                {t("dismiss")}
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
