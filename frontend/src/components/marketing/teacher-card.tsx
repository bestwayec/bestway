"use client";

import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { TiltCard } from "@/components/ui/tilt-card";
import { cn, safeHref } from "@/lib/utils";

/**
 * Teacher profile data — rendered from the CMS/backend, never hardcoded.
 * Gallery items ("Name — IELTS 8.5") and `/teachers` records both map here.
 */
export interface TeacherProfile {
  id: string;
  name: string;
  /** Role, e.g. "IELTS Instructor" (teacher specialty / gallery caption). */
  title?: string | null;
  /** Short proof, e.g. "IELTS 8.5" — only shown when the backend provides it. */
  achievement?: string | null;
  photoUrl?: string | null;
  /** Optional external profile / social link. No CTA is rendered without it. */
  profileUrl?: string | null;
  /** Optional seniority badge — only shown when the backend provides it. */
  badge?: string | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "B";
}

/**
 * Premium teacher profile card.
 *
 * Interaction engine: the project's existing `TiltCard` (subtle pointer-tracked
 * 3D tilt + dynamic glare, auto-disabled on touch / reduced-motion).
 * Visual layer: BestWay dark charcoal + green — photo dominates, text sits in
 * the lower third over a readability gradient. No holographic/rainbow effects.
 */
export function TeacherProfileCard({
  teacher,
  active = false,
}: {
  teacher: TeacherProfile;
  active?: boolean;
}) {
  const t = useTranslations("marketing");
  const [imgFailed, setImgFailed] = React.useState(false);
  const showPhoto = !!teacher.photoUrl && !imgFailed;

  return (
    <TiltCard
      maxTilt={6}
      className={cn(
        "group relative aspect-[3/4] w-full overflow-hidden rounded-[20px] border bg-surface transition-[border-color,box-shadow] duration-300",
        // restrained green glow — slightly stronger on the active card
        active
          ? "border-border-strong shadow-[0_20px_50px_-24px_color-mix(in_srgb,var(--brand)_65%,transparent)]"
          : "border-border shadow-[0_20px_50px_-28px_color-mix(in_srgb,var(--brand)_40%,transparent)] hover:border-border-strong hover:shadow-[0_20px_50px_-24px_color-mix(in_srgb,var(--brand)_60%,transparent)]",
      )}
    >
      {showPhoto ? (
        <img
          src={teacher.photoUrl!}
          alt={teacher.name}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 h-full w-full scale-[1.06] object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.12] motion-reduce:transition-none motion-reduce:group-hover:scale-[1.06]"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-brand-subtle"
        >
          <span className="text-6xl font-extrabold tracking-tight text-brand-subtle-fg">
            {initials(teacher.name)}
          </span>
        </div>
      )}

      {/* readability gradient — keeps the face clear, text legible */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.45)_38%,transparent_62%)]"
      />

      {/* text block — lower third */}
      <div className="absolute inset-x-0 bottom-0 p-5">
        {teacher.badge && (
          <span className="mb-2.5 inline-flex items-center rounded-full border border-border bg-surface-hover px-2.5 py-1 text-[11px] font-semibold tracking-wide text-fg backdrop-blur-sm">
            {teacher.badge}
          </span>
        )}
        <span aria-hidden className="mb-2 block h-0.5 w-6 rounded-full bg-brand" />
        <h3 className="text-lg leading-snug font-bold text-fg">{teacher.name}</h3>
        {teacher.title && <p className="mt-0.5 text-sm text-fg-muted">{teacher.title}</p>}
        {teacher.achievement && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-fg">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
            {teacher.achievement}
          </p>
        )}
        {safeHref(teacher.profileUrl) && (
          <a
            href={safeHref(teacher.profileUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 rounded-md text-xs font-semibold text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline focus-visible:text-fg"
          >
            {t("teachersViewProfile")}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </TiltCard>
  );
}
