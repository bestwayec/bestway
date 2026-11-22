import type { MockImportIssue } from "@/lib/types";

/**
 * Client-side helpers for the Import JSON flow. These never touch auth state:
 * the browser session stays in the HttpOnly cookie and every server call goes
 * through `/api/backend/*` via the shared `api` client.
 */

export const IMPORT_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse pasted/file JSON with an explicit size guard (server enforces 2 MiB too). */
export function parsePackageInput(text: string): ParseResult {
  if (new TextEncoder().encode(text).length > IMPORT_PACKAGE_MAX_BYTES) {
    return { ok: false, error: "too-large" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "invalid-json" };
  }
}

/**
 * Scan raw JSON text for duplicate object keys (`JSON.parse` keeps only the
 * last one). Mirrors the server check so teachers get instant feedback.
 */
export function findDuplicateKeys(raw: string): string[] {
  const dups: string[] = [];
  const stack: Array<{ keys: Set<string>; path: string }> = [];
  let i = 0;
  const pushPath = (key: string) => {
    const top = stack[stack.length - 1];
    const esc = key.replace(/~/g, "~0").replace(/\//g, "~1");
    return top ? `${top.path}/${esc}` : `/${esc}`;
  };
  const readString = (): string => {
    let out = "";
    i++;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === "\\") {
        out += raw[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        break;
      }
      out += ch;
      i++;
    }
    return out;
  };
  const skipWs = () => {
    while (i < raw.length && /\s/.test(raw[i])) i++;
  };
  let pendingKey: string | null = null;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      const s = readString();
      skipWs();
      if (raw[i] === ":") {
        pendingKey = s;
        const top = stack[stack.length - 1];
        if (top) {
          if (top.keys.has(s)) dups.push(pushPath(s));
          else top.keys.add(s);
        }
      } else {
        pendingKey = null;
      }
      continue;
    }
    if (ch === "{") {
      const base =
        pendingKey != null ? pushPath(pendingKey) : stack.length ? stack[stack.length - 1].path : "";
      stack.push({ keys: new Set(), path: base });
      pendingKey = null;
      i++;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      pendingKey = null;
      i++;
      continue;
    }
    if (ch === "[" || ch === "]") {
      pendingKey = null;
      i++;
      continue;
    }
    i++;
  }
  return dups;
}

export interface MediaDeclaration {
  key: string;
  kind: string;
  fileName: string;
  requiredForPublish: boolean;
}

/** Declared media keys for the binding step (safe extraction from user JSON). */
export function extractMediaDeclarations(pkg: unknown): MediaDeclaration[] {
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) return [];
  const media = (pkg as Record<string, unknown>).media;
  if (!Array.isArray(media)) return [];
  const out: MediaDeclaration[] = [];
  for (const m of media) {
    if (typeof m !== "object" || m === null) continue;
    const r = m as Record<string, unknown>;
    if (typeof r.key !== "string" || typeof r.kind !== "string" || typeof r.fileName !== "string") {
      continue;
    }
    out.push({
      key: r.key,
      kind: r.kind,
      fileName: r.fileName,
      requiredForPublish: r.requiredForPublish === true,
    });
  }
  return out;
}

/** Split a dry-run report into import vs publish blockers (deterministic order kept). */
export function groupImportIssues(issues: MockImportIssue[]): {
  importBlocking: MockImportIssue[];
  publishBlocking: MockImportIssue[];
} {
  return {
    importBlocking: issues.filter((i) => i.blocks.includes("import")),
    publishBlocking: issues.filter((i) => !i.blocks.includes("import") && i.blocks.includes("publish")),
  };
}

/* ── Exam Builder 2.0 helpers (pure; unit-tested in import-json-v2.spec.ts) ── */

export interface JsonErrorLocation {
  line: number;
  column: number;
  /** 0-based character offset into the text, for selecting the spot in the editor. */
  offset: number;
  message: string;
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

/**
 * Where a `JSON.parse` failure is. Engines word errors differently (V8:
 * "... at position 42 (line 3 column 5)", Firefox: "... at line 3 column 5 of
 * the JSON data", "Unexpected end of JSON input"); all are reduced to one
 * line/column. An error without any position is reported at the end of input.
 */
export function locateJsonError(text: string, error: unknown): JsonErrorLocation {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\s*\(line \d+ column \d+\)\s*$/, "").replace(/ of the JSON data$/, "");
  const lineCol = raw.match(/line (\d+) column (\d+)/i);
  if (lineCol) {
    const line = Number(lineCol[1]);
    const column = Number(lineCol[2]);
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    return { line, column, offset: Math.min(offset + column - 1, text.length), message };
  }
  const position = raw.match(/position (\d+)/i);
  const offset = position ? Number(position[1]) : text.trimEnd().length;
  return { ...offsetToLineColumn(text, offset), offset, message };
}

export type PackageParse =
  | { ok: true; value: unknown }
  | { ok: false; error: "too-large" }
  | { ok: false; error: "invalid-json"; location: JsonErrorLocation };

/** Like `parsePackageInput`, but a syntax error carries its line and column. */
export function parsePackageWithLocation(text: string): PackageParse {
  if (new TextEncoder().encode(text).length > IMPORT_PACKAGE_MAX_BYTES) return { ok: false, error: "too-large" };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: "invalid-json", location: locateJsonError(text, error) };
  }
}

export type ImportPackageKind = "full_exam" | "single_skill" | "multi_skill" | "unknown";

export interface PackageSectionSummary {
  index: number;
  skill: string;
  title: string;
  groups: number;
  questions: number;
  firstNumber: number | null;
  lastNumber: number | null;
  durationMinutes: number | null;
}

