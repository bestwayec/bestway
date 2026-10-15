"use client";

import * as React from "react";
import {
  ArrowRight,
  Award,
  BookOpenText,
  Clock,
  Headphones,
  History,
  Mic,
  PenLine,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useStudentProgramScope } from "@/hooks/use-exam-programs";
import { useMockExams, useMyMockAttempts } from "@/hooks/use-mock";
import type { MockSkill } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { AttemptScoreSummary } from "./attempt-score-summary";
import { CefrResultInfographic } from "./cefr-result-infographic";

const SKILL_CONFIG: Record<
  MockSkill,
  {
    icon: typeof Headphones;
    color: string;
    bg: string;
    desc: string;
    duration: string;
  }
> = {
  listening: {
    icon: Headphones,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    desc: "6 Parts · 35 Questions · Audio recordings",
    duration: "45 min",
  },
  reading: {
    icon: BookOpenText,
    color: "text-blue-500",
    bg: "bg-blue-500/10 border-blue-500/20",
    desc: "5 Parts · 35 Questions · Dual-column passages",
    duration: "60 min",
  },
  writing: {
    icon: PenLine,
    color: "text-purple-500",
    bg: "bg-purple-500/10 border-purple-500/20",
    desc: "Task 1 & Task 2 · Word counter & AI check",
    duration: "60 min",
  },
  speaking: {
    icon: Mic,
    color: "text-amber-500",
    bg: "bg-amber-500/10 border-amber-500/20",
    desc: "Parts 1-3 · Mic calibration & timed recording",
    duration: "15 min",
  },
};

