import * as React from "react";
import { CheckCircle2, Circle, Clock3, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MockQuestion, MockSkill, TaskGuidance } from "@/lib/types";

export const MULTILEVEL_SKILLS: MockSkill[] = ["listening", "reading", "writing", "speaking"];

const SKILL_NAMES: Record<MockSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

const TASK_NAMES: Record<string, string> = {
  informal_email: "Task 1.1 — Informal Letter",
  formal_email: "Task 1.2 — Formal Letter",
  publication: "Task 2 — Publication",
  "1.1": "Part 1.1",
  "1.2": "Part 1.2",
  "2": "Part 2",
  "3": "Part 3",
};

export function multilevelTaskName(guidance: TaskGuidance | undefined, fallback: string): string {
  return guidance?.displayLabel ?? (guidance?.taskKey ? TASK_NAMES[guidance.taskKey] : undefined) ?? fallback;
}

export function scoreMaximum(guidance: TaskGuidance | undefined): number | undefined {
  return guidance?.rawMax;
}

export function studentStartMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "MOCK_NOT_READY" || code === "SPECIFICATION_UNSUPPORTED") return "Exam is not ready yet.";
  return "The exam could not be started. Please try again.";
}

export function studentSaveMessage(state: "idle" | "saving" | "saved" | "error"): string {
  return { idle: "Saved", saving: "Saving…", saved: "Saved", error: "Save failed — Retry" }[state];
}

export function taskDuration(guidance: TaskGuidance | undefined): string | null {
  if (!guidance) return null;
  const prep = guidance.prepSeconds ?? 0;
  const response = guidance.responseSeconds;
  if (response == null) return null;
  if (!prep) return `${response} sec each · no official prep`;
  return `${prep} sec prep · ${response} sec response`;
}

export function MultilevelReadiness({ ready }: { ready: boolean | undefined }) {
  const available = ready !== false;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={available ? "success" : "warning"}>{available ? "Ready" : "Not ready"}</Badge>
      {!available && <span className="text-xs text-fg-muted">This exam is still being prepared.</span>}
    </div>
  );
}

export function MultilevelSectionProgress({ current, complete = [] }: { current: MockSkill; complete?: MockSkill[] }) {
  return (
    <nav aria-label="Exam sections" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {MULTILEVEL_SKILLS.map((skill) => {
        const active = skill === current;
        const done = complete.includes(skill);
        return <div key={skill} aria-current={active ? "step" : undefined} className={cn(
          "flex items-center gap-2 rounded-[8px] border px-3 py-2 text-sm",
          active ? "border-brand bg-brand-subtle text-brand-subtle-fg" : "border-border bg-surface text-fg-muted",
        )}>
          {done ? <CheckCircle2 className="size-4 text-success" /> : active ? <Circle className="size-4 fill-current" /> : <LockKeyhole className="size-3.5" />}
          <span className="font-medium">{SKILL_NAMES[skill]}</span>
        </div>;
      })}
    </nav>
  );
}

export function MultilevelTaskProgress({
  skill,
  current,
  total,
  labels,
  onSelect,
}: {
  skill: "writing" | "speaking";
  current: number;
  total: number;
  labels: string[];
  onSelect?: (index: number) => void;
}) {
  const sectionName = SKILL_NAMES[skill];
  return <div className="space-y-2 rounded-[10px] border border-border bg-bg-subtle p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-semibold text-fg">{sectionName}</p>
        <p className="text-sm text-fg-muted">{skill === "writing" ? "Task" : "Part"} {current + 1} of {total} · {skill === "writing" ? "Writing total /16" : "Speaking total /21"}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label={`${sectionName} task progress`}>
        {labels.map((label, index) => {
          const active = current === index;
          const control = <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", active ? "bg-brand text-white" : "bg-surface text-fg-muted")}>{label}</span>;
          return onSelect ? <button key={label} type="button" onClick={() => onSelect(index)} aria-current={active ? "step" : undefined}>{control}</button> : <React.Fragment key={label}>{control}</React.Fragment>;
        })}
      </div>
    </div>
  </div>;
}

export function MultilevelTaskMeta({ question }: { question: Pick<MockQuestion, "guidance" | "points"> }) {
  const max = scoreMaximum(question.guidance) ?? question.points;
  const timing = taskDuration(question.guidance);
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
    {question.guidance?.wordMin != null && <span>{question.guidance.wordMin === question.guidance.wordMax ? `~${question.guidance.wordMin} words` : `${question.guidance.wordMin}–${question.guidance.wordMax} words`}</span>}
    {timing && <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{timing}</span>}
    <span>/{max}</span>
  </div>;
}

export function multilevelTaskLabels(questions: Array<Pick<MockQuestion, "guidance">>): string[] {
  return questions.map((question, index) => question.guidance?.taskKey ?? String(index + 1));
}
