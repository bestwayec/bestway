import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateImportPackage, canonicalChecksum, detectDuplicateKeys } from './mock-import-validate';

function sample() {
  const p = path.join(__dirname, '..', '..', '..', 'docs', 'ai-test-import', 'example-reading.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('mock JSON import contract (RED)', () => {
  it('accepts the documented reading example as importable', () => {
    const report = validateImportPackage(sample(), { mediaBindings: {} });
    expect(report.canImport).toBe(true);
    expect(report.issues.filter((i) => i.blocks.includes('import'))).toHaveLength(0);
    expect(report.counts.questions).toBe(6);
  });

  it('treats single-reading practice as fully publishable (no phantom skills)', () => {
    const report = validateImportPackage(sample(), { mediaBindings: {} });
    expect(report.canPublish).toBe(true);
    expect(report.counts.skills).toBe(1);
  });

  it('rejects duplicate JSON object keys', () => {
    const raw = '{"schemaVersion":"1.0","schemaVersion":"1.0"}';
    expect(detectDuplicateKeys(raw).length).toBeGreaterThan(0);
    const report = validateImportPackage(JSON.parse('{"schemaVersion":"1.0"}'), { rawText: raw });
    expect(report.canImport).toBe(false);
  });

  it('rejects unknown fields and bad enums', () => {
    const pkg = { ...sample(), cookie: 'x' };
    expect(validateImportPackage(pkg).canImport).toBe(false);
    const bad = sample();
    bad.exam.sections[0].groups[1].questions[0].correctAnswers = ['Upstairs'];
    expect(validateImportPackage(bad).canImport).toBe(false);
  });

  it('enforces global numbering and gap mapping', () => {
    const pkg = sample();
    pkg.exam.sections[0].groups[1].questions[0].number = 1;
    const report = validateImportPackage(pkg);
    expect(report.canImport).toBe(false);
    expect(report.issues.some((i) => i.code === 'NUMBER_COLLISION')).toBe(true);
  });

  it('blocks import on missing auto keys and gap mismatch', () => {
    const pkg = sample();
    pkg.exam.sections[0].groups[0].questions[0].correctAnswers = [];
    expect(validateImportPackage(pkg).canImport).toBe(false);
    const pkg2 = sample();
    pkg2.exam.sections[0].groups[0].contentHtml = '<p>No gaps</p>';
    const r2 = validateImportPackage(pkg2);
    expect(r2.canImport).toBe(false);
    expect(r2.issues.some((i) => i.code === 'GAP_QUESTION_MISMATCH')).toBe(true);
  });

  it('rejects every invalid mutation from docs/ai-test-import/validate-artifacts.cjs', () => {
    const mutations: Array<[string, (p: Record<string, any>) => void]> = [
      ['cookie injection', (p) => { p['cookie'] = 'not-allowed'; }],
      ['wrong number type', (p) => { p['exam']['sections'][0]['groups'][0]['questions'][0]['number'] = '1'; }],
      ['MCQ option text instead of letter', (p) => { p['exam']['sections'][0]['groups'][1]['questions'][0]['correctAnswers'] = ['Upstairs']; }],
      ['combined multi-select letters', (p) => { p['exam']['sections'][0]['groups'][1]['questions'][3]['correctAnswers'] = ['A,C']; }],
      ['missing automatic key', (p) => { p['exam']['sections'][0]['groups'][0]['questions'][0]['correctAnswers'] = []; }],
      ['unknown version', (p) => { p['schemaVersion'] = '2.0'; }],
      ['publish injection', (p) => { p['exam']['isPublished'] = true; }],
      ['invalid TFNG shorthand', (p) => { p['exam']['sections'][0]['groups'][1]['questions'][1]['correctAnswers'] = ['F']; }],
      ['remote media path', (p) => { p['media'] = [{ key: 'audio', kind: 'audio', fileName: 'https://example.invalid/a.mp3', requiredForPublish: true }]; }],
    ];
    for (const [name, mutate] of mutations) {
      const copy = sample();
      mutate(copy);
      expect(validateImportPackage(copy).canImport, name).toBe(false);
    }
  });

  it('neutralizes XSS payloads through the shared sanitizer', () => {
    const pkg = sample();
    pkg.exam.sections[0].groups[0].contentHtml =
      '<p>Hi<script>alert(1)</script><span data-gap="1"></span><span data-gap="2"></span><img src="https://evil.test/x.png" onerror="steal()"></p>';
    const report = validateImportPackage(pkg);
    expect(report.sanitizerNotes.some((n) => n.changed)).toBe(true);
    expect(report.canImport).toBe(true); // gaps intact after sanitizing
    const hostile = sample();
    hostile.exam.sections[0].groups[0].contentHtml = '<script>alert(1)</script>';
    expect(validateImportPackage(hostile).canImport).toBe(false);
  });

  it('keeps checksums stable regardless of key order', () => {
    const a = sample();
    const b = JSON.parse(JSON.stringify(a));
    const reportA = validateImportPackage(a);
    const reportB = validateImportPackage(b);
    expect(reportA.checksum).toBe(reportB.checksum);
    expect(canonicalChecksum({ b: 1, a: 2 })).toBe(canonicalChecksum({ a: 2, b: 1 }));
  });

  it('grading regression: unrelated response must not pass via acceptedVariants', async () => {
    const { isAnswerCorrect } = await import('./mock-answer');
    // Key "colour" with evidenced variant "color": an unrelated response
    // "flavour" must not pass merely because the variant exists on both sides.
    const unrelated = isAnswerCorrect('short_answer', 'flavour', ['colour'], {
      acceptedVariants: ['color'],
    });
    expect(unrelated).toBe(false);
    // Sanity: the evidenced variant itself and the key still pass.
    expect(isAnswerCorrect('short_answer', 'color', ['colour'], { acceptedVariants: ['color'] })).toBe(true);
    expect(isAnswerCorrect('short_answer', 'colour', ['colour'], { acceptedVariants: ['color'] })).toBe(true);
  });
});

