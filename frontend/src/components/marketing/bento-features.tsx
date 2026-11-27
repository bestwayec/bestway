"use client";

import * as React from "react";
import { Award, BookOpen, Monitor, Send, ShieldAlert, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const BENTO_CARDS = [
  { key: "c1", Icon: Monitor, span: "lg:col-span-2", tone: "brand" },
  { key: "c2", Icon: Users, span: "lg:col-span-1", tone: "accent" },
  { key: "c3", Icon: ShieldAlert, span: "lg:col-span-1", tone: "warning" },
  { key: "c4", Icon: BookOpen, span: "lg:col-span-1", tone: "brand" },
  { key: "c5", Icon: Award, span: "lg:col-span-1", tone: "accent" },
  { key: "c6", Icon: Send, span: "lg:col-span-3", tone: "info" },
] as const;

const TONE_MAP: Record<(typeof BENTO_CARDS)[number]["tone"], string> = {
  brand: "bg-brand-subtle text-brand-subtle-fg",
  accent: "bg-accent-subtle text-brand",
  warning: "bg-warning-bg text-warning",
  info: "bg-info-bg text-info",
};

/**
 * Magic Bento feature grid with subtle cursor radial spotlight on desktop hover.
 */
export function BentoFeatures() {
  const t = useTranslations("marketing");

  function handlePointerMove(e: React.PointerEvent<HTMLElement>) {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--bento-x", `${e.clientX - rect.left}px`);
    target.style.setProperty("--bento-y", `${e.clientY - rect.top}px`);
  }

  return (
    <section
      id="ecosystem"
      className="marketing-section border-b border-border bg-bg-subtle scroll-mt-16"
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-brand/25 bg-brand-subtle px-3 py-1 text-xs font-semibold text-brand-subtle-fg">
            {t("bento.badge")}
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-balance text-fg sm:text-3xl">
            {t("bento.title")}
          </h2>
          <p className="mt-2.5 text-base leading-relaxed text-fg-muted">{t("bento.subtitle")}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENTO_CARDS.map(({ key, Icon, span, tone }) => (
            <article
              key={key}
              onPointerMove={handlePointerMove}
              className={cn(
                "group relative overflow-hidden rounded-card border border-border bg-surface p-6 shadow-e1 transition-colors hover:border-border-strong",
                span,
              )}
              style={
                {
                  "--bento-x": "50%",
                  "--bento-y": "50%",
                } as React.CSSProperties
              }
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:hidden"
                style={{
                  background:
                    "radial-gradient(360px circle at var(--bento-x) var(--bento-y), color-mix(in oklab, var(--color-brand) 12%, transparent), transparent 65%)",
                }}
              />
              <div className="relative z-10 flex h-full flex-col">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex size-10 shrink-0 items-center justify-center rounded-xl",
                      TONE_MAP[tone],
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-[11px] font-semibold text-fg-subtle">
                    {t(`bento.${key}Tag`)}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-fg">{t(`bento.${key}Title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t(`bento.${key}Text`)}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
