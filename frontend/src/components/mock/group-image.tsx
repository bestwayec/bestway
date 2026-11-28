"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const media = (path: string) => `/api/backend${path}`;

/**
 * Exam pictures and maps are protected: always load them through the same-origin
 * /api/backend proxy, which carries the httpOnly session. The absolute API URL
 * from the payload is cross-origin and is refused without credentials.
 */
export function GroupImage({ groupId, alt, compact = false }: { groupId: string; alt: string; compact?: boolean }) {
  const t = useTranslations("mock.runnerUx");
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [enlarged, setEnlarged] = React.useState(false);
  const src = `${media(`/mock/groups/${groupId}/image`)}${attempt ? `?retry=${attempt}` : ""}`;
  if (failed) {
    return (
      <div role="alert" className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-fg-muted">
        <span>{t("pictureLoadError")}</span>
        <button
          type="button"
          onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}
          className="min-h-[40px] rounded-lg border border-border px-3 font-semibold text-fg hover:bg-surface-hover"
        >
          {t("pictureRetry")}
        </button>
      </div>
    );
  }
  return (
    <figure className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy media; next/image cannot forward the session */}
      <img
        src={src}
        alt={alt}
        decoding="async"
        data-testid="exam-group-image"
        onError={() => setFailed(true)}
        className={cn("w-full rounded-lg border border-border/80 object-contain shadow-sm", compact ? "max-h-[min(38dvh,22rem)]" : "max-h-[65vh]")}
      />
      {/* The original picture, larger (charts, maps and process diagrams); the same protected file. */}
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="absolute right-2 top-2 inline-flex min-h-9 items-center gap-1 rounded-control border border-border bg-surface/95 px-2 text-sm font-medium text-fg shadow-xs hover:bg-surface-hover"
        aria-label={t("pictureEnlarge", { name: alt })}
        data-testid="exam-image-enlarge"
      >
        <Maximize2 className="size-4" aria-hidden />
        <span className="max-sm:sr-only">{t("pictureEnlargeShort")}</span>
      </button>
      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent className="max-h-[96dvh] w-[96vw] max-w-[96vw] overflow-auto p-3 sm:p-4">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element -- same authenticated proxy media */}
          <img src={src} alt={alt} className="mx-auto h-auto max-h-[88dvh] w-auto max-w-full object-contain" />
        </DialogContent>
      </Dialog>
    </figure>
  );
}