describe('full-mock import publication blueprint', () => {
  function completePackage(type = 'ielts_academic') {
    const pkg = sample();
    pkg.profile = 'full_mock';
    pkg.exam.type = type;
    let number = 0;
    const questions = (count: number, manualType?: string) => Array.from({ length: count }, () => ({
      key: `question-${++number}`, number, type: manualType ?? 'short_answer', prompt: 'Original synthetic question.',
      options: [], correctAnswers: manualType ? [] : ['word'], acceptedVariants: [], points: manualType ? 9 : 1,
      sourceRef: 'Original synthetic fixture',
    }));
    const group = (key: string, qs: ReturnType<typeof questions>) => ({
      key, title: key, instructions: 'Answer each question.', passageText: 'Original source text.',
      contentHtml: '', contentLayout: 'document', audioScript: '', questions: qs,
    });
    pkg.exam.sections = [
      { key: 'listening', skill: 'listening', title: 'Listening', instructions: '', groups: [1, 2, 3, 4].map((part) => ({
        ...group(`listening-${part}`, questions(10)), partNumber: part, audioRef: `audio-${part}`,
      })) },
      { key: 'reading', skill: 'reading', title: 'Reading', instructions: '', groups: [14, 13, 13].map((count, index) => group(`reading-${index}`, questions(count))) },
      { key: 'writing', skill: 'writing', title: 'Writing', instructions: '', groups: [group('task1', questions(1, 'essay_task1')), group('task2', questions(1, 'essay_task2'))] },
    ];
    pkg.media = [1, 2, 3, 4].map((part) => ({ key: `audio-${part}`, kind: 'audio', fileName: `part-${part}.mp3`, requiredForPublish: true }));
    return pkg;
  }
  const mediaBindings = Object.fromEntries([1, 2, 3, 4].map((part) => [`audio-${part}`, `upload-${part}`]));

  it.each(['ielts_academic', 'ielts_general'])('accepts the exact %s blueprint with bound audio', (type) => {
    const report = validateImportPackage(completePackage(type), { mediaBindings });
    expect(report.issues).toEqual([]);
    expect(report.canPublish).toBe(true);
  });

  it('rejects extra listening or reading blocks even when the forty-question total stays unchanged', () => {
    for (const sectionIndex of [0, 1]) {
      const pkg = completePackage();
      const section = pkg.exam.sections[sectionIndex];
      const extra = structuredClone(section.groups[0]);
      extra.key = 'extra-group';
      extra.questions = [section.groups[0].questions.pop()];
      section.groups.push(extra);
      const report = validateImportPackage(pkg, { mediaBindings });
      expect(report.canImport).toBe(true);
      expect(report.canPublish).toBe(false);
      expect(report.issues.some((issue) => issue.code === 'PROFILE_BLUEPRINT')).toBe(true);
    }
  });

  it('rejects duplicate listening part identifiers and repeated writing tasks', () => {
    const duplicatePart = completePackage();
    duplicatePart.exam.sections[0].groups[3].partNumber = 3;
    expect(validateImportPackage(duplicatePart, { mediaBindings }).canPublish).toBe(false);
    const extraWriting = completePackage();
    const extra = structuredClone(extraWriting.exam.sections[2].groups[0]);
    extra.key = 'extra-task';
    extra.questions[0].key = 'question-extra';
    extra.questions[0].number = 83;
    extraWriting.exam.sections[2].groups.push(extra);
    const report = validateImportPackage(extraWriting, { mediaBindings });
    expect(report.canImport).toBe(true);
    expect(report.canPublish).toBe(false);
  });

  it('rejects practice levels on IELTS or full-mock packages', () => {
    const ielts = sample();
    ielts.exam.practiceLevel = 'A1';
    expect(validateImportPackage(ielts).issues.some((issue) => issue.code === 'PRACTICE_LEVEL')).toBe(true);
    const full = completePackage('multilevel');
    full.exam.practiceLevel = 'B2';
    expect(validateImportPackage(full).issues.some((issue) => issue.code === 'PRACTICE_LEVEL')).toBe(true);
  });
});