export function ExamTrackDashboard() {
  const t = useTranslations("examTrack");
  const tm = useTranslations("mock");
  const tc = useTranslations("common");
  const { program } = useStudentProgramScope();
  const exams = useMockExams();
  const history = useMyMockAttempts();

  if (!program) return null;

  const matches = (type?: string) =>
    program === "MULTILEVEL" ? type === "multilevel" : type !== "multilevel";

  const allProgramExams = (exams.data ?? []).filter(
    (e) => (e.isPublished || e.isDemo) && matches(e.type),
  );

  // Identify full mock exam
  const fullMock = allProgramExams.find(
    (e) => e.profile === "full_mock" || e.skills.length >= 4,
  ) ?? allProgramExams[0];

  // Latest completed attempt with CEFR data
  const completedAttempts = (history.data ?? []).filter(
    (a) => matches(a.examType) && a.status === "completed",
  );
  const latestCompleted = completedAttempts[0];
  const isInternalPractice = latestCompleted && (
    latestCompleted.flowMode === "partial_practice" ||
    (["writing", "speaking"] as MockSkill[]).some(
      (s) =>
        latestCompleted.rawScores?.[s]?.practiceGrade?.policyId ===
        "BESTWAY_INTERNAL_PRACTICE_35_50_V1",
    )
  );

  return (
    <div className="my-6 space-y-6">
      {/* Hero Full Mock Card */}
      <div className="relative overflow-hidden rounded-2xl border border-brand/40 bg-gradient-to-br from-brand/15 via-surface to-bg p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success" className="gap-1.5 font-semibold">
                <Sparkles className="size-3.5 fill-current" />
                Official CBT Standard
              </Badge>
              <span className="text-xs text-fg-muted font-medium">
                1. Listening → 2. Reading → 3. Writing → 4. Speaking
              </span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
              {program === "MULTILEVEL"
                ? "Multi-Level CEFR Full Mock Exam"
                : "IELTS Academic Full Mock Exam"}
            </h2>
            <p className="max-w-xl text-sm text-fg-muted leading-relaxed">
              Standard CBT imtihon muhiti: ketma-ket 4 ta bo&apos;lim, vaqt nazorati va
              imtihon yakunida xolis AI baholash orqali rasmiy CEFR darajasi hamda bo&apos;lim ballari.
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
            {fullMock ? (
              <Button asChild size="lg" className="min-h-12 bg-brand px-6 font-bold text-white shadow-md hover:bg-brand-hover">
                <Link href={`/mock/${fullMock.id}`}>
                  <Play className="size-4 fill-current mr-2" />
                  Start Full Mock
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" className="min-h-12 bg-brand px-6 font-bold text-white shadow-md hover:bg-brand-hover">
                <Link href="/mock">
                  <Play className="size-4 fill-current mr-2" />
                  Browse Full Mocks
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="lg" className="min-h-12">
              <Link href="/mock">
                View All Exams
                <ArrowRight className="size-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* 4 Practice Section Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-fg sm:text-lg">
              {t("practice")} — Individual Sections
            </h3>
            <p className="text-xs text-fg-muted">
              Har bir ko&apos;nikma bo&apos;yicha alohida mashq qiling va natijangizni oshiring
            </p>
          </div>
          <Link
            href="/mock"
            className="text-xs font-semibold text-brand hover:underline"
          >
            {t("browse")} →
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["listening", "reading", "writing", "speaking"] as MockSkill[]).map(
            (skill) => {
              const cfg = SKILL_CONFIG[skill];
              const Icon = cfg.icon;
              const skillExams = allProgramExams.filter((e) =>
                e.skills.includes(skill),
              );
              const count = skillExams.length;

              return (
                <Card
                  key={skill}
                  className="group relative flex flex-col justify-between overflow-hidden border border-border/80 bg-surface/80 p-4 transition-all hover:border-brand/50 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={`flex size-10 items-center justify-center rounded-xl border ${cfg.bg} ${cfg.color}`}
                      >
                        <Icon className="size-5" />
                      </div>
                      <Badge variant="neutral" className="tabular-nums text-[11px]">
                        {count} {count === 1 ? "exam" : "exams"}
                      </Badge>
                    </div>

                    <h4 className="mt-3 font-bold text-fg group-hover:text-brand transition-colors">
                      {tm(`skills.${skill}`)}
                    </h4>
                    <p className="mt-1 text-xs text-fg-muted leading-relaxed">
                      {cfg.desc}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/50">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-fg-subtle">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {cfg.duration}
                      </span>
                      <span>Target: Multi-Level</span>
                    </div>
                    {skillExams.length > 0 ? (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="w-full justify-center group-hover:bg-brand group-hover:text-white group-hover:border-brand transition-all"
                      >
                        <Link href={`/mock/${skillExams[0].id}`}>
                          Practice Section
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled className="w-full justify-center text-xs">
                        Practice Section
                      </Button>
                    )}
                  </div>
                </Card>
              );
            },
          )}
        </div>
      </div>

      {/* Latest Result Infographic */}
      {latestCompleted && !isInternalPractice && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-fg sm:text-lg flex items-center gap-2">
              <Award className="size-5 text-brand" />
              Your Latest Exam Result
            </h3>
            <Link
              href={`/mock/attempt/${latestCompleted.id}`}
              className="text-xs font-semibold text-brand hover:underline"
            >
              Full Breakdown →
            </Link>
          </div>

          <CefrResultInfographic
            cefrLevel={latestCompleted.cefrLevel}
            overallScore={latestCompleted.overallScore}
            overallBand={latestCompleted.overallBand}
            isIelts={latestCompleted.examType !== "multilevel"}
            examTitle={latestCompleted.examTitle}
            sections={(["listening", "reading", "writing", "speaking"] as MockSkill[]).map((s) => {
              const raw = latestCompleted.rawScores?.[s];
              return {
                skill: s,
                title: tm(`skills.${s}`),
                score: raw?.score,
                max: raw?.max,
              };
            })}
          />
        </div>
      )}

      {/* Exam History */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-fg flex items-center gap-2">
          <History className="size-4 text-fg-muted" />
          {t("history")}
        </h3>
        {history.isError && <p role="alert" className="text-sm text-danger">{t("loadError")}</p>}
        {history.isPending && <p role="status" className="text-sm text-fg-muted">{t("loading")}</p>}
        {!history.isPending && !history.isError && (history.data?.length ?? 0) === 0 && (
          <p className="text-sm text-fg-muted">{t("noHistory")}</p>
        )}
        <div className="space-y-2">
          {history.data
            ?.filter((a) => matches(a.examType))
            .slice(0, 5)
            .map((a) => (
              <Card
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-surface-hover transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-sm text-fg">
                    {a.examTitle}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {tm(`status.${a.status}`)} ·{" "}
                    {(a as unknown as { isSingleSection?: boolean; singleSection?: string }).isSingleSection ||
                    (a as unknown as { singleSection?: string }).singleSection ||
                    a.practiceScope?.skills?.length === 1 ? (
                      <span className="font-semibold text-brand">
                        Single Section (
                        {(a as unknown as { singleSection?: string }).singleSection ||
                          a.practiceScope?.skills?.[0] ||
                          "Skill"}
                        )
                      </span>
                    ) : (
                      <span className="font-semibold text-sky-500">Full Mock</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <AttemptScoreSummary attempt={a} />
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/mock/attempt/${a.id}${a.status !== "in_progress" ? "#assessment-feedback" : ""}`}>
                      {a.status === "in_progress" ? "Resume" : "Details"}
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}
