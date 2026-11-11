"use client";

import {
  BookOpenText,
  CheckCircle2,
  Circle,
  ClipboardList,
  Headphones,
  Home,
  Mic,
  PenLine,
  Plus,
  Rocket,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCreateMockGroup, useCreateMockSection } from "@/hooks/use-mock";
import type { MockExamDetail, MockGroup, MockSkill } from "@/lib/types";
import { groupIssueCount } from "./checks";
import { clusterReadingPassages } from "./reading-passage-clusters";
import { SKILL_META, SKILL_ORDER, tx, type Selection } from "./types";

const SKILL_ICON: Record<MockSkill, typeof Headphones> = {
  listening: Headphones,
  reading: BookOpenText,
  writing: PenLine,
  speaking: Mic,
};

function rangeLabel(questions: Array<{ number: number }>): string | null {
  if (questions.length === 0) return null;
  const nums = questions.map((q) => q.number).sort((a, b) => a - b);
  return nums.length > 1 ? `Q${nums[0]}–${nums[nums.length - 1]}` : `Q${nums[0]}`;
}

function groupMeta(g: MockGroup, skill: MockSkill): string {
  const n = g.questions.length;
  const base = n === 0 ? "Empty" : `${n} ${n === 1 ? "question" : "questions"}`;
  const range = rangeLabel(g.questions);
  const missing =
    n > 0 && skill === "listening" && !g.hasAudio
      ? " · no audio"
      : n > 0 && skill === "reading" && !g.passageText?.trim()
        ? " · no passage"
        : "";
  return `${base}${range ? ` · ${range}` : ""}${missing}`;
}

