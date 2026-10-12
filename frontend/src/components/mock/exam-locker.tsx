"use client";

import * as React from "react";
import { AlertOctagon, Maximize2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ExamLockerProps {
  active: boolean;
  attemptId: string;
  onAnomaly: (event: string) => void;
  onForceSubmit: () => void;
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
  attemptId: _attemptId,
  onAnomaly,
  onForceSubmit,
  children,
}: ExamLockerProps) {
  const [isFullscreen, setIsFullscreen] = React.useState(true);
  const [warningsCount, setWarningsCount] = React.useState(0);
  const [warningModalOpen, setWarningModalOpen] = React.useState(false);
  const [, setLastWarningEvent] = React.useState<string>("");
  const forceSubmittedRef = React.useRef(false);
  const lastViolationTimeRef = React.useRef(0);

  // Keep callback refs stable
  const onAnomalyRef = React.useRef(onAnomaly);
  React.useEffect(() => {
    onAnomalyRef.current = onAnomaly;
  }, [onAnomaly]);

  const onForceSubmitRef = React.useRef(onForceSubmit);
  React.useEffect(() => {
    onForceSubmitRef.current = onForceSubmit;
  }, [onForceSubmit]);

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
      if (!active || forceSubmittedRef.current) return;

      onAnomalyRef.current(eventType);

      const now = Date.now();
      // Debounce strike increments: don't count multiple simultaneous events as multiple strikes
      if (now - lastViolationTimeRef.current < 1500) {
        return;
      }
      lastViolationTimeRef.current = now;

      setWarningsCount((prev) => {
        const next = prev + 1;
        setLastWarningEvent(eventType);
        setWarningModalOpen(true);

        if (next >= 3) {
          forceSubmittedRef.current = true;
          setTimeout(() => {
            onForceSubmitRef.current();
          }, 1500);
        }
        return next;
      });
    },
    [active]
  );

  // 1. Initial fullscreen request on engage
  React.useEffect(() => {
    if (!active) return;
    void requestFullscreenSafe();
  }, [active, requestFullscreenSafe]);

  // 2. Fullscreen tracking & enforcement
  React.useEffect(() => {
    if (!active) return;

    const handleFullscreenChange = () => {
      const full = Boolean(getFullscreenElement());
      setIsFullscreen(full);
      if (!full && !forceSubmittedRef.current) {
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

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
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

      {/* FULLSCREEN BLOCKING OVERLAY */}
      {active && !isFullscreen && (
        <div
          className="fixed inset-0 z-[9998] flex flex-col items-center justify-center bg-black/95 p-6 text-center text-white backdrop-blur-md"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="flex size-16 items-center justify-center rounded-2xl bg-danger/20 text-danger mb-4">
            <Maximize2 className="size-8" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            Imtihon faqat to&apos;liq ekranda o&apos;tkaziladi
          </h2>
          <p className="mt-2 max-w-md text-sm text-neutral-300">
            Tizimdan chiqish yoki oynani kichraytirish taqiqlanadi. Imtihonni davom ettirish uchun to&apos;liq ekranga qayting.
          </p>
          <div className="mt-6">
            <Button
              size="lg"
              className="bg-brand hover:bg-brand/90 text-white font-semibold px-6 shadow-lg"
              onClick={() => void requestFullscreenSafe()}
            >
              <Maximize2 className="mr-2 size-5" />
              To&apos;liq ekranga qaytish
            </Button>
          </div>
        </div>
      )}

      {/* VIOLATION WARNING MODAL (Up to 3 strikes) */}
      {active && warningModalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-danger/40 bg-surface p-6 shadow-2xl text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger/10 text-danger mb-4">
              {warningsCount >= 3 ? (
                <AlertOctagon className="size-8 animate-bounce" />
              ) : (
                <ShieldAlert className="size-8" />
              )}
            </div>

            <h3 className="text-xl font-bold text-fg">
              {warningsCount >= 3
                ? "Imtihon to'xtatildi!"
                : `Qoidabuzarlik aniqlandi! (${warningsCount}/3)`}
            </h3>

            <p className="mt-2 text-sm text-fg-muted">
              {warningsCount >= 3 ? (
                <span className="font-medium text-danger">
                  Siz ruxsat etilgan 3 ta ogohlantirish chegarasidan o&apos;tdingiz. Imtihon javoblaringiz saqlanib, natija avtomatik topshirilmoqda.
                </span>
              ) : (
                <>
                  Imtihon vaqtida boshqa oyna, tab yoki ilovalarga o&apos;tish taqiqlanadi.
                  <br />
                  <span className="font-semibold text-warning mt-1 block">
                    3-ogohlantirishdan so&apos;ng imtihon avtomatik yakunlanadi!
                  </span>
                </>
              )}
            </p>

            <div className="mt-6 flex justify-center">
              {warningsCount >= 3 ? (
                <div className="text-sm font-semibold text-danger animate-pulse">
                  Avtomatik topshirilmoqda...
                </div>
              ) : (
                <Button
                  className="w-full bg-brand text-white"
                  onClick={() => {
                    setWarningModalOpen(false);
                    lastViolationTimeRef.current = Date.now();
                    void requestFullscreenSafe();
                  }}
                >
                  Tushundim, davom etaman
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
