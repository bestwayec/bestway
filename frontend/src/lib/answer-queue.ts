/** Unconfirmed text edits, scoped to one attempt, question and browser writer. */
export type QueuedAnswer = {
  response: string;
  editedAt: number;
  baseRevision?: string | null;
  writer?: string;
};
export type AnswerQueue = Record<string, QueuedAnswer>;
export type AnswerEdit = Omit<QueuedAnswer, "writer"> & { questionId: string };
export type AnswerReceipt = { editedAt: number; revision: string | null } & (
  { status: "saved" } | { status: "conflict"; response: string }
);
export type AnswerSaveResult = { saved: number; receipts?: Record<string, AnswerReceipt> };

const PREFIX = "bw_answer_queue_";
const key = (attemptId: string) => `${PREFIX}${attemptId}`;
const journalPrefix = (attemptId: string) => `bw_answer_edit_${attemptId}::`;
const journalKey = (attemptId: string, questionId: string, writer: string) =>
  `${journalPrefix(attemptId)}${writer}::${encodeURIComponent(questionId)}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Keep edits usable during in-app navigation when browser storage is unavailable.
// A page reload still loses memory-only edits, which the runner reports.
const memoryEdits = new Map<string, QueuedAnswer>();

export function loadQueue(attemptId: string): AnswerQueue {
  const store = storage();
  const queue: AnswerQueue = Object.create(null);
  const add = (questionId: string, value: unknown, writer?: string) => {
    const entry = value as Partial<QueuedAnswer> | null;
    if (!entry || typeof entry.response !== "string" ||
        typeof entry.editedAt !== "number" || !Number.isFinite(entry.editedAt) ||
        queue[questionId]?.editedAt > entry.editedAt) return;
    queue[questionId] = {
      response: entry.response,
      editedAt: entry.editedAt,
      ...(entry.baseRevision === null || typeof entry.baseRevision === "string" ? { baseRevision: entry.baseRevision } : {}),
      ...(writer ? { writer } : {}),
    };
  };
  const prefix = journalPrefix(attemptId);
  const addJournal = (entryKey: string, value: unknown) => {
    const [writer, encodedId] = entryKey.slice(prefix.length).split("::");
    if (writer && encodedId) add(decodeURIComponent(encodedId), value, writer);
  };
  if (store) {
    try {
      const legacy = JSON.parse(store.getItem(key(attemptId)) || "{}") as unknown;
      if (legacy && typeof legacy === "object") {
        for (const [questionId, value] of Object.entries(legacy)) add(questionId, value);
      }
    } catch { /* a damaged legacy record does not block the journal */ }
    try {
      for (let i = 0; i < store.length; i++) {
        const entryKey = store.key(i);
        if (!entryKey?.startsWith(prefix)) continue;
        try { addJournal(entryKey, JSON.parse(store.getItem(entryKey) || "null")); }
        catch { /* skip only the damaged entry */ }
      }
    } catch { /* storage can be disabled after the page opens */ }
  }
  for (const [entryKey, edit] of memoryEdits) {
    if (entryKey.startsWith(prefix)) addJournal(entryKey, edit);
  }
  return queue;
}

export function isMemoryEdit(attemptId: string, questionId: string, edit: QueuedAnswer): boolean {
  return !!edit.writer && memoryEdits.get(journalKey(attemptId, questionId, edit.writer))?.editedAt === edit.editedAt;
}

/** Write one question for this page. Separate keys prevent concurrent tab writes
 * from replacing unrelated answers or deleting another writer's unconfirmed edit. */
export function persistEdit(attemptId: string, questionId: string, edit: QueuedAnswer & { writer: string }): boolean {
  const editKey = journalKey(attemptId, questionId, edit.writer);
  try {
    const store = storage();
    if (store) {
      store.setItem(editKey, JSON.stringify(edit));
      memoryEdits.delete(editKey);
      return true;
    }
  } catch { /* retain the edit in this page when storage is full or blocked */ }
  memoryEdits.set(editKey, edit);
  return false;
}

export function removeEdit(attemptId: string, questionId: string, edit: QueuedAnswer): void {
  const editKey = edit.writer ? journalKey(attemptId, questionId, edit.writer) : key(attemptId);
  const memory = memoryEdits.get(editKey);
  if (memory?.editedAt === edit.editedAt && memory.response === edit.response) memoryEdits.delete(editKey);
  const store = storage();
  if (!store) return;
  try {
    const stored = JSON.parse(store.getItem(editKey) || "null");
    const current = edit.writer ? stored : stored?.[questionId];
    const matches = current?.editedAt === edit.editedAt && current.response === edit.response;
    if (!matches && !(edit.writer && current?.editedAt < edit.editedAt)) return;
    if (edit.writer) store.removeItem(editKey);
    else {
      delete stored[questionId];
      if (Object.keys(stored).length) store.setItem(editKey, JSON.stringify(stored));
      else store.removeItem(editKey);
    }
  } catch { /* storage can become unavailable during a save */ }
}

export function readUnconfirmedSubmit(attemptId: string): boolean {
  try { return storage()?.getItem(`bw_exam_submit_${attemptId}`) === "pending"; }
  catch { return false; }
}

export function rememberUnconfirmedSubmit(attemptId: string, pending: boolean): void {
  try {
    const store = storage();
    if (pending) store?.setItem(`bw_exam_submit_${attemptId}`, "pending");
    else store?.removeItem(`bw_exam_submit_${attemptId}`);
  } catch { /* in-memory submission status still applies */ }
}
