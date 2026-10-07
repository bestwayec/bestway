/**
 * PHASE 2.1 — real local database + real route check for the CURRENT Multilevel
 * revision.
 *
 * Proves that a brand-new exam is stamped with the current revision and the
 * current speaking profile, that Speaking Part 1.2 issues NO preparation with
 * 45/30/30 responses, and that Review / Publish / Catalogue / Detail / readiness
 * all agree. No student attempt is created. Disposable fixtures only.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { multilevelFixture } from '../src/mock/multilevel.fixture';
import {
  MULTILEVEL_CURRENT_VERSION,
  MULTILEVEL_SPECIFICATION,
  NO_PREP_SECONDS,
} from '../src/mock/multilevel-specification';
import { BESTWAY_MULTILEVEL_CURRENT_SPEAKING_PROFILE } from '../src/mock/multilevel-speaking-profile';

const prisma = new PrismaClient();
const BASE = process.env.PHASE21_BASE_URL ?? 'http://localhost:3117/v1';
const TITLE = 'PHASE21 DISPOSABLE VERSION CHECK';

function token(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET missing/short');
  return jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: '30m' });
}

async function call(method: string, route: string, bearer: string, body?: unknown) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const envelope = parsed as { data?: unknown; error?: { code?: string } } | null;
  return { status: res.status, data: envelope?.data ?? parsed, code: envelope?.error?.code ?? null };
}

const checks: Array<{ check: string; ok: boolean; detail: unknown }> = [];
function assert(check: string, ok: boolean, detail: unknown = null) {
  checks.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail === null ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`);
}

function buildContent() {
  return multilevelFixture().map((section) => {
    let number = 0;
    const parts = MULTILEVEL_SPECIFICATION[section.skill].parts;
    return {
      skill: section.skill,
      groups: section.groups.map((group, gi) => ({
        part: parts[gi].key,
        questions: group.questions.map((question) => {
          number += 1;
          const type = String(question.type);
          const options = Array.isArray(question.options) ? (question.options as string[]) : [];
          const manual = ['essay_task1', 'essay_task2', 'speaking_task'].includes(type);
          return {
            number, type, prompt: question.prompt, options,
            correctAnswers: manual ? [] : type === 'true_false_notgiven' ? ['TRUE'] : options.length ? [options[0]] : ['answer'],
            acceptedVariants: [], wordLimit: manual ? null : 1, points: 1, answerRule: null,
          };
        }),
      })),
    };
  });
}

interface ExamDetail {
  id: string;
  isPublished: boolean;
  specificationVersion?: string;
  specification?: { speaking: { parts: Array<{ key: string; prepSeconds: number[]; responseSeconds: number[] }> } };
  sections: Array<{ skill: string; groups: Array<Record<string, any>> }>;
}

const writtenFiles: string[] = [];

async function attachMedia(examId: string) {
  const base = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const write = (key: string, bytes: Buffer) => {
    const file = path.join(base, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    writtenFiles.push(file);
    return key;
  };
  const listening = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'listening' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  for (const [i, group] of listening.entries()) {
    await prisma.mockQuestionGroup.update({
      where: { id: group.id },
      data: { audioKey: write(`mock/phase21-${examId.slice(0, 8)}-${i}.wav`, Buffer.from('RIFF....WAVEphase21-disposable')) },
    });
  }
  const speaking = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'speaking' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  if (speaking[1]) {
    await prisma.mockQuestionGroup.update({
      where: { id: speaking[1].id },
      data: { imageKey: write(`mock/phase21-${examId.slice(0, 8)}-pictures.png`, Buffer.from('PNG phase21-disposable')) },
    });
  }
}

async function authorAll(admin: string, exam: ExamDetail) {
  for (const wanted of buildContent()) {
    const section = exam.sections.find((s) => s.skill === wanted.skill);
    if (!section) throw new Error(`missing section ${wanted.skill}`);
    const ordered = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const [gi, group] of wanted.groups.entries()) {
      await call('PUT', `/mock/groups/${ordered[gi].id}/content`, admin, {
        questions: group.questions, deletedQuestionIds: [],
        partNumber: wanted.skill === 'listening' ? gi + 1 : undefined,
        audioDurationSec: wanted.skill === 'listening' ? 60 : undefined,
        passageText: wanted.skill === 'reading' ? `Phase 2.1 disposable passage for reading part ${gi + 1}.` : undefined,
      });
    }
  }
  await attachMedia(exam.id);
}

async function cleanup(examId: string | null) {
  if (examId) await prisma.mockExam.deleteMany({ where: { id: examId } });
  for (const file of writtenFiles) fs.rmSync(file, { force: true });
}

async function main() {
  await prisma.mockExam.deleteMany({ where: { title: { startsWith: 'PHASE21 DISPOSABLE' } } });
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', isActive: true }, select: { id: true } });
  const adminToken = token(admin.id);

  const created = await call('POST', '/mock/exams', adminToken, {
    type: 'multilevel', title: TITLE, profile: 'full_mock', starterStructure: true,
  });
  const examId = (created.data as { id: string }).id;
  const detail = await call('GET', `/mock/exams/${examId}`, adminToken);
  const exam = detail.data as ExamDetail;

  // ── Revision stamping ──
  const row = await prisma.mockExam.findUniqueOrThrow({ where: { id: examId } });
  assert('new exam: stamped with the CURRENT specification revision',
    row.specificationVersion === MULTILEVEL_CURRENT_VERSION, row.specificationVersion);
  assert('new exam: stamped with the CURRENT speaking profile',
    row.speakingProfileVersion === BESTWAY_MULTILEVEL_CURRENT_SPEAKING_PROFILE, row.speakingProfileVersion);
  assert('new exam: is a draft', exam.isPublished === false);

  assert('detail: exposes the current revision identifier',
    exam.specificationVersion === MULTILEVEL_CURRENT_VERSION, exam.specificationVersion);
  const part12 = exam.specification?.speaking.parts.find((p) => p.key === '1.2');
  assert('detail: Speaking Part 1.2 official prep is NONE',
    JSON.stringify(part12?.prepSeconds) === JSON.stringify([...NO_PREP_SECONDS]), part12?.prepSeconds);
  assert('detail: Speaking Part 1.2 responses are 45/30/30',
    JSON.stringify(part12?.responseSeconds) === JSON.stringify([45, 30, 30]), part12?.responseSeconds);

  // ── Negative gates before authoring ──
  const readinessBefore = await call('GET', `/mock/exams/${examId}/readiness`, adminToken);
  assert('review: empty preset is NOT ready', (readinessBefore.data as Record<string, any>).ready === false);
  const blocked = await call('PATCH', `/mock/exams/${examId}`, adminToken, { isPublished: true });
  assert('publish: incomplete exam is rejected', blocked.status === 400 && blocked.code === 'MOCK_NOT_READY', [blocked.status, blocked.code]);

  // ── Author + publish ──
  await authorAll(adminToken, exam);

  const readiness = await call('GET', `/mock/exams/${examId}/readiness`, adminToken);
  assert('review: fully authored exam READY', (readiness.data as Record<string, any>).ready === true);

  const published = await call('PATCH', `/mock/exams/${examId}`, adminToken, { isPublished: true });
  assert('publish: SUCCESS', published.status === 200 && (published.data as Record<string, any>).isPublished === true);

  const catalogue = await call('GET', '/mock/exams', adminToken);
  const listed = (Array.isArray(catalogue.data) ? catalogue.data : []).find((e: Record<string, any>) => e.id === examId);
  const detailAfter = await call('GET', `/mock/exams/${examId}`, adminToken);
  const readinessAfter = await call('GET', `/mock/exams/${examId}/readiness`, adminToken);
  assert('catalogue == detail == review readiness agreement',
    listed?.ready === true && (detailAfter.data as Record<string, any>).ready === true && (readinessAfter.data as Record<string, any>).ready === true,
    { catalogue: listed?.ready, detail: (detailAfter.data as any).ready, review: (readinessAfter.data as any).ready });

  // ── Current-revision guidance actually served to a client ──
  const authorDetail = detailAfter.data as ExamDetail;
  const speaking = authorDetail.sections.find((s) => s.skill === 'speaking');
  const speakingGroups = [...(speaking?.groups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const part12Questions = [...(speakingGroups[1]?.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  assert('detail: Speaking Part 1.2 guidance has prepSeconds 0',
    part12Questions.every((q) => q.guidance?.prepSeconds === 0), part12Questions.map((q) => q.guidance?.prepSeconds));
  assert('detail: Speaking Part 1.2 guidance responses are 45/30/30',
    JSON.stringify(part12Questions.map((q) => q.guidance?.responseSeconds)) === JSON.stringify([45, 30, 30]),
    part12Questions.map((q) => q.guidance?.responseSeconds));
  const part11Questions = [...(speakingGroups[0]?.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  assert('detail: Speaking Part 1.1 guidance has prepSeconds 0',
    part11Questions.every((q) => q.guidance?.prepSeconds === 0), part11Questions.map((q) => q.guidance?.prepSeconds));

  // ── No student attempt was created ──
  const attempts = await prisma.mockAttempt.count({ where: { examId } });
  assert('no student attempt was created', attempts === 0, attempts);

  // ── Cleanup ──
  await cleanup(examId);
  const leftover = await prisma.mockExam.count({ where: { id: examId } });
  assert('cleanup: disposable fixture removed', leftover === 0, leftover);
  const orphans = await prisma.mockQuestion.count({ where: { group: { section: { examId } } } });
  assert('cleanup: no orphan questions', orphans === 0, orphans);

  const failed = checks.filter((c) => !c.ok);
  const report = { ranAt: new Date().toISOString(), baseUrl: BASE, checks, passed: checks.length - failed.length, failed: failed.length };
  fs.writeFileSync(path.join(__dirname, '.phase21-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSUMMARY ${report.passed}/${checks.length} passed; failed=${report.failed}`);
  await prisma.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error('PHASE21_CHECK_FAILED', error instanceof Error ? error.stack : error);
  await prisma.$disconnect();
  process.exit(1);
});
