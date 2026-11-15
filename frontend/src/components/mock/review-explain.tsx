"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { formatClock, splitAtEvidence } from "@/lib/review-evidence";
import type { MockAttemptGroup, MockAttemptQuestion, MockSkill } from "@/lib/types";

/** The server gives an absolute API link; the browser plays it through the app's own proxy. */
export function reviewAudioSrc(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const at = url.indexOf("/mock/");
  return at >= 0 ? `/api/backend${url.slice(at)}` : url;
}

/**
 * Where the answer is, for one question of a released result: the Reading passage or the
 * Listening audioscript with the author's words highlighted (scrolled into view), and for
 * Listening the recording with "Play from here". Older questions without this material
 * say so instead of guessing.
 */
export function ReviewExplain({ skill, group, question }: { skill: MockSkill; group: MockAttemptGroup; question: MockAttemptQuestion }) {
  const t = useTranslations("mock.reviewExplain");
  const text = (skill === "listening" ? group.audioScript : group.passageText) ?? "";
  const parts = splitAtEvidence(text, question.evidence);
  const box = React.useRef<HTMLDivElement>(null);
  const mark = React.useRef<HTMLElement>(null);
  const audio = React.useRef<HTMLAudioElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Bring the panel into view, then the highlighted words to the middle of the text box.
    panel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    const container = box.current;
    const target = mark.current;
    if (container && target) container.scrollTop = Math.max(0, target.offsetTop - container.offsetTop - container.clientHeight / 2);
  }, [question.id]);

  const playFrom = () => {
    const element = audio.current;
    if (!element || question.audioStartSec == null) return;
    const start = () => { element.currentTime = question.audioStartSec!; void element.play().catch(() => {}); };
    if (element.readyState >= 1) start();
    else { element.addEventListener("loadedmetadata", start, { once: true }); element.load(); }
  };

  const hasText = Boolean(parts) && text.trim();
  const hasAudio = skill === "listening" && Boolean(group.reviewAudioUrl);
  return (
    <div ref={panel} className="space-y-2 rounded-[8px] border border-border bg-bg-subtle p-3" data-testid="review-explain">
      {hasText ? (
        <div
          ref={box}
          role="region"
          tabIndex={0}
          aria-label={t(skill === "listening" ? "scriptLabel" : "passageLabel")}
          className="max-h-64 overflow-y-auto whitespace-pre-line rounded-[8px] border border-border bg-surface p-3 text-sm leading-relaxed text-fg"
        >
          {parts![0]}
          <mark ref={mark} className="rounded bg-warning-bg px-0.5 text-fg ring-1 ring-warning" data-testid="review-evidence">{parts![1]}</mark>
          {parts![2]}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">{t("noEvidence")}</p>
      )}
      {hasAudio && (
        <div className="flex flex-wrap items-center gap-2">
          <audio ref={audio} controls preload="none" src={reviewAudioSrc(group.reviewAudioUrl)} className="h-10 max-w-full" aria-label={t("recordingLabel")}>
            <track kind="captions" />
          </audio>
          {question.audioStartSec != null && (
            <Button type="button" size="sm" variant="outline" onClick={playFrom}>
              <Play className="mr-1.5 size-4" aria-hidden />
              {t("playFrom", { time: formatClock(question.audioStartSec) })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