export interface PackageSummary {
  schemaVersion: string | null;
  packageId: string | null;
  revision: number | null;
  profile: string | null;
  examType: string | null;
  title: string | null;
  kind: ImportPackageKind;
  skills: string[];
  sections: PackageSectionSummary[];
  questionCount: number;
  durationMinutes: number | null;
  mediaCount: number;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** What a package contains, read defensively from untrusted JSON (never throws). */
export function summarizePackage(pkg: unknown): PackageSummary {
  const root = rec(pkg) ?? {};
  const exam = rec(root.exam) ?? {};
  const sections = arr(exam.sections).map((raw, index): PackageSectionSummary => {
    const section = rec(raw) ?? {};
    const groups = arr(section.groups);
    const numbers = groups
      .flatMap((g) => arr(rec(g)?.questions))
      .map((q) => num(rec(q)?.number))
      .filter((n): n is number => n !== null);
    return {
      index,
      skill: str(section.skill) ?? "unknown",
      title: str(section.title) ?? "",
      groups: groups.length,
      questions: groups.reduce<number>((total, g) => total + arr(rec(g)?.questions).length, 0),
      firstNumber: numbers.length ? Math.min(...numbers) : null,
      lastNumber: numbers.length ? Math.max(...numbers) : null,
      durationMinutes: num(section.durationMinutes),
    };
  });
  const skills = sections.map((s) => s.skill);
  const durations = sections.map((s) => s.durationMinutes);
  return {
    schemaVersion: str(root.schemaVersion),
    packageId: str(root.packageId),
    revision: num(root.revision),
    profile: str(root.profile),
    examType: str(exam.type),
    title: str(exam.title),
    kind:
      sections.length === 0
        ? "unknown"
        : new Set(skills).size === 4
          ? "full_exam"
          : sections.length === 1
            ? "single_skill"
            : "multi_skill",
    skills,
    sections,
    questionCount: sections.reduce((t, s) => t + s.questions, 0),
    durationMinutes: durations.every((d) => d !== null) && durations.length ? durations.reduce<number>((t, d) => t + (d ?? 0), 0) : null,
    mediaCount: arr(root.media).length,
  };
}

/**
 * A server JSON pointer (`/exam/sections/1/groups/0/questions/4/correctAnswers`)
 * as a teacher-readable location: `Reading › group 1 › Q5 › correctAnswers`.
 * Falls back to `sections[1].groups[0]…` notation when the package is not shaped
 * as expected.
 */
export function describeIssuePath(pointer: string, pkg: unknown): string {
  if (!pointer || pointer === "/") return "package";
  const parts = pointer.replace(/^\//, "").split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  const out: string[] = [];
  let node: unknown = pkg;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const parent = parts[i - 1];
    const index = /^\d+$/.test(part) ? Number(part) : null;
    const child = index !== null ? arr(node)[index] : rec(node)?.[part];
    if (part === "exam" && i === 0) {
      node = child;
      continue;
    }
    if (index !== null && parent === "sections") {
      const skill = str(rec(child)?.skill);
      out.push(skill ? skill[0].toUpperCase() + skill.slice(1) : `sections[${index}]`);
    } else if (index !== null && parent === "groups") {
      const title = str(rec(child)?.title);
      out.push(title ? `group ${index + 1} “${title.length > 40 ? `${title.slice(0, 40)}…` : title}”` : `group ${index + 1}`);
    } else if (index !== null && parent === "questions") {
      const n = num(rec(child)?.number);
      out.push(n !== null ? `Q${n}` : `question ${index + 1}`);
    } else if (index !== null && parent === "media") {
      const key = str(rec(child)?.key);
      out.push(key ? `media “${key}”` : `media ${index + 1}`);
    } else if (index !== null) {
      out.push(`[${index}]`);
    } else if (!["sections", "groups", "questions", "media"].includes(part) || i === parts.length - 1) {
      out.push(part);
    }
    node = child;
  }
  return out.join(" › ") || pointer;
}

export interface DraftForImport {
  id: string;
  type: string;
  title: string;
  skills: string[];
  questionCount: number;
}

export interface DestinationCheck {
  ok: boolean;
  /** Plain-language reason when not ok, or a note about what will happen. */
  reason: "type-mismatch" | "appends-to-existing" | "adds-sections" | null;
  sharedSkills: string[];
}

/**
 * Whether a package can go into an existing draft. Mirrors the server rules in
 * `mock_imports.commit_import` (exam type must match; an existing skill section
 * is appended to, so question numbers must not collide) so a teacher sees the
 * outcome before pressing Import. The server still enforces every rule.
 */
export function checkDraftDestination(summary: PackageSummary, draft: DraftForImport): DestinationCheck {
  if (summary.examType && summary.examType !== draft.type) {
    return { ok: false, reason: "type-mismatch", sharedSkills: [] };
  }
  const sharedSkills = summary.skills.filter((s) => draft.skills.includes(s));
  return { ok: true, reason: sharedSkills.length ? "appends-to-existing" : "adds-sections", sharedSkills };
}

/** Indent valid JSON for editing; returns null when the text is not valid JSON. */
export function formatJson(text: string): string | null {
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return null;
  }
}

/** Save JSON text as a file in the browser (no server round trip). */
export function downloadJsonText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click has been dispatched (Safari needs a tick).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A safe file name for an exported exam package. */
export function exportFileName(title: string, skill?: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "exam"}${skill ? `-${skill}` : ""}.bestway.json`;
}
