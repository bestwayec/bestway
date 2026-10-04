import { MockQuestionType } from '@prisma/client';
import { canonicalDecision } from './question-engine';

/**
 * Yopishtirilgan (paste qilingan) savol matnini tuzilgan savollarga ajratadi.
 * Admin/teacher savollarni ko'chirib tashlaydi — tizim tushunadi, keyin javob
 * kalitini raqam bo'yicha (1,2,3...) beradi. Sof funksiya (I/O yo'q).
 *
 * Qo'llab-quvvatlanadigan format:
 *   1. Savol matni ...              (yoki "1)" , "1:" , "Q1." , "1 ")
 *   A) variant   B) variant ...     (yoki "A." , "(A)")
 *   Bo'sh joy: ____ yoki ......      → completion
 *   Boshida "TRUE/FALSE/NOT GIVEN" ko'rsatmasi bo'lsa → true_false_notgiven
 */

export interface ParsedQuestion {
  number: number;
  prompt: string;
  options?: string[];
  type: MockQuestionType;
}

export interface ParseResult {
  instructions: string | null;
  questions: ParsedQuestion[];
}

const Q_START = /^\s*(?:Q|№|#)?\s*(\d{1,3})\s*[.)\]:-]?\s+(\S.*)$/i;
const OPTION = /^\s*\(?([A-Ha-h])[.)]\s*(\S.*)$/;
const BLANK = /_{2,}|\.{3,}|…|\bgap\b/i;

function detectHint(text: string): 'tfng' | 'ynng' | null {
  const t = text.toLowerCase();
  const notGiven = t.includes('not given');
  if (notGiven && t.includes('true') && t.includes('false')) return 'tfng';
  if (notGiven && /\byes\b/.test(t) && /\bno\b/.test(t)) return 'ynng';
  return null;
}

function classify(
  prompt: string,
  options: string[],
  hint: 'tfng' | 'ynng' | null,
): { type: MockQuestionType; options?: string[] } {
  if (options.length >= 2) return { type: 'multiple_choice', options };
  if (hint === 'tfng') return { type: 'true_false_notgiven', options: ['TRUE', 'FALSE', 'NOT GIVEN'] };
  if (hint === 'ynng') return { type: 'yes_no_notgiven', options: ['YES', 'NO', 'NOT GIVEN'] };
  if (BLANK.test(prompt)) return { type: 'sentence_completion' };
  return { type: 'short_answer' };
}

export function parseQuestions(text: string): ParseResult {
  const hint = detectHint(text);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const preamble: string[] = [];
  const raw: Array<{ number: number; promptLines: string[]; options: string[] }> = [];
  let current: { number: number; promptLines: string[]; options: string[] } | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const opt = OPTION.exec(line);
    if (opt && current) {
      current.options.push(opt[2].trim());
      continue;
    }

    const q = Q_START.exec(line);
    if (q) {
      if (current) raw.push(current);
      current = { number: parseInt(q[1], 10), promptLines: [q[2].trim()], options: [] };
      continue;
    }

    // Davomi yoki muqaddima
    if (current) current.promptLines.push(line.trim());
    else preamble.push(line.trim());
  }
  if (current) raw.push(current);

  const questions: ParsedQuestion[] = raw.map((r) => {
    const prompt = r.promptLines.join(' ').replace(/\s+/g, ' ').trim();
    const { type, options } = classify(prompt, r.options, hint);
    return { number: r.number, prompt, options, type };
  });

  return { instructions: preamble.length ? preamble.join(' ').trim() : null, questions };
}

const TFNG_MAP: Record<string, string> = {
  t: 'TRUE', true: 'TRUE',
  f: 'FALSE', false: 'FALSE',
  ng: 'NOT GIVEN', 'n/g': 'NOT GIVEN', 'notgiven': 'NOT GIVEN', 'not given': 'NOT GIVEN',
  no_information: 'NOT_GIVEN', 'no information': 'NOT_GIVEN', not_given: 'NOT_GIVEN',
  y: 'YES', yes: 'YES', n: 'NO', no: 'NO',
};

/**
 * Admin bergan javobni (matn) qabul qilinadigan variantlar ro'yxatiga aylantiradi.
 * MCQ uchun harf (A/B/C) → variant matni ham qo'shiladi; TFNG uchun qisqartma yoyiladi.
 * Bir nechta to'g'ri javob "/" yoki ";" bilan beriladi.
 */
export function buildCorrectAnswers(
  type: MockQuestionType,
  options: string[] | undefined,
  answerRaw: string,
): string[] {
  const parts = answerRaw
    .split(/[/;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = new Set<string>();

  for (const part of parts) {
    out.add(part);
    const low = part.toLowerCase();

    // TFNG/YNNG qisqartmalari
    if (type === 'true_false_notgiven' || type === 'yes_no_notgiven') {
      if (TFNG_MAP[low]) out.add(canonicalDecision(TFNG_MAP[low]));
    }

    // MCQ / Matching: harf → variant matni
    if ((type === 'multiple_choice' || type === 'multi_select' || type === 'matching' || type === 'matching_headings' || type === 'map_labelling') && options && /^[a-z]$/i.test(part)) {
      const idx = part.toUpperCase().charCodeAt(0) - 65;
      if (options[idx]) out.add(options[idx]);
    }
  }
  return [...out];
}
