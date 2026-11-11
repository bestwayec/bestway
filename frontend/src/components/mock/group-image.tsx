"use client";

import * as React from "react";

const media = (path: string) => `/api/backend${path}`;

/**
 * Exam pictures and maps are protected: always load them through the same-origin
 * /api/backend proxy, which carries the httpOnly session. The absolute API URL
 * from the payload is cross-origin and is refused without credentials.
 */
export function GroupImage({ groupId, alt }: { groupId: string; alt: string }) {
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const src = `${media(`/mock/groups/${groupId}/image`)}${attempt ? `?retry=${attempt}` : ""}`;
  if (failed) {
    return (
      <div role="alert" className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-fg-muted">
        <span>Rasm yuklanmadi. Internetni tekshirib, qayta urinib ko&apos;ring.</span>
        <button
          type="button"
          onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}
          className="min-h-[40px] rounded-lg border border-border px-3 font-semibold text-fg hover:bg-surface-hover"
        >
          Qayta yuklash
        </button>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy media; next/image cannot forward the session
    <img
      src={src}
      alt={alt}
      decoding="async"
      data-testid="exam-group-image"
      onError={() => setFailed(true)}
      className="max-h-[65vh] w-full rounded-lg border border-border/80 object-contain shadow-sm"
    />
  );
}
