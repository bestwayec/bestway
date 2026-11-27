"use client";

import * as React from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PREVIEW_TABS = [
  { key: "ielts", Icon: FileCheck2 },
  { key: "multilevel", Icon: Sparkles },
  { key: "vocab", Icon: BookOpen },
  { key: "teacher", Icon: Users },
] as const;

type PreviewTab = (typeof PREVIEW_TABS)[number]["key"];

/**
 * Interactive landing Hero product preview showing representative platform workflows
 * with explicitly labeled synthetic demo data.
 */
export function HeroShowcase() {
  const t = useTranslations("marketing");
  const reducedMotion = useReducedMotion();
  const [active, setActive] = React.useState<PreviewTab>("ielts");

  return (
    <LazyMotion features={domAnimation}>
      <figure className="min-w-0">
        <div className="overflow-hidden rounded-card border border-border bg-bg-subtle shadow-e3">
          {/* Window chrome */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3.5 py-2.5">
            <div className="flex items-center gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-border-strong" />
              <span className="size-2.5 rounded-full bg-border-strong" />
              <span className="size-2.5 rounded-full bg-border-strong" />
              <span className="ml-2 truncate text-xs font-medium text-fg-subtle">
                {t("previewLabel")}
              </span>
            </div>
            <span className="inline-flex items-center rounded-full border border-warning-border bg-warning-bg px-2.5 py-0.5 text-[11px] font-semibold text-warning">
              {t("preview.badge")}
            </span>
          </div>

          {/* Interactive switcher tabs */}
          <div
            role="tablist"
            aria-label={t("previewLabel")}
            className="grid grid-cols-2 gap-1 border-b border-border bg-bg-subtle p-1.5 sm:grid-cols-4"
          >
            {PREVIEW_TABS.map(({ key, Icon }) => {
              const selected = active === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(key)}
                  className={cn(
                    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    selected
                      ? "bg-brand text-brand-fg shadow-e1"
                      : "text-fg-muted hover:bg-surface hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{t(`preview.tabs.${key}`)}</span>
                </button>
              );
            })}
          </div>

          {/* Interactive canvas */}
          <div className="min-h-[250px] bg-surface p-4 sm:p-5">
            <m.div
              key={active}
              initial={reducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.14 }}
              className="space-y-4"
            >
                {active === "ielts" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">{t("preview.ieltsTitle")}</span>
                      <Badge variant="brand" className="gap-1 tabular-nums">
                        <Clock className="size-3" aria-hidden />
                        {t("preview.ieltsTimer")}
                      </Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-control border border-border bg-bg-subtle p-3 text-xs leading-relaxed text-fg-muted">
                        <p className="rounded bg-brand-subtle px-1.5 py-1 text-fg">
                          {t("preview.ieltsPassage")}
                        </p>
                      </div>
                      <div className="space-y-2 rounded-control border border-border bg-bg-subtle p-3">
                        <p className="text-xs font-semibold text-fg">{t("preview.ieltsQuestion")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(["TRUE", "FALSE", "NOT GIVEN"] as const).map((opt, idx) => (
                            <span
                              key={opt}
                              className={cn(
                                "rounded-control border px-2.5 py-1 text-[11px] font-semibold",
                                idx === 0
                                  ? "border-brand bg-brand text-brand-fg"
                                  : "border-border bg-surface text-fg-muted",
                              )}
                            >
                              {opt}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                      {t("preview.ieltsStatus")}
                    </p>
                  </div>
                )}

                {active === "multilevel" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">{t("preview.multilevelTitle")}</span>
                      <Badge variant="warning">{t("preview.multilevelBadge")}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {[
                        { label: "L", score: "64" },
                        { label: "R", score: "61" },
                        { label: "W", score: "54" },
                        { label: "S", score: "53" },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-control border border-border bg-bg-subtle p-3 text-center"
                        >
                          <p className="text-[11px] font-semibold text-fg-subtle">{item.label}</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-fg">{item.score}</p>
                        </div>
                      ))}
                    </div>
                    <p className="rounded-control border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
                      {t("preview.multilevelNote")}
                    </p>
                  </div>
                )}

                {active === "vocab" && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-fg">{t("preview.vocabTitle")}</p>
                    <div className="rounded-control border border-brand/30 bg-brand-subtle p-4">
                      <p className="text-xl font-bold tracking-tight text-fg">{t("preview.vocabWord")}</p>
                      <p className="mt-0.5 text-xs font-medium text-fg-subtle">{t("preview.vocabPhonetic")}</p>
                      <p className="mt-2.5 text-sm text-fg-muted">{t("preview.vocabHint")}</p>
                    </div>
                    <p className="text-xs font-medium text-brand">{t("preview.vocabDue")}</p>
                  </div>
                )}

                {active === "teacher" && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-fg">{t("preview.teacherTitle")}</p>
                    <div className="flex items-center gap-2.5 rounded-control border border-warning-border bg-warning-bg px-3 py-2.5 text-xs font-medium text-warning">
                      <ShieldAlert className="size-4 shrink-0" aria-hidden />
                      <span>{t("preview.teacherAlert")}</span>
                    </div>
                    <div className="rounded-control border border-border bg-bg-subtle p-3 text-xs text-fg-muted">
                      {t("preview.teacherQueue")}
                    </div>
                  </div>
                )}
            </m.div>
          </div>
        </div>
        <figcaption className="mt-3 text-sm text-fg-subtle">{t("productExamCaption")}</figcaption>
      </figure>
    </LazyMotion>
  );
}
