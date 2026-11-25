"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function AttemptRecordingPlayer({ src, className }: { src: string; className?: string }) {
  const t = useTranslations("mock.runnerUx");
  const [status, setStatus] = useState<"ready" | "unknown-duration" | "failed">("ready");
  return (
    <>
      <audio
        controls
        src={src}
        aria-label={t("playRecording")}
        className={className}
        preload="metadata"
        onError={() => setStatus("failed")}
        onDurationChange={(event) => {
          const duration = event.currentTarget.duration;
          setStatus(Number.isFinite(duration) && duration > 0 ? "ready" : "unknown-duration");
        }}
      >
        <track kind="captions" />
      </audio>
      {status === "failed" && <p role="status" className="text-sm text-danger">{t("recordingPlaybackError")}</p>}
      {status === "unknown-duration" && <p className="text-sm text-fg-muted">{t("recordingDurationUnknown")}</p>}
    </>
  );
}
