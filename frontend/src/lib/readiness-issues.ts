/**
 * The server's Multilevel blueprint check returns one line with every issue joined by "; "
 * ("listening 1: requires 8 responses/questions; writing formal_email: points must be 5").
 * The review panel shows one row per issue, each linked to the exact part it names.
 */
export type ExamSkill = "listening" | "reading" | "writing" | "speaking";

export interface BlueprintIssue {
  skill: ExamSkill | null;
  /** Index of the part (question group) inside its section, or null when the issue is section-wide. */
  partIndex: number | null;
  /** Human label of the part, e.g. "Part 1", "Task 1.2", "Part 1.2". */
  part: string | null;
  message: string;
}

export const BLUEPRINT_ISSUE_KEYS = new Set(["multilevel_start", "multilevel_blueprint"]);

const WRITING_TASKS: Record<string, [number, string]> = { informal_email: [0, "Task 1.1"], formal_email: [1, "Task 1.2"], publication: [2, "Task 2"] };
const SPEAKING_PARTS = ["1.1", "1.2", "2", "3"];

function locate(skill: ExamSkill, key: string): [number | null, string | null] {
  if (skill === "writing") { const hit = WRITING_TASKS[key]; return hit ? [hit[0], hit[1]] : [null, null]; }
  if (skill === "speaking") { const index = SPEAKING_PARTS.indexOf(key); return index >= 0 ? [index, `Part ${key}`] : [null, null]; }
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 ? [n - 1, `Part ${n}`] : [null, null];
}

export function splitBlueprintIssues(detail: string | null | undefined): BlueprintIssue[] {
  const seen = new Set<string>();
  const out: BlueprintIssue[] = [];
  for (const raw of (detail ?? "").split(";")) {
    const text = raw.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const part = text.match(/^(listening|reading|writing|speaking) (\S+?)(?: question (\d+))?: (.+)$/);
    if (part) {
      const skill = part[1] as ExamSkill;
      const [partIndex, label] = locate(skill, part[2]);
      out.push({ skill, partIndex, part: label, message: part[3] ? `question ${part[3]}: ${part[4]}` : part[4] });
      continue;
    }
    const section = text.match(/^(listening|reading|writing|speaking): (.+)$/);
    out.push(section ? { skill: section[1] as ExamSkill, partIndex: null, part: null, message: section[2] } : { skill: null, partIndex: null, part: null, message: text });
  }
  return out;
}
