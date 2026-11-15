/**
 * When the server deadline of the current section passes in a full test, the exam moves on to
 * the next section; only the last section (or a single-section attempt) is handed in. Speaking
 * has its own per-answer windows, so its end hands the exam in.
 */
export function nextSectionOnTimeout(fullTest: boolean, currentSkill: string | null | undefined, order: string[]): boolean {
  if (!fullTest || !currentSkill || currentSkill === "speaking") return false;
  const index = order.indexOf(currentSkill);
  return index >= 0 && index < order.length - 1;
}
