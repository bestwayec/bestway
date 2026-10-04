import { createHash } from 'node:crypto';
import { countWords } from './mock-answer';
import { gapNumbersFromHtml, MOCK_CONTENT_LAYOUTS, sanitizeMockContent } from './mock-content';
import { ANSWER_RULES, canonicalDecision, objectiveGroupIssues, objectiveQuestionIssues } from './question-engine';
import { buildCorrectAnswers } from './mock-parse';
import { multilevelBlueprintIssues } from './multilevel-specification';
import { MockSkill } from '@prisma/client';

export type ImportBlock = 'import' | 'publish';
export interface ImportIssue {
  code: string;
  path: string;
  message: string;
  blocks: ImportBlock[];
  sourceKey?: string;
}
export interface ImportCounts { sections: number; skills: number; groups: number; questions: number; media: number; }
export interface ImportReport {
  checksum: string;
  issues: ImportIssue[];
  counts: ImportCounts;
  canImport: boolean;
  canPublish: boolean;
  sanitizerNotes: Array<{ path: string; changed: boolean }>;
  truncated: boolean;
  totalIssues: number;
}
export interface ValidateOptions { mediaBindings?: Record<string, string>; rawText?: string; }

const KEY_RE = /^[a-z][a-z0-9_-]{0,79}$/;
const SKILLS = ['listening', 'reading', 'writing', 'speaking'];
const PROFILES = ['practice', 'full_mock'];
const EXAM_TYPES = ['ielts_academic', 'ielts_general', 'multilevel'];
const Q_TYPES = ['multiple_choice','multi_select','true_false_notgiven','yes_no_notgiven','matching','matching_headings','sentence_completion','note_completion','summary_completion','table_completion','short_answer','map_labelling','essay_task1','essay_task2','speaking_task'];
const AUTO_TYPES = ['multiple_choice','multi_select','true_false_notgiven','yes_no_notgiven','matching','matching_headings','sentence_completion','note_completion','summary_completion','table_completion','short_answer','map_labelling'];
const TEXT_TYPES = ['sentence_completion','note_completion','summary_completion','table_completion','short_answer'];
const CHOICE_SINGLE = ['multiple_choice','matching','matching_headings'];
const LAYOUTS: readonly string[] = MOCK_CONTENT_LAYOUTS;
const ISSUE_CODES = ['MISSING_ANSWER','AMBIGUOUS_TEXT','MISSING_MEDIA','UNSUPPORTED_LAYOUT','NUMBERING_REVIEW','OTHER'];
const MAX_ISSUES = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function canonicalStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(',')}]`;
  if (isRecord(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function canonicalChecksum(pkg: unknown): string {
  return createHash('sha256').update(canonicalStringify(pkg)).digest('hex');
}

/** Scan raw JSON text for duplicate object keys (JSON.parse keeps only the last). */
export function detectDuplicateKeys(raw: string): string[] {
  const dups: string[] = [];
  const stack: Array<{ keys: Set<string>; path: string }> = [];
  let i = 0;
  const pushPath = (key: string) => {
    const top = stack[stack.length - 1];
    return top ? `${top.path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}` : `/${key}`;
  };
  let pendingKey: string | null = null;
  const readString = (): string => {
    let out = '';
    i++; // opening quote
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '\\') { out += raw[i + 1] ?? ''; i += 2; continue; }
      if (ch === '"') { i++; break; }
      out += ch; i++;
    }
    return out;
  };
  const skipWs = () => { while (i < raw.length && /\s/.test(raw[i])) i++; };
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      const s = readString();
      skipWs();
      if (raw[i] === ':') {
        pendingKey = s;
        // check duplicate in current object
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
    if (ch === '{') {
      const base = pendingKey != null ? pushPath(pendingKey) : (stack.length ? stack[stack.length-1].path : '');
      stack.push({ keys: new Set(), path: base });
      pendingKey = null; i++; continue;
    }
    if (ch === '}') { stack.pop(); pendingKey = null; i++; continue; }
    if (ch === '[') { pendingKey = null; i++; continue; }
    if (ch === ']') { pendingKey = null; i++; continue; }
    i++;
  }
  return dups;
}

function resolvePointer(root: unknown, pointer: string): boolean {
  if (pointer === '' || pointer === '/') return true;
  if (!pointer.startsWith('/')) return false;
  const parts = pointer.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = root;
  for (const part of parts) {
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return false;
      cur = cur[idx];
    } else if (isRecord(cur)) {
      if (!(part in cur)) return false;
      cur = cur[part];
    } else return false;
  }
  return true;
}

const TOP_FIELDS = ['schemaVersion','packageId','revision','profile','source','exam','media','reviewIssues'];

export function validateImportPackage(pkg: unknown, opts: ValidateOptions = {}): ImportReport {
  const issues: ImportIssue[] = [];
  const sanitizerNotes: Array<{ path: string; changed: boolean }> = [];
  const add = (code: string, path: string, message: string, blocks: ImportBlock[], sourceKey?: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ code, path, message, blocks, ...(sourceKey ? { sourceKey } : {}) });
  };
  const bindings = opts.mediaBindings ?? {};

  if (opts.rawText) {
    for (const p of detectDuplicateKeys(opts.rawText)) {
      add('DUPLICATE_KEY', p || '/', `Duplicate JSON object key at ${p || '/'}`, ['import']);
    }
    try {
      const bytes = Buffer.byteLength(opts.rawText, 'utf8');
      if (bytes > 2 * 1024 * 1024) add('SIZE_LIMIT', '', `Package exceeds 2 MiB (${bytes} bytes)`, ['import']);
    } catch { /* ignore */ }
  }

  if (!isRecord(pkg)) {
    add('JSON_PARSE', '', 'Package must be a JSON object', ['import']);
    return finish(pkg, issues, sanitizerNotes, { sections: 0, skills: 0, groups: 0, questions: 0, media: 0 });
  }

  for (const k of Object.keys(pkg)) {
    if (!TOP_FIELDS.includes(k)) add('UNKNOWN_FIELD', `/${k}`, `Unknown top-level field "${k}"`, ['import']);
  }

  if (pkg['schemaVersion'] !== '1.0') add('SCHEMA_VERSION', '/schemaVersion', 'schemaVersion must be exactly "1.0"', ['import']);
  const packageId = pkg['packageId'];
  if (typeof packageId !== 'string' || !KEY_RE.test(packageId)) add('PACKAGE_ID', '/packageId', 'packageId must match ^[a-z][a-z0-9_-]{0,79}$', ['import']);
  const revision = pkg['revision'];
  if (!Number.isInteger(revision) || (revision as number) < 1) add('REVISION', '/revision', 'revision must be an integer >= 1', ['import']);
  const profile = pkg['profile'];
  if (typeof profile !== 'string' || !PROFILES.includes(profile)) add('ENUM_INVALID', '/profile', 'profile must be practice or full_mock', ['import']);

  const source = pkg['source'];
  if (!isRecord(source)) add('SOURCE', '/source', 'source object is required', ['import']);
  else {
    for (const k of Object.keys(source)) if (!['kind','label','notes'].includes(k)) add('UNKNOWN_FIELD', `/source/${k}`, `Unknown source field "${k}"`, ['import']);
    if (source['kind'] !== 'provided_material' && source['kind'] !== 'original_practice') add('ENUM_INVALID', '/source/kind', 'source.kind is invalid', ['import']);
    if (typeof source['label'] !== 'string' || !source['label'].trim()) add('SOURCE_LABEL', '/source/label', 'source.label must be non-blank', ['import']);
  }

  const exam = pkg['exam'] as Record<string, unknown> | undefined;
  let counts: ImportCounts = { sections: 0, skills: 0, groups: 0, questions: 0, media: 0 };
  const numbers = new Map<string | number, string>();
  const groupKeys = new Set<string>();
  const questionKeys = new Set<string>();
  const sectionKeys = new Set<string>();
  const skillSet = new Set<string>();
  const mediaKeys = new Map<string, { kind: string; path: string; requiredForPublish: boolean; fileName: string }>();
  const mediaRefs: Array<{ key: string; kind: string; path: string }> = [];

  if (!isRecord(exam)) {
    add('EXAM', '/exam', 'exam object is required', ['import']);
  } else {
    for (const k of Object.keys(exam)) {
      if (!['type','title','description','level','practiceLevel','isDemo','price','isFreeForApproved','sections'].includes(k)) {
        add('UNKNOWN_FIELD', `/exam/${k}`, `Unknown exam field "${k}"`, ['import']);
      }
    }
    if (pkg && 'isPublished' in (pkg as Record<string, unknown>)) { /* top-level guard */ }
    if (typeof exam['type'] !== 'string' || !EXAM_TYPES.includes(exam['type'] as string)) add('ENUM_INVALID', '/exam/type', 'exam.type is invalid', ['import']);
    if (typeof exam['title'] !== 'string' || exam['title'].trim().length < 3) add('EXAM_TITLE', '/exam/title', 'exam.title must be at least 3 non-blank chars', ['import']);
    if (typeof exam['description'] !== 'string') add('EXAM_DESC', '/exam/description', 'exam.description must be a string', ['import']);
    if (typeof exam['level'] !== 'string') add('EXAM_LEVEL', '/exam/level', 'exam.level must be a string', ['import']);
    if (exam.practiceLevel != null && !['A1','A2','B1','B2','C1'].includes(String(exam.practiceLevel))) add('ENUM_INVALID', '/exam/practiceLevel', 'practiceLevel must be A1, A2, B1, B2 or C1', ['import']);
    if (typeof exam['isDemo'] !== 'boolean') add('EXAM_DEMO', '/exam/isDemo', 'exam.isDemo must be boolean', ['import']);
    if (!Number.isInteger(exam['price']) || (exam['price'] as number) < 0) add('EXAM_PRICE', '/exam/price', 'exam.price must be a non-negative integer', ['import']);
    if (typeof exam['isFreeForApproved'] !== 'boolean') add('EXAM_FREE', '/exam/isFreeForApproved', 'exam.isFreeForApproved must be boolean', ['import']);
    if ('isPublished' in exam) add('PUBLISH_INJECTION', '/exam/isPublished', 'Package must not set publication state', ['import']);

    const sections = exam['sections'];
    if (!Array.isArray(sections) || sections.length < 1 || sections.length > 4) {
      add('COUNT_LIMIT', '/exam/sections', 'exam.sections must contain 1-4 sections', ['import']);
    } else {
      counts.sections = sections.length;
      sections.forEach((s: unknown, si: number) => {
        const base = `/exam/sections/${si}`;
        if (!isRecord(s)) { add('SECTION', base, 'section must be an object', ['import']); return; }
        for (const k of Object.keys(s)) {
          if (!['key','skill','title','instructions','durationMinutes','groups'].includes(k)) add('UNKNOWN_FIELD', `${base}/${k}`, `Unknown section field "${k}"`, ['import']);
        }
        const sk = s['key'];
        if (typeof sk !== 'string' || !KEY_RE.test(sk)) add('KEY_FORMAT', `${base}/key`, 'section.key format invalid', ['import']);
        else if (sectionKeys.has(sk)) add('KEY_DUPLICATE', `${base}/key`, `duplicate section key "${sk}"`, ['import']);
        else sectionKeys.add(sk);
        const skill = s['skill'];
        if (typeof skill !== 'string' || !SKILLS.includes(skill)) add('ENUM_INVALID', `${base}/skill`, 'section.skill is invalid', ['import']);
        else if (skillSet.has(skill)) add('SKILL_DUPLICATE', `${base}/skill`, `skill "${skill}" appears more than once`, ['import']);
        else skillSet.add(skill);
        if (typeof s['title'] !== 'string' || !s['title'].trim()) add('SECTION_TITLE', `${base}/title`, 'section.title must be non-blank', ['import']);
        if (typeof s['instructions'] !== 'string') add('SECTION_INSTR', `${base}/instructions`, 'section.instructions must be a string', ['import']);
        if (s['durationMinutes'] !== undefined && (!Number.isInteger(s['durationMinutes']) || (s['durationMinutes'] as number) < 1 || (s['durationMinutes'] as number) > 300)) {
          add('DURATION', `${base}/durationMinutes`, 'durationMinutes must be 1-300', ['import']);
        }
        const groups = s['groups'];
        if (!Array.isArray(groups) || groups.length < 1 || groups.length > 50) {
          add('COUNT_LIMIT', `${base}/groups`, 'section.groups must contain 1-50 groups', ['import']);
          return;
        }
        groups.forEach((g: unknown, gi: number) => {
          const gb = `${base}/groups/${gi}`;
          if (!isRecord(g)) { add('GROUP', gb, 'group must be an object', ['import']); return; }
          for (const k of Object.keys(g)) {
            if (!['key','title','instructions','passageText','contentHtml','contentLayout','optionsReusable','audioScript','partNumber','audioPlayLimit','audioRef','imageRef','questions'].includes(k)) {
              add('UNKNOWN_FIELD', `${gb}/${k}`, `Unknown group field "${k}"`, ['import']);
            }
          }
          const gk = g['key'];
          if (typeof gk !== 'string' || !KEY_RE.test(gk)) add('KEY_FORMAT', `${gb}/key`, 'group.key format invalid', ['import']);
          else if (groupKeys.has(gk)) add('KEY_DUPLICATE', `${gb}/key`, `duplicate group key "${gk}"`, ['import']);
          else groupKeys.add(gk);
          if (typeof g['title'] !== 'string' || !g['title'].trim()) add('GROUP_TITLE', `${gb}/title`, 'group.title must be non-blank', ['import']);
          if (typeof g['instructions'] !== 'string') add('GROUP_INSTR', `${gb}/instructions`, 'group.instructions must be a string', ['import']);
          if (typeof g['passageText'] !== 'string') add('GROUP_PASSAGE', `${gb}/passageText`, 'group.passageText must be a string', ['import']);
          if (typeof g['contentHtml'] !== 'string') add('GROUP_HTML', `${gb}/contentHtml`, 'group.contentHtml must be a string', ['import']);
          if (typeof g['audioScript'] !== 'string') add('GROUP_SCRIPT', `${gb}/audioScript`, 'group.audioScript must be a string', ['import']);
          if (typeof g['contentLayout'] !== 'string' || !LAYOUTS.includes(g['contentLayout'] as string)) add('ENUM_INVALID', `${gb}/contentLayout`, 'group.contentLayout is invalid', ['import']);
          if (g.optionsReusable != null && typeof g.optionsReusable !== 'boolean') add('OPTION_REUSE', `${gb}/optionsReusable`, 'optionsReusable must be boolean or null', ['import']);
          if (g['partNumber'] !== undefined && (typeof skill !== 'string' || skill !== 'listening')) {
            add('PART_NUMBER', `${gb}/partNumber`, 'partNumber is only allowed for listening groups', ['import']);
          }
          if (g['partNumber'] !== undefined && (!Number.isInteger(g['partNumber']) || (g['partNumber'] as number) < 1 || (g['partNumber'] as number) > (exam['type'] === 'multilevel' ? 6 : 4))) {
            add('PART_NUMBER', `${gb}/partNumber`, 'partNumber outside program range', ['import']);
          }
          if (g['audioPlayLimit'] !== undefined && (!Number.isInteger(g['audioPlayLimit']) || (g['audioPlayLimit'] as number) < 1 || (g['audioPlayLimit'] as number) > 10)) {
            add('PLAY_LIMIT', `${gb}/audioPlayLimit`, 'audioPlayLimit must be 1-10', ['import']);
          }
          if (typeof g['audioRef'] === 'string') mediaRefs.push({ key: g['audioRef'] as string, kind: 'audio', path: `${gb}/audioRef` });
          if (typeof g['imageRef'] === 'string') mediaRefs.push({ key: g['imageRef'] as string, kind: 'image', path: `${gb}/imageRef` });

          const html = g['contentHtml'] as string;
          if (typeof html === 'string' && html !== '') {
            const clean = sanitizeMockContent(html);
            sanitizerNotes.push({ path: `${gb}/contentHtml`, changed: (clean ?? '') !== html });
            if (clean === null) {
              add('HTML_UNSAFE', `${gb}/contentHtml`, 'contentHtml was fully stripped by the sanitizer', ['import']);
            }
          }
          const script = g['audioScript'] as string;
          if (typeof script === 'string' && script !== '') {
            const clean = sanitizeMockContent(script);
            sanitizerNotes.push({ path: `${gb}/audioScript`, changed: (clean ?? '') !== script });
          }

          const questions = g['questions'];
          if (!Array.isArray(questions) || questions.length < 1 || questions.length > 200) {
            add('COUNT_LIMIT', `${gb}/questions`, 'group.questions must contain 1-200 questions', ['import']);
            return;
          }
          const qNums: number[] = [];
          const isRich = typeof html === 'string' && html !== '';
          questions.forEach((q: unknown, qi: number) => {
            const qb = `${gb}/questions/${qi}`;
            if (!isRecord(q)) { add('QUESTION', qb, 'question must be an object', ['import']); return; }
            for (const k of Object.keys(q)) {
              if (!['key','number','type','prompt','options','correctAnswers','acceptedVariants','points','wordLimit','answerRule','sourceRef'].includes(k)) {
                add('UNKNOWN_FIELD', `${qb}/${k}`, `Unknown question field "${k}"`, ['import']);
              }
            }
            const qk = q['key'];
            if (typeof qk !== 'string' || !KEY_RE.test(qk)) add('KEY_FORMAT', `${qb}/key`, 'question.key format invalid', ['import']);
            else if (questionKeys.has(qk)) add('KEY_DUPLICATE', `${qb}/key`, `duplicate question key "${qk}"`, ['import']);
            else questionKeys.add(qk);
            const num = q['number'];
            if (typeof num === 'string') add('NUMBER_TYPE', `${qb}/number`, 'question.number must be a number, not a string', ['import']);
            else if (!Number.isInteger(num) || (num as number) < 1 || (num as number) > 200) add('NUMBER_RANGE', `${qb}/number`, 'question.number must be 1-200', ['import']);
            else {
              qNums.push(num as number);
              const numberKey = exam['type'] === 'multilevel' ? `${skill}:${num}` : num as number;
              if (numbers.has(numberKey)) add('NUMBER_COLLISION', `${qb}/number`, `question number ${num} collides with ${numbers.get(numberKey)}`, ['import']);
              else numbers.set(numberKey, qb);
            }
            const qt = q['type'];
            if (typeof qt !== 'string' || !Q_TYPES.includes(qt)) { add('ENUM_INVALID', `${qb}/type`, 'question.type is invalid', ['import']); return; }
            // type/skill compatibility
            if (typeof skill === 'string') {
              if ((skill === 'listening' || skill === 'reading') && !AUTO_TYPES.includes(qt as string)) {
                add('TYPE_SKILL_MISMATCH', `${qb}/type`, `type "${qt}" is not allowed for ${skill}`, ['import']);
              }
              if (skill === 'writing' && qt !== 'essay_task1' && qt !== 'essay_task2') {
                add('TYPE_SKILL_MISMATCH', `${qb}/type`, `writing groups accept only essay tasks`, ['import']);
              }
              if (skill === 'speaking' && qt !== 'speaking_task') {
                add('TYPE_SKILL_MISMATCH', `${qb}/type`, `speaking groups accept only speaking_task`, ['import']);
              }
            }
            if (typeof q['prompt'] !== 'string' || !q['prompt'].trim()) add('PROMPT', `${qb}/prompt`, 'question.prompt must be non-blank', ['import']);
            const options = q['options'];
            if (!Array.isArray(options)) add('OPTIONS', `${qb}/options`, 'question.options must be an array', ['import']);
            else {
              const trimmed = (options as unknown[]).map((o) => (typeof o === 'string' ? o.trim() : ''));
              if (trimmed.some((o) => o === '')) add('OPTION_EMPTY', `${qb}/options`, 'options must not contain blank entries', ['import']);
              if (new Set(trimmed).size !== trimmed.length) add('OPTION_DUPLICATE', `${qb}/options`, 'options contain duplicates after trimming', ['import']);
              for (const o of trimmed) {
                if (/^[A-Z][).]\s/.test(o)) add('OPTION_FORMAT', `${qb}/options`, 'options must be plain text without "A) " prefixes', ['import']);
              }
              if (['multiple_choice','multi_select','matching','matching_headings'].includes(qt as string) && options.length < 2) {
                add('OPTIONS_REQUIRED', `${qb}/options`, 'choice questions require at least 2 options', ['import']);
              }
              if (['multiple_choice','matching','matching_headings'].includes(qt as string) && options.length > 26) {
                add('COUNT_LIMIT', `${qb}/options`, 'options limited to 26', ['import']);
              }
              if (qt === 'true_false_notgiven') {
                const ok = options.length === 3 && (options as string[]).map(canonicalDecision).join(',') === 'TRUE,FALSE,NOT_GIVEN';
                if (!ok) add('TFNG_OPTIONS', `${qb}/options`, 'TFNG options must be exactly ["TRUE","FALSE","NOT GIVEN"]', ['import']);
              }
              if (qt === 'yes_no_notgiven') {
                const ok = options.length === 3 && (options as string[]).map(canonicalDecision).join(',') === 'YES,NO,NOT_GIVEN';
                if (!ok) add('YNNG_OPTIONS', `${qb}/options`, 'YNNG options must be exactly ["YES","NO","NOT GIVEN"]', ['import']);
              }
              if (TEXT_TYPES.includes(qt as string) && options.length !== 0) {
                add('OPTIONS_FORBIDDEN', `${qb}/options`, `type "${qt}" must have empty options`, ['import']);
              }
              if ((qt === 'essay_task1' || qt === 'essay_task2' || qt === 'speaking_task') && options.length !== 0) {
                add('OPTIONS_FORBIDDEN', `${qb}/options`, `manual tasks must have empty options`, ['import']);
              }
            }
            const correct = q['correctAnswers'];
            if (!Array.isArray(correct)) add('CORRECT', `${qb}/correctAnswers`, 'correctAnswers must be an array', ['import']);
            else {
              const isManual = qt === 'essay_task1' || qt === 'essay_task2' || qt === 'speaking_task';
              if (!isManual && correct.length < 1) add('MISSING_ANSWER', `${qb}/correctAnswers`, 'auto-graded questions require at least one key', ['import']);
              if (isManual && correct.length !== 0) add('MANUAL_KEY', `${qb}/correctAnswers`, 'manual tasks must have empty correctAnswers', ['import']);
              if (['multiple_choice','matching','matching_headings'].includes(qt as string)) {
                if (correct.length > 1) add('CORRECT_COUNT', `${qb}/correctAnswers`, 'single-choice questions accept exactly one letter', ['import']);
                for (const c of correct) {
                  if (typeof c !== 'string' || !/^[A-Z]$/.test(c)) {
                    add('CORRECT_LETTER', `${qb}/correctAnswers`, `correct answer "${String(c)}" must be a single uppercase letter`, ['import']);
                  } else if (Array.isArray(options)) {
                    // Reuse buildCorrectAnswers mapping: letter must resolve to an option.
                    const expanded = buildCorrectAnswers(qt as never, options as string[], c);
                    if (expanded.length === 1) {
                      add('OPTION_LETTER_RANGE', `${qb}/correctAnswers`, `letter "${c}" is beyond the options array`, ['import']);
                    }
                  }
                }
              }
              if (qt === 'multi_select') {
                if (correct.length < 2) add('CORRECT_COUNT', `${qb}/correctAnswers`, 'multi-select requires at least two letters', ['import']);
                for (const c of correct) {
                  if (typeof c !== 'string' || !/^[A-Z]$/.test(c)) {
                    add('CORRECT_LETTER', `${qb}/correctAnswers`, `multi-select key "${String(c)}" must be a single uppercase letter`, ['import']);
                  } else if (Array.isArray(options) && (c.charCodeAt(0) - 65) >= options.length) {
                    add('OPTION_LETTER_RANGE', `${qb}/correctAnswers`, `letter "${c}" is beyond the options array`, ['import']);
                  }
                }
                if (new Set(correct as string[]).size !== (correct as string[]).length) {
                  add('CORRECT_DUPLICATE', `${qb}/correctAnswers`, 'correctAnswers contain duplicates', ['import']);
                }
              }
              if (qt === 'true_false_notgiven') {
                for (const c of correct) {
                  if (typeof c !== 'string' || !['TRUE','FALSE','NOT_GIVEN'].includes(canonicalDecision(c))) {
                    add('CORRECT_VALUE', `${qb}/correctAnswers`, 'TFNG key must be TRUE, FALSE or NOT GIVEN', ['import']);
                  }
                }
              }
              if (qt === 'yes_no_notgiven') {
                for (const c of correct) {
                  if (typeof c !== 'string' || !['YES','NO','NOT_GIVEN'].includes(canonicalDecision(c))) {
                    add('CORRECT_VALUE', `${qb}/correctAnswers`, 'YNNG key must be YES, NO or NOT GIVEN', ['import']);
                  }
                }
              }
            }
            const variants = q['acceptedVariants'];
            if (!Array.isArray(variants)) add('VARIANTS', `${qb}/acceptedVariants`, 'acceptedVariants must be an array', ['import']);
            else {
              const choiceOrManual = ['multiple_choice','multi_select','matching','matching_headings','true_false_notgiven','yes_no_notgiven','essay_task1','essay_task2','speaking_task'].includes(qt as string);
              if (choiceOrManual && variants.length !== 0) {
                add('VARIANT_MISUSE', `${qb}/acceptedVariants`, 'acceptedVariants is reserved for text answers', ['import']);
              }
              for (const v of variants) {
                if (typeof v !== 'string' || !v.trim() || v.length > 1000) {
                  add('VARIANT_VALUE', `${qb}/acceptedVariants`, 'each variant must be 1-1000 chars', ['import']);
                }
                if (typeof v === 'string' && v.includes('/')) {
                  add('VARIANT_FORMAT', `${qb}/acceptedVariants`, 'variants must not use a/b syntax', ['import']);
                }
              }
            }
            const points = q['points'];
            if (!Number.isInteger(points) || (points as number) < 1 || (points as number) > 20) {
              add('POINTS_INVALID', `${qb}/points`, 'points must be 1-20', ['import']);
            } else {
              const examType = (exam as Record<string, unknown>)['type'];
              const ielts = examType === 'ielts_academic' || examType === 'ielts_general';
              const manual = qt === 'essay_task1' || qt === 'essay_task2' || qt === 'speaking_task';
              if (ielts && manual && points !== 9) {
                add('POINTS_INVALID', `${qb}/points`, 'IELTS manual tasks use 9 points', ['import']);
              }
            }
            const wl = q['wordLimit'];
            const needsWl = TEXT_TYPES.includes(qt as string) || (qt === 'map_labelling' && Array.isArray(options) && options.length === 0);
            if (wl !== undefined) {
              if (!needsWl) add('WORD_LIMIT', `${qb}/wordLimit`, 'wordLimit is only allowed for text completion answers', ['import']);
              else if (!Number.isInteger(wl) || (wl as number) < 1 || (wl as number) > 50) {
                add('WORD_LIMIT', `${qb}/wordLimit`, 'wordLimit must be 1-50', ['import']);
              } else {
                // Reuse grading word-count: every stored answer must respect the limit.
                for (const a of [...(Array.isArray(correct) ? correct : []), ...(Array.isArray(variants) ? variants : [])]) {
                  if (q.answerRule == null && typeof a === 'string' && countWords(a) > (wl as number)) {
                    add('WORD_LIMIT', `${qb}/correctAnswers`, `answer "${a}" exceeds wordLimit ${wl}`, ['import']);
                  }
                }
              }
            }
            if (q.answerRule != null && !(ANSWER_RULES as readonly unknown[]).includes(q.answerRule)) add('ANSWER_RULE', `${qb}/answerRule`, 'answerRule is invalid', ['import']);
            objectiveQuestionIssues(q as unknown as Parameters<typeof objectiveQuestionIssues>[0], skill === 'reading' || skill === 'listening').forEach((issue) => add('QUESTION_ENGINE', qb, issue, ['import']));
            if (typeof q['sourceRef'] !== 'string' || !q['sourceRef'].trim()) {
              add('SOURCE_REF', `${qb}/sourceRef`, 'question.sourceRef must be non-blank', ['import']);
            }
          });
          counts.questions += questions.length;
          const groupIssues = objectiveGroupIssues({ contentLayout: g.contentLayout as string, optionsReusable: g.optionsReusable as boolean | null, imageKey: g.imageRef as string | undefined, questions: questions.filter(isRecord) as unknown as Parameters<typeof objectiveGroupIssues>[0]['questions'] }, skill === 'reading' || skill === 'listening');
          groupIssues.forEach((issue) => add('QUESTION_ENGINE', gb, issue, issue.includes('require an image') ? ['publish'] : ['import']));
          // Gap mapping: reuse sanitizer + token extraction semantics.
          if (isRich && (gapNumbersFromHtml(sanitizeMockContent(html)).length > 0 || ['document','table','notes','summary','sentences'].includes(String(g.contentLayout)))) {
            const clean = sanitizeMockContent(html) ?? '';
            const gaps = gapNumbersFromHtml(clean);
            const gapSet = new Set(gaps);
            const qSet = new Set(qNums);
            const dupGaps = gaps.filter((n, idx) => gaps.indexOf(n) !== idx);
            if (dupGaps.length) add('GAP_TOKEN_DUPLICATE', `${gb}/contentHtml`, `duplicate gap tokens: ${[...new Set(dupGaps)].join(', ')}`, ['import']);
            const missingQ = gaps.filter((n) => !qSet.has(n));
            const missingT = qNums.filter((n) => !gapSet.has(n));
            if (missingQ.length || missingT.length || qSet.size !== qNums.length) {
              add('GAP_QUESTION_MISMATCH', `${gb}/contentHtml`, `gap mapping mismatch${missingQ.length ? `; savolsiz gaplar: ${[...new Set(missingQ)].join(', ')}` : ''}${missingT.length ? `; gapsiz savollar: ${[...new Set(missingT)].join(', ')}` : ''}`, ['import'], typeof g['key'] === 'string' ? (g['key'] as string) : undefined);
            }
            // Rich groups accept text completion types only.
            const badRich = questions.some((q: unknown) => isRecord(q) && !TEXT_TYPES.includes(String((q as Record<string, unknown>)['type'])));
            if (badRich) add('RICH_TYPE', `${gb}/contentHtml`, 'rich groups support text completion answers only', ['import']);
          } else {
            // Ordinary groups with choice/matching/manual must stay empty (already empty).
          }
        });
      });
      counts.groups = groupKeys.size;
      counts.skills = skillSet.size;
      counts.media = Array.isArray(pkg['media']) ? (pkg['media'] as unknown[]).length : 0;
      if (counts.groups > 50) add('COUNT_LIMIT', '/exam/sections', 'total groups exceed 50', ['import']);
      if (counts.questions > 200) add('COUNT_LIMIT', '/exam/sections', 'total questions exceed 200', ['import']);
      if (counts.skills > 4) add('COUNT_LIMIT', '/exam/sections', 'distinct skills exceed 4', ['import']);
    }
  }

  // Media declarations
  const media = pkg['media'];
  if (!Array.isArray(media)) {
    add('MEDIA', '/media', 'media must be an array', ['import']);
  } else {
    if (media.length > 20) add('COUNT_LIMIT', '/media', 'media declarations exceed 20', ['import']);
    media.forEach((m: unknown, mi: number) => {
      const mb = `/media/${mi}`;
      if (!isRecord(m)) { add('MEDIA', mb, 'media entry must be an object', ['import']); return; }
      for (const k of Object.keys(m)) {
        if (!['key','kind','fileName','requiredForPublish','description'].includes(k)) add('UNKNOWN_FIELD', `${mb}/${k}`, `Unknown media field "${k}"`, ['import']);
      }
      const mk = m['key'];
      if (typeof mk !== 'string' || !KEY_RE.test(mk)) add('KEY_FORMAT', `${mb}/key`, 'media.key format invalid', ['import']);
      else if (mediaKeys.has(mk)) add('KEY_DUPLICATE', `${mb}/key`, `duplicate media key "${mk}"`, ['import']);
      else if (typeof m['kind'] === 'string' && typeof m['fileName'] === 'string') {
        mediaKeys.set(mk, { kind: m['kind'] as string, path: mb, requiredForPublish: m['requiredForPublish'] === true, fileName: m['fileName'] as string });
      }
      if (m['kind'] !== 'audio' && m['kind'] !== 'image') add('ENUM_INVALID', `${mb}/kind`, 'media.kind must be audio or image', ['import']);
      const fn = m['fileName'];
      if (typeof fn !== 'string' || !fn.trim() || fn.length > 255 || fn.includes('/') || fn.includes('\\') || fn.includes(':') || /(^|\/)\.\.?(\/|$)/.test(fn) || /[\u0000-\u001f\u007f]/.test(fn)) {
        add('MEDIA_FILENAME', `${mb}/fileName`, 'fileName must be a plain basename without paths or URLs', ['import']);
      }
      if (typeof m['requiredForPublish'] !== 'boolean') add('MEDIA_REQUIRED', `${mb}/requiredForPublish`, 'requiredForPublish must be boolean', ['import']);
    });
    // Reference resolution + kind match
    for (const ref of mediaRefs) {
      const decl = mediaKeys.get(ref.key);
      if (!decl) add('MEDIA_REF', ref.path, `media reference "${ref.key}" has no declaration`, ['import']);
      else if (decl.kind !== ref.kind) add('MEDIA_REF', ref.path, `media reference "${ref.key}" needs kind ${decl.kind}`, ['import']);
    }
    // Unused declarations rejected
    const used = new Set(mediaRefs.map((r) => r.key));
    for (const [key, decl] of mediaKeys) {
      if (!used.has(key)) add('MEDIA_UNUSED', decl.path, `media declaration "${key}" is never referenced`, ['import']);
    }
    // Missing/unbound mandatory media blocks publish only
    for (const [key, decl] of mediaKeys) {
      if (decl.requiredForPublish && !bindings[key]) {
        add('MISSING_MEDIA', decl.path, `media "${key}" requires an uploaded binding before publish`, ['publish']);
      }
    }
  }

  // Review issues
  const reviewIssues = pkg['reviewIssues'];
  if (!Array.isArray(reviewIssues)) {
    add('ISSUES', '/reviewIssues', 'reviewIssues must be an array', ['import']);
  } else {
    if (reviewIssues.length > 200) add('COUNT_LIMIT', '/reviewIssues', 'reviewIssues exceed 200', ['import']);
    const issueKeys = new Set<string>();
    reviewIssues.forEach((r: unknown, ri: number) => {
      const rb = `/reviewIssues/${ri}`;
      if (!isRecord(r)) { add('ISSUE', rb, 'issue must be an object', ['import']); return; }
      for (const k of Object.keys(r)) {
        if (!['key','code','path','message','sourceRef'].includes(k)) add('UNKNOWN_FIELD', `${rb}/${k}`, `Unknown issue field "${k}"`, ['import']);
      }
      const ik = r['key'];
      if (typeof ik !== 'string' || !KEY_RE.test(ik)) add('KEY_FORMAT', `${rb}/key`, 'issue.key format invalid', ['import']);
      else if (issueKeys.has(ik)) add('KEY_DUPLICATE', `${rb}/key`, `duplicate issue key "${ik}"`, ['import']);
      else issueKeys.add(ik);
      if (typeof r['code'] !== 'string' || !ISSUE_CODES.includes(r['code'] as string)) add('ENUM_INVALID', `${rb}/code`, 'issue.code is invalid', ['import']);
      const ipath = r['path'];
      if (typeof ipath !== 'string' || !resolvePointer(pkg, ipath as string)) {
        add('REVIEW_PATH', `${rb}/path`, `issue path "${String(ipath)}" does not resolve in the package`, ['import']);
      }
      if (typeof r['message'] !== 'string' || !r['message'].trim()) add('ISSUE_MESSAGE', `${rb}/message`, 'issue.message must be non-blank', ['import']);
      if (typeof r['sourceRef'] !== 'string' || !r['sourceRef'].trim()) add('ISSUE_SOURCEREF', `${rb}/sourceRef`, 'issue.sourceRef must be non-blank', ['import']);
    });
    // Any unresolved source issue blocks publish until a teacher resolves it.
    if (reviewIssues.length > 0) {
      add('REVIEW_OPEN', '/reviewIssues', `${reviewIssues.length} review issue(s) must be resolved before publish`, ['publish']);
    }
  }

  // Profile blueprint affects publish readiness, not import.
  if (isRecord(exam) && typeof profile === 'string' && (profile === 'practice' || profile === 'full_mock')) {
    if (profile === 'practice') {
      if (skillSet.size < 1) add('PROFILE_BLUEPRINT', '/profile', 'practice packages need at least one skill', ['publish']);
    } else {
      const examType = (exam as Record<string, unknown>)['type'];
      if (examType === 'multilevel') {
        const sections = Array.isArray(exam['sections']) ? exam['sections'].filter(isRecord).filter((s) => ['listening','reading','writing','speaking'].includes(String(s.skill))).map((s) => ({
          skill: s.skill as MockSkill,
          groups: (Array.isArray(s.groups) ? s.groups.filter(isRecord) : []).map((g, index) => ({
            sortOrder: index, partNumber: typeof g.partNumber === 'number' ? g.partNumber : null,
            passageText: typeof g.passageText === 'string' ? g.passageText : null,
            audioKey: typeof g.audioRef === 'string' ? g.audioRef : null, imageKey: typeof g.imageRef === 'string' ? g.imageRef : null,
            questions: (Array.isArray(g.questions) ? g.questions.filter(isRecord) : []).map((q) => ({ type: String(q.type), points: Number(q.points), options: q.options, wordLimit: typeof q.wordLimit === 'number' ? q.wordLimit : null })),
          })),
        })) : [];
        multilevelBlueprintIssues(sections, true).forEach((issue) => add('PROFILE_BLUEPRINT', '/exam/sections', issue, ['publish']));
      } else {
        // IELTS blueprint: listening 4 parts / 40 Q, reading 3 groups / 40 Q, writing task1+task2.
        const sections = ((exam as Record<string, unknown>)['sections'] as unknown[]) ?? [];
        const bySkill = new Map<string, { groups: number; questions: number; types: Set<string>; parts: Set<number> }>();
        for (const s of sections) {
          if (!isRecord(s)) continue;
          const sk = String((s as Record<string, unknown>)['skill']);
          const gs = ((s as Record<string, unknown>)['groups'] as unknown[]) ?? [];
          const entry = bySkill.get(sk) ?? { groups: 0, questions: 0, types: new Set<string>(), parts: new Set<number>() };
          entry.groups += gs.length;
          for (const g of gs) {
            if (!isRecord(g)) continue;
            const qs = ((g as Record<string, unknown>)['questions'] as unknown[]) ?? [];
            entry.questions += (qs as unknown[]).length;
            for (const q of qs) {
              if (isRecord(q)) entry.types.add(String((q as Record<string, unknown>)['type']));
            }
            const pn = (g as Record<string, unknown>)['partNumber'];
            if (typeof pn === 'number') entry.parts.add(pn);
          }
          bySkill.set(sk, entry);
        }
        const listening = bySkill.get('listening');
        const reading = bySkill.get('reading');
        const writing = bySkill.get('writing');
        if (!listening || listening.groups < 4 || listening.questions !== 40) {
          add('PROFILE_BLUEPRINT', '/exam/sections', `full_mock listening needs 4 parts / 40 questions (found ${listening?.groups ?? 0} groups, ${listening?.questions ?? 0} questions)`, ['publish']);
        }
        if (!reading || reading.groups < 3 || reading.questions !== 40) {
          add('PROFILE_BLUEPRINT', '/exam/sections', `full_mock reading needs 3 groups / 40 questions (found ${reading?.groups ?? 0} groups, ${reading?.questions ?? 0} questions)`, ['publish']);
        }
        if (!writing || !writing.types.has('essay_task1') || !writing.types.has('essay_task2')) {
          add('PROFILE_BLUEPRINT', '/exam/sections', 'full_mock writing needs task 1 and task 2', ['publish']);
        }
      }
    }
  }

  return finish(pkg, issues, sanitizerNotes, counts);
}

function finish(pkg: unknown, issues: ImportIssue[], sanitizerNotes: Array<{ path: string; changed: boolean }>, counts: ImportCounts): ImportReport {
  const ordered = [...issues].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : 1));
  const truncated = issues.length >= MAX_ISSUES;
  const list = ordered.slice(0, MAX_ISSUES);
  const canImport = !list.some((i) => i.blocks.includes('import'));
  const canPublish = canImport && !list.some((i) => i.blocks.includes('publish'));
  return {
    checksum: canonicalChecksum(pkg),
    issues: list,
    counts,
    canImport,
    canPublish,
    sanitizerNotes,
    truncated,
    totalIssues: issues.length,
  };
}
