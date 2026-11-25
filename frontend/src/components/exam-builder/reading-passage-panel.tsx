"use client";

import type { DisplayPassage } from "./reading-preview-model";

/**
 * Left panel of the Reading preview: passage source content ONLY.
 *
 * Never renders question numbers, answer inputs, radios, checkboxes, selects,
 * gap-fill inputs, task instructions, or any completion task. Interactive
 * question documents always belong to the right panel.
 */
export function ReadingPassagePanel({
  passage,
  labelledBy,
}: {
  passage: DisplayPassage;
  labelledBy?: string;
}) {
  const audioSrc = passage.hasAudio ? `/api/backend/mock/groups/${passage.audioGroupId}/audio` : null;
  const imageSrc = passage.imageUrl ? `/api/backend/mock/groups/${passage.imageGroupId}/image` : null;
  const titleId = passage.title ? labelledBy : undefined;
  const hasPassageText = !!passage.passageText?.trim();

  return (
    <article
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : `Passage ${passage.ordinal}`}
      className="min-w-0"
    >
      <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-fg">
        Passage {passage.ordinal}
      </p>
      {passage.rangeLabel && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          You should spend about 20 minutes on Questions {passage.rangeLabel}, which are based on
          Reading Passage {passage.ordinal}.
        </p>
      )}
      {passage.title && (
        <h2 id={titleId} className="mt-2 text-xl font-bold leading-tight text-fg md:text-2xl">
          {passage.title}
        </h2>
      )}
      {audioSrc && (
        <audio controls src={audioSrc} className="mt-3 w-full" preload="none">
          <track kind="captions" />
        </audio>
      )}
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated /api/backend mock image route; next/image optimizer bypass is intentional
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className="mt-4 max-h-96 w-full rounded-chip border border-border object-contain"
        />
      )}
      {hasPassageText ? (
        <div className="mt-3 whitespace-pre-line break-words text-[15px] leading-8 text-fg">
          {passage.passageText}
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-subtle">No passage text available.</p>
      )}
    </article>
  );
}
