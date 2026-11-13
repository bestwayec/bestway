/**
 * Unsent exam answers, kept on this device until the server confirms them.
 *
 * Each entry is the latest edit of one question with its edit time on the server
 * clock (`editedAt`, ms). The queue survives a reload or a lost connection; the
 * server decides conflicts (last edit wins) and returns the newer value when a
 * queued edit is older than what it already has.
 */
export type QueuedAnswer = { response: string; editedAt: number };
export type AnswerQueue = Record<string, QueuedAnswer>;

const PREFIX = "bw_answer_queue_";
const key = (attemptId: string) => `${PREFIX}${attemptId}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadQueue(attemptId: string): AnswerQueue {
  const store = storage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(key(attemptId)) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const queue: AnswerQueue = {};
    for (const [questionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<QueuedAnswer> | null;
      if (entry && typeof entry.response === "string" && typeof entry.editedAt === "number" && Number.isFinite(entry.editedAt)) {
        queue[questionId] = { response: entry.response, editedAt: entry.editedAt };
      }
    }
    return queue;
  } catch {
    return {};
  }
}

function write(attemptId: string, queue: AnswerQueue) {
  const store = storage();
  if (!store) return;
  try {
    if (Object.keys(queue).length === 0) store.removeItem(key(attemptId));
    else store.setItem(key(attemptId), JSON.stringify(queue));
  } catch {
    // Storage full or blocked: the in-memory queue still sends the answers.
  }
}

/** Record the latest edit of a question. An older edit never replaces a newer one. */
export function enqueue(attemptId: string, questionId: string, response: string, editedAt: number): AnswerQueue {
  const queue = loadQueue(attemptId);
  const current = queue[questionId];
  if (!current || current.editedAt <= editedAt) queue[questionId] = { response, editedAt };
  write(attemptId, queue);
  return queue;
}

/** Forget entries the server confirmed, unless they were edited again meanwhile. */
export function confirm(attemptId: string, sent: { questionId: string; editedAt: number }[]): AnswerQueue {
  const queue = loadQueue(attemptId);
  for (const item of sent) {
    const current = queue[item.questionId];
    if (current && current.editedAt <= item.editedAt) delete queue[item.questionId];
  }
  write(attemptId, queue);
  return queue;
}

export function clearQueue(attemptId: string) {
  write(attemptId, {});
}

/** Queue entries in the order they were made, oldest first. */
export function inOrder(queue: AnswerQueue): { questionId: string; response: string; editedAt: number }[] {
  return Object.entries(queue)
    .map(([questionId, entry]) => ({ questionId, ...entry }))
    .sort((a, b) => a.editedAt - b.editedAt);
}
