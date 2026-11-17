"use client";

import * as React from "react";
import { Headphones, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const DUMMY_AUDIO =
  "https://www.w3schools.com/html/horses-o-g-g.mp3"; // fallback placeholder (short beep-like)

// allow real URL passed via prompt [audio] http...
export function extractAudio(prompt: string): { cleanPrompt: string; audioUrl: string | null; hasAudio: boolean } {
  const trimmed = prompt.trim();
  if (trimmed.startsWith("[audio]")) {
    const after = trimmed.slice("[audio]".length).trim();
    // first token may be url
    const firstLine = after.split("\n")[0].trim();
    const urlMatch = firstLine.match(/https?:\/\/\S+/);
    const audioUrl = urlMatch ? urlMatch[0] : DUMMY_AUDIO;
    // remove the [audio] line from prompt
    const rest = after.replace(urlMatch?.[0] ?? "", "").trim();
    // if rest starts with newline, keep remainder else whole original without tag
    const cleanPrompt = rest || prompt.replace(/^\[audio\]\s*\S*\s*/, "").trim() || prompt;
    return { cleanPrompt, audioUrl, hasAudio: true };
  }
  return { cleanPrompt: prompt, audioUrl: null, hasAudio: false };
}

export function AudioPlayer({
  src,
  title,
}: {
  src?: string | null;
  title?: string;
}) {
  const t = useTranslations("tests");
  const url = src || DUMMY_AUDIO;
  const rawAudioFallback = t("audioFallback") as string;
  const fallbackLabel =
    rawAudioFallback !== "audioFallback" && !rawAudioFallback.endsWith(".audioFallback")
      ? rawAudioFallback
      : "Audio preview — placeholder";

  return (
    <div className="rounded-control border border-border bg-bg-subtle p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
        <span className="grid size-7 place-items-center rounded-full bg-brand-subtle text-brand-subtle-fg">
          <Headphones className="size-4" />
        </span>
        <span>
          {title ??
            (() => {
              const v = t("sections.listening") as string;
              return v !== "sections.listening" && !v.endsWith(".sections.listening") ? v : "Listening";
            })()}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs font-normal text-fg-muted">
          <Volume2 className="size-3.5" />
          {fallbackLabel}
        </span>
      </div>
      <audio controls src={url} preload="none" className="h-10 w-full rounded-field">
        <track kind="captions" />
      </audio>
      <p className="mt-1.5 text-[11px] leading-relaxed text-fg-subtle">
        {(() => {
          const v = t("audioHint") as string;
          return v !== "audioHint" && !v.endsWith(".audioHint")
            ? v
            : "If you can't hear the audio, check your volume. In the real exam the recording is played once.";
        })()}
      </p>
    </div>
  );
}

export function AudioscriptDetails({
  script,
  open = false,
}: {
  script?: string | null;
  open?: boolean;
}) {
  const t = useTranslations("tests");
  const rawLabel = t("audioscript") as string;
  const label =
    rawLabel !== "audioscript" && !rawLabel.endsWith(".audioscript") ? rawLabel : "Audioscript";
  const rawFallback = t("audioscriptFallback") as string;
  const fallback =
    script ??
    (rawFallback !== "audioscriptFallback" && !rawFallback.endsWith(".audioscriptFallback")
      ? rawFallback
      : "Audioscript will appear here after submission in the real exam. This placeholder lets you preview the layout.");

  return (
    <details
      open={open}
      className="group rounded-control border border-border bg-surface open:bg-bg-subtle"
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-fg",
          "hover:text-brand [&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          {label}
        </span>
        <span className="text-xs text-fg-muted group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="border-t border-border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">
        {fallback}
      </div>
    </details>
  );
}
