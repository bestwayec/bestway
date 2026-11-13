/**
 * An attempt's workspace — review flags, highlights and notes — kept with the attempt on
 * the server (PUT mock/attempts/:id/annotations) and cached on this device.
 *
 * Document stored on the server (an array, so older clients' items stay valid):
 *   { kind: "meta", version: 1, savedAt }      edit time of this workspace (ms, server clock)
 *   { kind: "flag", questionId }               one per flagged question
 *   { kind: "marks", key, highlights, ... }    one per annotated text (CbtAnnotatedText storage key)
 * Items of any other shape are ignored when reading.
 */
export type WorkspaceMarks = {
  highlights: string[];
  greenHighlights: string[];
  pinkHighlights: string[];
  underlines: string[];
  notes: { id: string; quote: string; text: string; createdAt: string }[];
};
export type Workspace = { flags: string[]; marks: Record<string, WorkspaceMarks>; savedAt: number };

const MARKS_PREFIX = "bestway.cbt_annotations.";
const flagsKey = (attemptId: string) => `bw_workspace_flags_${attemptId}`;
const editedKey = (attemptId: string) => `bw_workspace_edited_${attemptId}`;

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function cleanMarks(value: Record<string, unknown>): WorkspaceMarks {
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((n): n is WorkspaceMarks["notes"][number] =>
        Boolean(n && typeof n === "object" && typeof (n as Record<string, unknown>).id === "string"
          && typeof (n as Record<string, unknown>).quote === "string" && typeof (n as Record<string, unknown>).text === "string"),
      ).map((n) => ({ id: n.id, quote: n.quote, text: n.text, createdAt: typeof n.createdAt === "string" ? n.createdAt : "" }))
    : [];
  return {
    highlights: strings(value.highlights),
    greenHighlights: strings(value.greenHighlights),
    pinkHighlights: strings(value.pinkHighlights),
    underlines: strings(value.underlines),
    notes,
  };
}

const isEmpty = (m: WorkspaceMarks) =>
  !m.highlights.length && !m.greenHighlights.length && !m.pinkHighlights.length && !m.underlines.length && !m.notes.length;

/** Read a server document. Null when it holds no workspace written by this format. */
export function fromDocument(items: unknown): Workspace | null {
  if (!Array.isArray(items)) return null;
  const meta = items.find((i) => i && typeof i === "object" && (i as Record<string, unknown>).kind === "meta") as Record<string, unknown> | undefined;
  if (!meta || typeof meta.savedAt !== "number") return null;
  const flags: string[] = [];
  const marks: Record<string, WorkspaceMarks> = {};
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.kind === "flag" && typeof row.questionId === "string" && !flags.includes(row.questionId)) flags.push(row.questionId);
    if (row.kind === "marks" && typeof row.key === "string") marks[row.key] = cleanMarks(row);
  }
  return { flags, marks, savedAt: meta.savedAt };
}

export function toDocument(workspace: Workspace): unknown[] {
  return [
    { kind: "meta", version: 1, savedAt: workspace.savedAt },
    ...workspace.flags.map((questionId) => ({ kind: "flag", questionId })),
    ...Object.entries(workspace.marks).filter(([, m]) => !isEmpty(m)).map(([key, m]) => ({ kind: "marks", key, ...m })),
  ];
}

/** The workspace as cached on this device. */
export function readLocal(attemptId: string): Workspace {
  const s = store();
  const marks: Record<string, WorkspaceMarks> = {};
  let flags: string[] = [];
  let savedAt = 0;
  if (!s) return { flags, marks, savedAt };
  try {
    const prefix = `${MARKS_PREFIX}${attemptId}.`;
    for (let i = 0; i < s.length; i++) {
      const full = s.key(i);
      if (!full || !full.startsWith(prefix)) continue;
      const parsed = JSON.parse(s.getItem(full) || "{}");
      if (parsed && typeof parsed === "object") marks[full.slice(MARKS_PREFIX.length)] = cleanMarks(parsed);
    }
    flags = strings(JSON.parse(s.getItem(flagsKey(attemptId)) || "[]"));
    savedAt = Number(s.getItem(editedKey(attemptId)) || 0) || 0;
  } catch {
    // Damaged cache: the server copy is used.
  }
  return { flags, marks, savedAt };
}

/** Replace the device cache with a workspace (marks of other attempts are not touched). */
export function writeLocal(attemptId: string, workspace: Workspace) {
  const s = store();
  if (!s) return;
  try {
    const prefix = `${MARKS_PREFIX}${attemptId}.`;
    const stale: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const full = s.key(i);
      if (full && full.startsWith(prefix) && !(full.slice(MARKS_PREFIX.length) in workspace.marks)) stale.push(full);
    }
    stale.forEach((full) => s.removeItem(full));
    for (const [key, marks] of Object.entries(workspace.marks)) s.setItem(`${MARKS_PREFIX}${key}`, JSON.stringify(marks));
    s.setItem(flagsKey(attemptId), JSON.stringify(workspace.flags));
    s.setItem(editedKey(attemptId), String(workspace.savedAt));
  } catch {
    // Storage full or blocked: the server copy still holds the workspace.
  }
}

/** Note that the workspace on this device changed now (ms, server clock). */
export function touchLocal(attemptId: string, flags: string[], editedAt: number) {
  const s = store();
  if (!s) return;
  try {
    s.setItem(flagsKey(attemptId), JSON.stringify(flags));
    s.setItem(editedKey(attemptId), String(editedAt));
  } catch {}
}

/**
 * Choose the workspace to show when the exam opens: the newer of the server copy and
 * this device's cache. `push` is true when this device holds newer, unsent edits.
 */
export function resolveOnOpen(attemptId: string, serverItems: unknown): { workspace: Workspace; push: boolean } {
  const local = readLocal(attemptId);
  const server = fromDocument(serverItems);
  if (server && server.savedAt >= local.savedAt) {
    writeLocal(attemptId, server);
    return { workspace: server, push: false };
  }
  const hasLocal = local.flags.length > 0 || Object.values(local.marks).some((m) => !isEmpty(m));
  return { workspace: local, push: hasLocal && local.savedAt > (server?.savedAt ?? 0) };
}
