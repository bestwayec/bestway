import { MockQuestionType } from '@prisma/client';
import { AnswerRule, canonicalDecision, choiceIndex, respectsAnswerRule, strictAnswerText } from './question-engine';

/**
 * Javob kaliti bo'yicha avtomatik baholash — sof funksiyalar.
 * Spec v2026.1 §3: case-insensitive, whitespace trim + ichki takroriy probel,
 * Br/Am ikkalasi qabul, strict word-limit (limitdan oshsa 0), hyphenated = 1 so'z.
 * Qaror #1 (0–5 tail), #4 (practice/exam farqi service da) bilan mos.
 */

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11',
  twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30',
  forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80',
  ninety: '90', hundred: '100', thousand: '1000',
  // Ordinals / keng tarqalgan shakllar (IELTS raqamli javoblar uchun)
  first: '1', second: '2', third: '3', fifth: '5', eighth: '8', ninth: '9',
  twelfth: '12',
};
const WORD_BY_NUMBER: Record<string, string> = Object.fromEntries(
  Object.entries(NUMBER_WORDS).map(([w, n]) => [n, w]),
);

/** Unicode NFKC + curly quote/dash fold — "…" va "–" bir xillashadi. */
function foldUnicode(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―−]/g, '-');
}

/** Kichik harf, tinish belgilarini bo'shliqqa, ortiqcha probellarni siqish. Defis SAQLANADI (hyphen=1 so'z). */
export function normalize(s: string): string {
  return foldUnicode(s)
    .toLowerCase()
    // Defis/underscore dan tashqari tinish belgilar → bo'shliq
    .replace(/[.,/#!$%^&*;:{}=`~()"?[\]<>+@\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * IELTS so'z sanash: faqat bo'shliq bo'yicha bo'linadi — hyphenated so'z 1 ta.
 * Masalan "mother-in-law" = 1, "second-class" = 1, "well known" = 2.
 */
export function countWords(s: string): number {
  const norm = normalize(s);
  if (!norm) return 0;
  return norm.split(' ').filter(Boolean).length;
}

/** Bitta javob uchun mumkin bo'lgan ekvivalent shakllar to'plami */
function variants(raw: string, extraAccepted: string[] = []): Set<string> {
  const out = new Set<string>();
  const base = normalize(raw);
  if (!base) return out;
  out.add(base);
  // Hyphenated ↔ spaced ikkala shakl qabul (solishtirishda; sanashda hyphen=1)
  if (base.includes('-')) out.add(base.replace(/-/g, ' '));
  if (base.includes(' ')) out.add(base.replace(/\s+/g, '-'));

  // Boshidagi artiklni olib tashlash (IELTS ko'pincha a/an/the ni hisobga olmaydi)
  const noArticle = base.replace(/^(a|an|the)\s+/, '');
  out.add(noArticle);
  if (noArticle.includes('-')) out.add(noArticle.replace(/-/g, ' '));

  // Raqam ↔ so'z ekvivalenti (bitta token uchun)
  for (const form of [base, noArticle]) {
    if (NUMBER_WORDS[form]) out.add(NUMBER_WORDS[form]);
    if (WORD_BY_NUMBER[form]) out.add(WORD_BY_NUMBER[form]);
  }

  // Muallif kiritgan Br/Am variantlar (acceptedVariants ustuni)
  for (const extra of extraAccepted) {
    const n = normalize(extra);
    if (n) {
      out.add(n);
      if (n.includes('-')) out.add(n.replace(/-/g, ' '));
    }
  }
  return out;
}

/** javob to'plamlaridan biri mos kelsa true */
function anyOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

/** Vergul/probel bilan ajratilgan tanlovlar to'plami (multi_select uchun) */
function toChoiceSet(s: string): Set<string> {
  return new Set(
    s
      .split(/[,;\s]+/)
      .map((x) => normalize(x))
      .filter(Boolean),
  );
}

export interface AnswerCheckOptions {
  /** "NO MORE THAN X WORDS" — oshsa qat'iy 0 (spec §3). */
  wordLimit?: number | null;
  /** Savol muallifi kiritgan qo'shimcha to'g'ri shakllar (Br/Am). */
  acceptedVariants?: string[] | null;
  answerRule?: AnswerRule | string | null;
  options?: string[] | null;
}

/**
 * Javob to'g'rimi? correctAnswers — qabul qilinadigan variantlar ro'yxati.
 * multi_select: tanlovlar to'plami aynan mos kelishi kerak (tartibsiz).
 * Qolganlari: variant ekvivalenti bo'yicha mos kelsa yetarli.
 * wordLimit berilsa va javob undan uzun bo'lsa — har doim false (hatto so'zlar to'g'ri bo'lsa ham).
 */
export function isAnswerCorrect(
  type: MockQuestionType,
  response: string,
  correctAnswers: string[],
  opts: AnswerCheckOptions = {},
): boolean {
  if (!response || !response.trim() || correctAnswers.length === 0) return false;

  if (opts.answerRule === 'ONE_WORD' || opts.answerRule === 'ONE_WORD_AND_OR_NUMBER') {
    if (!respectsAnswerRule(response, opts.answerRule)) return false;
    const value = strictAnswerText(response);
    return [...correctAnswers, ...(opts.acceptedVariants ?? [])].some((key) => strictAnswerText(key) === value);
  }

  if (type === 'true_false_notgiven' || type === 'yes_no_notgiven') {
    const value = canonicalDecision(response);
    return correctAnswers.some((key) => canonicalDecision(key) === value);
  }

  if (opts.options?.length && ['multiple_choice', 'matching', 'matching_headings', 'map_labelling'].includes(type)) {
    const chosen = choiceIndex(response, opts.options);
    const expected = correctAnswers.map((key) => choiceIndex(key, opts.options!));
    // The option bank adds letter/option-text cross-format matching. When both the
    // response and every stored key resolve to the bank, the index decides the result.
    if (chosen !== null && expected.every((index) => index !== null)) return expected.includes(chosen);
    // A stored key that does not resolve to the bank is malformed authoring (already
    // flagged for publication). It must not turn a legitimate text answer into a
    // wrong score: fall through to the legacy normalization below.
  }

  if (type === 'multi_select' && opts.options?.length) {
    const parts = response.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
    const selectedParts = parts.length === 1 && /^[a-z](?:\s+[a-z])+$/i.test(parts[0]) ? parts[0].split(/\s+/) : parts;
    const chosen = selectedParts.map((part) => choiceIndex(part, opts.options!));
    const expectedIndexes = correctAnswers.map((key) => choiceIndex(key, opts.options!));
    if (!chosen.includes(null) && !expectedIndexes.includes(null)) {
      const expected = new Set(expectedIndexes);
      return new Set(chosen).size === expected.size && chosen.every((index) => expected.has(index));
    }
    // Either side did not resolve to the shared bank — keep the legacy set comparison.
  }

  // Strict word-count (spec §3): "NO MORE THAN TWO WORDS" + 3 so'z → 0.
  if (opts.wordLimit != null && opts.wordLimit > 0) {
    if (countWords(response) > opts.wordLimit) return false;
  }

  if (type === 'multi_select') {
    const chosen = toChoiceSet(response);
    const key = new Set<string>();
    for (const c of correctAnswers) for (const v of toChoiceSet(c)) key.add(v);
    if (chosen.size !== key.size) return false;
    for (const v of chosen) if (!key.has(v)) return false;
    return true;
  }

  const extra = opts.acceptedVariants ?? [];
  // acceptedVariants expands only the key side. Expanding the response side too
  // would let any response matching a variant pass regardless of the key.
  const respVariants = variants(response);
  const keySet = new Set<string>();
  for (const c of correctAnswers) for (const v of variants(c)) keySet.add(v);
  for (const e of extra) for (const v of variants(e)) keySet.add(v);
  return anyOverlap(respVariants, keySet);
}
