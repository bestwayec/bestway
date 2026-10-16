"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

const COPY: Record<string, string> = {
  uz: "Tarmoq uzildi. Javoblaringiz telefonda xavfsiz saqlanmoqda",
  ru: "Нет сети. Ваши ответы надёжно сохраняются на телефоне",
  en: "Network lost. Your answers are safely stored on your device",
};

/**
 * Bottom notice while offline. Answers stay in the runner's dirty set and are
 * flushed by its `online` listener, so this only informs the student.
 */
export function NetworkBanner() {
  const [locale, setLocale] = useState("uz");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    setLocale((document.documentElement.lang || "uz").slice(0, 2));
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[60] flex items-center gap-2 rounded-[10px] border border-warning/40 bg-surface px-3.5 py-2.5 text-sm text-fg shadow-lg"
    >
      <WifiOff className="size-4 shrink-0 text-warning" aria-hidden />
      <span>{COPY[locale] ?? COPY.uz}</span>
    </div>
  );
}