function OutlineButton({
  active,
  onClick,
  label,
  current,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ?? active ? "true" : undefined}
      aria-label={label}
      className={`relative flex w-full items-start gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition focus-visible:outline-2 focus-visible:outline-brand ${
        active
          ? "bg-brand-subtle font-semibold text-fg"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-brand"
        />
      )}
      {children}
    </button>
  );
}

/**
 * Permanent structural navigation: exam outline (Overview → skills → units →
 * Review / Publish). Fixed while the editor scrolls; every item shows its
 * state (ready / needs attention / empty) via icon + text, never color alone.
 */
export function Sidebar({
  examId,
  detail,
  selection,
  onSelect,
  blockers,
}: {
  examId: string;
  detail: MockExamDetail;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  /** Blocking-error count for the review badge. */
  blockers: number;
}) {
  const t = useTranslations("examBuilder");
  const createSection = useCreateMockSection(examId);
  const createGroup = useCreateMockGroup(examId);
  const bySkill = new Map(detail.sections.map((s) => [s.skill, s] as const));
  const totalQuestions = detail.questionCount;
  const busy = createSection.isPending || createGroup.isPending;

  function handleAddUnit(skill: MockSkill) {
    const section = bySkill.get(skill);
    if (!section) {
      createSection.mutate(
        { skill, title: skill.charAt(0).toUpperCase() + skill.slice(1), sortOrder: detail.sections.length },
        {
          onSuccess: (s) => onSelect({ kind: "section", sectionId: (s as { id: string }).id }),
        },
      );
      return;
    }
    const n =
      skill === "reading"
        ? clusterReadingPassages(
            [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder),
          ).length
        : section.groups.length;
    const meta = SKILL_META[skill];
    if (skill === "listening" && n >= 4) return;
    const nextSort = Math.max(-1, ...section.groups.map((g) => g.sortOrder)) + 1;
    const nextPart = skill === "listening" ? Math.max(0, ...section.groups.map((g) => g.partNumber ?? 0), n) + 1 : undefined;
    if (skill === "listening" && nextPart != null && nextPart > 4) return;
    createGroup.mutate(
      {
        sectionId: section.id,
        input: {
          title: `${meta.unit} ${n + 1}`,
          sortOrder: nextSort,
          ...(skill === "listening" ? { partNumber: nextPart, audioPlayLimit: 1 } : {}),
        },
      },
      {
        onSuccess: (g) => onSelect({ kind: "group", groupId: (g as { id: string }).id }),
      },
    );
  }

  return (
    <aside className="w-60 shrink-0 lg:w-64" aria-label={tx(t, "outline", "Exam outline")}>
      <div className="scrollbar-thin sticky top-32 max-h-[calc(100vh-10rem)] space-y-3 overflow-y-auto rounded-[12px] border border-border bg-surface p-3">
        <div className="px-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
            {tx(t, "outline", "Exam outline")}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {totalQuestions} {tx(t, "questions", "questions")} · {detail.sections.length}{" "}
            {tx(t, "sections", "sections")}
          </p>
        </div>

        <nav className="space-y-0.5" aria-label={tx(t, "outline", "Exam outline")}>
          <OutlineButton
            active={selection.kind === "overview"}
            onClick={() => onSelect({ kind: "overview" })}
            label={tx(t, "overview", "Overview")}
          >
            <Home className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate">{tx(t, "overview", "Overview")}</span>
              <span className="block truncate text-[11px] font-normal text-fg-subtle">
                {tx(t, "examSettings", "Exam settings")}
              </span>
            </span>
          </OutlineButton>

          {SKILL_ORDER.map((skill) => {
            const section = bySkill.get(skill);
            const meta = SKILL_META[skill];
            const Icon = SKILL_ICON[skill];
            const name = skill.charAt(0).toUpperCase() + skill.slice(1);
            const open = Boolean(
              (selection.kind === "section" && selection.sectionId === section?.id) ||
                (selection.kind === "group" &&
                  section?.groups.some((g) => g.id === selection.groupId)),
            );
            if (!section) {
              return (
                <div key={skill} className="pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAddUnit(skill)}
                    aria-label={`${meta.addUnit} — ${name} ${tx(t, "notConfigured", "not configured")}`}
                    className="flex w-full items-center gap-2 rounded-[8px] border border-dashed border-border-strong px-2.5 py-1.5 text-left text-[13px] text-fg-subtle transition hover:border-brand hover:text-fg disabled:opacity-50"
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Plus className="size-4 shrink-0" aria-hidden />
                  </button>
                  <p className="px-2.5 pt-0.5 text-[11px] text-fg-subtle">
                    {tx(t, "notConfigured", "Not configured")}
                  </p>
                </div>
              );
            }
            const qCount = section.groups.reduce((a, g) => a + g.questions.length, 0);
            const issues = section.groups.reduce((a, g) => a + groupIssueCount(g, skill), 0);
            const readingPassages =
              skill === "reading"
                ? clusterReadingPassages(
                    [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder),
                  )
                : [];
            const unitCount = skill === "reading" ? readingPassages.length : section.groups.length;
            const sectionMeta =
              section.groups.length === 0
                ? tx(t, "notConfigured", "Not configured")
                : qCount === 0
                  ? `${unitCount} ${meta.units.toLowerCase()} · ${tx(t, "noQuestionsYet", "No questions yet")}`
                  : skill === "reading"
                    ? `${unitCount} ${tx(t, "passages", "passages")} · ${qCount} ${tx(t, "questions", "questions")}`
                    : `${qCount} ${tx(t, "questions", "questions")}`;
            return (
              <div key={skill} className="pt-1">
                <div className="flex items-start gap-0.5">
                  <div className="min-w-0 flex-1">
                    <OutlineButton
                      active={open}
                      onClick={() => onSelect({ kind: "section", sectionId: section.id })}
                      label={`${name} — ${sectionMeta}`}
                    >
                      {issues > 0 ? (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                      ) : qCount > 0 ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      ) : (
                        <Circle className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{name}</span>
                        <span className="block truncate text-[11px] font-normal text-fg-subtle">
                          {sectionMeta}
                        </span>
                      </span>
                    </OutlineButton>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={meta.addUnit}
                    title={meta.addUnit}
                    loading={busy}
                    onClick={() => handleAddUnit(skill)}
                    className="mt-0.5 h-7 w-7 shrink-0 p-0"
                  >
                    <Plus className="size-4" aria-hidden />
                  </Button>
                </div>
                {section.groups.length > 0 && (
                  <div className="ml-[18px] space-y-0.5 border-l border-border py-0.5 pl-1.5">
                    {skill === "reading" ? (
                      readingPassages.map((passage) => {
                        const passageIssues = passage.groups.reduce(
                          (total, group) => total + groupIssueCount(group, "reading"),
                          0,
                        );
                        const passageActive =
                          selection.kind === "group" &&
                          passage.groups.some((group) => group.id === selection.groupId);
                        const passageTitle =
                          passage.title && passage.title !== `Passage ${passage.ordinal}`
                            ? `Passage ${passage.ordinal} · ${passage.title}`
                            : `Passage ${passage.ordinal}`;
                        return (
                          <div key={passage.groups[0].id} className="space-y-0.5">
                            <OutlineButton
                              active={passageActive}
                              onClick={() =>
                                onSelect({ kind: "group", groupId: passage.groups[0].id })
                              }
                              label={`${passageTitle} — ${passage.groups.length} question sets — ${passage.rangeLabel ? `Questions ${passage.rangeLabel}` : tx(t, "noQuestionsYet", "No questions yet")}`}
                            >
                              {passageIssues > 0 ? (
                                <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
                              ) : passage.questions.length > 0 ? (
                                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                              ) : (
                                <Circle className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{passageTitle}</span>
                                <span className="block truncate text-[11px] font-normal text-fg-subtle">
                                  {passage.rangeLabel ? `Q${passage.rangeLabel}` : tx(t, "noQuestionsYet", "No questions yet")} · {passage.groups.length}{" "}
                                  {tx(t, "questionSets", "question sets")}
                                </span>
                              </span>
                            </OutlineButton>
                            {passage.groups.length > 1 && (
                              <div className="ml-4 space-y-0.5 border-l border-border/70 pl-1.5">
                                {passage.groups.map((g, taskIndex) => {
                                  const taskIssues = groupIssueCount(g, "reading");
                                  const taskActive =
                                    selection.kind === "group" && selection.groupId === g.id;
                                  const taskRange = rangeLabel(g.questions);
                                  const taskLabel = taskRange ?? `${tx(t, "questionSet", "Question set")} ${taskIndex + 1}`;
                                  return (
                                    <OutlineButton
                                      key={g.id}
                                      active={taskActive}
                                      onClick={() => onSelect({ kind: "group", groupId: g.id })}
                                      label={`${taskLabel} — ${groupMeta(g, "reading")}`}
                                    >
                                      {taskIssues > 0 ? (
                                        <XCircle className="mt-0.5 size-3 shrink-0 text-danger" aria-hidden />
                                      ) : (
                                        <Circle className="mt-0.5 size-3 shrink-0 text-fg-subtle" aria-hidden />
                                      )}
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate">{taskLabel}</span>
                                        <span className="block truncate text-[10px] font-normal text-fg-subtle">
                                          {g.questions.length} {tx(t, "questions", "questions")}
                                        </span>
                                      </span>
                                    </OutlineButton>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : section.groups.map((g, gi) => {
                      const gi_issues = groupIssueCount(g, skill);
                      const label = g.title?.trim() || `${meta.unit} ${gi + 1}`;
                      const active = selection.kind === "group" && selection.groupId === g.id;
                      const statusWord =
                        gi_issues > 0
                          ? tx(t, "needsAttention", "Needs attention")
                          : g.questions.length > 0
                            ? tx(t, "ready", "Ready")
                            : tx(t, "noQuestionsYet", "No questions yet");
                      return (
                        <OutlineButton
                          key={g.id}
                          active={active}
                          onClick={() => onSelect({ kind: "group", groupId: g.id })}
                          label={`${label} — ${groupMeta(g, skill)} — ${statusWord}`}
                        >
                          {gi_issues > 0 ? (
                            <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
                          ) : g.questions.length > 0 ? (
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                          ) : (
                            <Circle className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{label}</span>
                            <span className="block truncate text-[11px] font-normal text-fg-subtle">
                              {groupMeta(g, skill)}
                            </span>
                          </span>
                          <span className="sr-only">{statusWord}</span>
                        </OutlineButton>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="pt-2">
            <hr className="mb-2 border-border" />
            <OutlineButton
              active={selection.kind === "review"}
              onClick={() => onSelect({ kind: "review" })}
              label={
                blockers > 0
                  ? `${tx(t, "review", "Review")} — ${blockers} ${tx(t, "blockers", "blockers")}`
                  : `${tx(t, "review", "Review")} — ${tx(t, "ready", "Ready")}`
              }
            >
              <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{tx(t, "review", "Review")}</span>
                <span className="block truncate text-[11px] font-normal text-fg-subtle">
                  {blockers > 0
                    ? `${blockers} ${tx(t, "blockers", "blockers")}`
                    : tx(t, "ready", "Ready")}
                </span>
              </span>
              {blockers > 0 ? (
                <Badge variant="danger" className="ml-auto shrink-0">
                  {blockers}
                </Badge>
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              )}
            </OutlineButton>
            <OutlineButton
              active={selection.kind === "publish"}
              onClick={() => onSelect({ kind: "publish" })}
              label={tx(t, "publish", "Publish")}
            >
              <Rocket className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="block truncate">{tx(t, "publish", "Publish")}</span>
            </OutlineButton>
          </div>
        </nav>

        <p className="flex items-start gap-1.5 px-1 text-[11px] leading-snug text-fg-subtle">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {tx(t, "draftNote", "Everything saves as draft until you publish.")}
        </p>
      </div>
    </aside>
  );
}
