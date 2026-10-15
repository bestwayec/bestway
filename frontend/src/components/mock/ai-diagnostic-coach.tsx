"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Lightbulb,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DiagnosticFeedback } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AiDiagnosticCoachProps {
  skill: string;
  feedback?: DiagnosticFeedback | null;
  className?: string;
}

export function AiDiagnosticCoach({ skill, feedback, className }: AiDiagnosticCoachProps) {
  const [copied, setCopied] = React.useState(false);

  if (!feedback) {
    return null;
  }

  const {
    criteria_scores = [],
    mistakes_and_fixes = [],
    vocabulary_upgrades = [],
    action_plan = [],
    band_8_rewrite = "",
  } = feedback;

  const hasContent =
    criteria_scores.length > 0 ||
    mistakes_and_fixes.length > 0 ||
    vocabulary_upgrades.length > 0 ||
    action_plan.length > 0 ||
    Boolean(band_8_rewrite);

  if (!hasContent) {
    return null;
  }

  const skillTitle = skill === "writing" ? "Writing" : skill === "speaking" ? "Speaking" : skill.toUpperCase();

  const copyRewrite = () => {
    if (!band_8_rewrite) return;
    navigator.clipboard.writeText(band_8_rewrite);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className={cn("overflow-hidden border-brand/30 bg-surface shadow-sm", className)}>
      {/* Header */}
      <div className="border-b border-border bg-gradient-to-r from-brand/10 via-surface to-brand/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-white shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <div>
              <h3 className="font-bold text-fg sm:text-base">
                AI Diagnostic Coach: {skillTitle}
              </h3>
              <p className="text-xs text-fg-muted">
                Chuqurlashtirilgan xatolar tahlili, C1 leksika va Band 8.0 tavsiyalari
              </p>
            </div>
          </div>
          <Badge variant="success" className="gap-1.5 px-2.5 py-1 text-xs font-semibold">
            <span className="size-1.5 rounded-full bg-current animate-pulse" />
            Diagnostic Analysis
          </Badge>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        {/* 1. Criteria Scores */}
        {criteria_scores.length > 0 && (
          <section className="space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">
              <TrendingUp className="size-4 text-brand" />
              Baholash mezonlari (Criteria Breakdown)
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {criteria_scores.map((c, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-bg-subtle p-3.5 transition-colors hover:border-brand/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-fg">{c.criterion}</span>
                    <Badge variant="info" className="font-bold tabular-nums">
                      {typeof c.score === "number" ? c.score.toFixed(1) : c.score}
                    </Badge>
                  </div>
                  {c.comment && (
                    <p className="mt-2 text-xs leading-relaxed text-fg-muted whitespace-pre-wrap">
                      {c.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2. Mistakes and Fixes (Diff View) */}
        {mistakes_and_fixes.length > 0 && (
          <section className="space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">
              <AlertCircle className="size-4 text-warning" />
              Xatolar va To&apos;g&apos;irlashlar (Diff View)
            </h4>
            <div className="space-y-3">
              {mistakes_and_fixes.map((item, idx) => (
                <div
                  key={idx}
                  className="overflow-hidden rounded-xl border border-border bg-surface text-sm"
                >
                  {/* Original Red */}
                  <div className="flex items-start gap-2.5 bg-danger/10 p-3 text-danger border-b border-danger/20">
                    <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">
                        Original (Xato yoki noaniq matn):
                      </span>
                      <p className="mt-0.5 font-medium line-through decoration-danger/60 whitespace-pre-wrap">
                        {item.original}
                      </p>
                    </div>
                  </div>

                  {/* Corrected Green */}
                  <div className="flex items-start gap-2.5 bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">
                        C1 / Band 8.0 Namuna (To&apos;g&apos;ri variant):
                      </span>
                      <p className="mt-0.5 font-semibold whitespace-pre-wrap">
                        {item.corrected}
                      </p>
                    </div>
                  </div>

                  {/* Explanation */}
                  {item.explanation && (
                    <div className="bg-bg-subtle px-3.5 py-2 text-xs text-fg-muted border-t border-border">
                      <span className="font-semibold text-fg">Izoh: </span>
                      {item.explanation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3. Vocabulary Upgrades */}
        {vocabulary_upgrades.length > 0 && (
          <section className="space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">
              <BookOpen className="size-4 text-brand" />
              So&apos;z boyligi oshirish (Vocabulary Upgrades)
            </h4>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-subtle text-xs uppercase tracking-wider text-fg-subtle">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Oddiy so&apos;z (Basic)</th>
                    <th className="px-4 py-2.5 font-semibold">C1 / Band 8.0 Sinonim</th>
                    <th className="px-4 py-2.5 font-semibold">Izoh va kontekst</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface">
                  {vocabulary_upgrades.map((vocab, vIdx) => (
                    <tr key={vIdx} className="hover:bg-bg-subtle/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-fg-muted whitespace-nowrap">
                        <span className="rounded bg-bg-subtle px-2 py-1 text-xs">
                          {vocab.original}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-brand whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2 py-1 text-brand">
                          <ArrowRight className="size-3 text-brand" />
                          {vocab.alternative}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {vocab.explanation || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 4. Action Plan */}
        {action_plan.length > 0 && (
          <section className="space-y-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">
              <Lightbulb className="size-4 text-amber-500" />
              Amaliy Reja (Action Plan)
            </h4>
            <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
              {action_plan.map((step, sIdx) => (
                <div key={sIdx} className="flex items-start gap-2.5 text-fg">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-600 dark:text-amber-400">
                    {sIdx + 1}
                  </span>
                  <p className="leading-relaxed text-sm text-fg">{step}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 5. Band 8.0 / C1 Rewrite */}
        {band_8_rewrite && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-subtle">
                <Sparkles className="size-4 text-brand" />
                Band 8.0 / C1 Namunaviy Matn (Model Rewrite)
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={copyRewrite}
                className="h-8 gap-1.5 text-xs font-medium"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? "Nusxa olindi" : "Nusxa olish"}
              </Button>
            </div>
            <div className="rounded-xl border border-brand/20 bg-brand/5 p-4.5 sm:p-5">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
                {band_8_rewrite}
              </p>
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}
