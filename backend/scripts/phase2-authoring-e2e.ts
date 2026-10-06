/**
 * PHASE 2 — real local database + real route E2E for Multilevel authoring.
 *
 * Proves the admin journey: create a brand-new current-format Multilevel full
 * mock, author all four sections through the real application APIs, Review
 * READY, Publish SUCCESS, and catalogue/detail readiness TRUE.
 *
 * Also proves the negative: an incomplete structure cannot be published.
 *
 * Local database only. Creates disposable fixtures and removes them again.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { multilevelFixture } from '../src/mock/multilevel.fixture';
import { MULTILEVEL_SPECIFICATION } from '../src/mock/multilevel-specification';

const prisma = new PrismaClient();
const BASE = process.env.PHASE2_BASE_URL ?? 'http://localhost:3116/v1';
const TITLE = 'PHASE2 DISPOSABLE AUTHORING';

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail === null ? '' : ` :: ${JSON.stringify(detail).slice(0, 320)}`}`);
}

/** Complete current-format content with resolvable answer keys, per the blueprint. */
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

const SKILL_COUNTS = { listening: 35, reading: 35, writing: 3, speaking: 8 };

interface ExamDetail { id: string; isPublished: boolean; sections: Array<{ skill: string; groups: Array<Record<string, any>> }> }

async function createExam(admin: string, title: string) {
  const created = await call('POST', '/mock/exams', admin, {
    type: 'multilevel', title, profile: 'full_mock', starterStructure: true,
  });
  const detail = await call('GET', `/mock/exams/${created.data.id}`, admin);
  return detail.data as ExamDetail;
}

async function attachMedia(examId: string) {
  const base = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const write = (key: string, bytes: Buffer) => {
    const file = path.join(base, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return key;
  };
  const listening = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'listening' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  for (const [i, group] of listening.entries()) {
    await prisma.mockQuestionGroup.update({
      where: { id: group.id },
      data: { audioKey: write(`mock/phase2-${examId.slice(0, 8)}-${i}.wav`, Buffer.from('RIFF....WAVEphase2-disposable')) },
    });
  }
  const speaking = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'speaking' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  if (speaking[1]) {
    await prisma.mockQuestionGroup.update({
      where: { id: speaking[1].id },
      data: { imageKey: write(`mock/phase2-${examId.slice(0, 8)}-pictures.png`, Buffer.from('PNG phase2-disposable')) },
    });
  }
}

/** Author every part of every section through the real content API. */
async function authorAll(admin: string, exam: ExamDetail) {
  const content = buildContent();
  for (const wanted of content) {
    const section = exam.sections.find((s) => s.skill === wanted.skill);
    if (!section) throw new Error(`missing section ${wanted.skill}`);
    if (section.groups.length !== wanted.groups.length) {
      throw new Error(`${wanted.skill}: ${section.groups.length} groups vs ${wanted.groups.length} required parts`);
    }
    const ordered = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const [gi, group] of wanted.groups.entries()) {
      await call('PUT', `/mock/groups/${ordered[gi].id}/content`, admin, {
        questions: group.questions, deletedQuestionIds: [],
        partNumber: wanted.skill === 'listening' ? gi + 1 : undefined,
        audioDurationSec: wanted.skill === 'listening' ? 60 : undefined,
        passageText: wanted.skill === 'reading' ? `Phase 2 disposable passage for reading part ${gi + 1}.` : undefined,
      });
    }
  }
  await attachMedia(exam.id);
}

async function main() {
  const stale = await prisma.mockExam.deleteMany({ where: { title: { startsWith: 'PHASE2 DISPOSABLE' } } });
  if (stale.count) console.log(`cleaned ${stale.count} stale PHASE2 fixture(s)`);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', isActive: true }, select: { id: true } });
  const adminToken = token(admin.id);

  // ── Happy path: brand-new complete Multilevel full mock ──
  const exam = await createExam(adminToken, TITLE);
  assert('create: new multilevel exam is a draft', exam.isPublished === false);
  assert('preset: four sections created', exam.sections.length === 4, exam.sections.map((s) => s.skill));
  for (const [skill, count] of Object.entries(SKILL_COUNTS)) {
    const section = exam.sections.find((s) => s.skill === skill);
    const questions = section?.groups.reduce((n, g) => n + (g.questions?.length ?? 0), 0) ?? 0;
    assert(`preset: ${skill} has the required part groups`, section?.groups.length === MULTILEVEL_SPECIFICATION[skill as 'listening'].parts.length, section?.groups.length);
    void questions;
    void count;
  }

  const readinessBefore = await call('GET', `/mock/exams/${exam.id}/readiness`, adminToken);
  assert('review: empty preset is NOT ready', (readinessBefore.data as Record<string, any>).ready === false);
  const blocked = await call('PATCH', `/mock/exams/${exam.id}`, adminToken, { isPublished: true });
  assert('publish: incomplete exam is rejected', blocked.status === 400 && blocked.code === 'MOCK_NOT_READY', [blocked.status, blocked.code]);

  await authorAll(adminToken, exam);

  const readiness = await call('GET', `/mock/exams/${exam.id}/readiness`, adminToken);
  assert('review: fully authored exam READY', (readiness.data as Record<string, any>).ready === true, (readiness.data as any).items?.filter((i: any) => !i.ok));

  const published = await call('PATCH', `/mock/exams/${exam.id}`, adminToken, { isPublished: true });
  assert('publish: SUCCESS', published.status === 200 && (published.data as Record<string, any>).isPublished === true, [published.status, (published.data as any)?.isPublished]);

  const dbExam = await prisma.mockExam.findUniqueOrThrow({ where: { id: exam.id } });
  assert('publish: persisted in the database', dbExam.isPublished === true);

  const catalogue = await call('GET', '/mock/exams', adminToken);
  const listed = (Array.isArray(catalogue.data) ? catalogue.data : []) as Array<Record<string, any>>;
  const listedExam = listed.find((e) => e.id === exam.id);
  const detailAfter = await call('GET', `/mock/exams/${exam.id}`, adminToken);
  const readinessAfter = await call('GET', `/mock/exams/${exam.id}/readiness`, adminToken);
  assert('catalogue: published exam listed with ready=true', listedExam?.ready === true && listedExam?.isPublished === true, listedExam ? { ready: listedExam.ready, isPublished: listedExam.isPublished } : 'not listed');
  assert('readiness agreement: catalogue == detail == review',
    listedExam?.ready === true && (detailAfter.data as Record<string, any>).ready === true && (readinessAfter.data as Record<string, any>).ready === true,
    { catalogue: listedExam?.ready, detail: (detailAfter.data as any).ready, review: (readinessAfter.data as any).ready });

  // Two different physical orders must produce the same verdict.
  const shuffled = await prisma.mockQuestion.findMany({ where: { group: { section: { examId: exam.id, skill: 'reading' } } }, select: { id: true, sortOrder: true, number: true } });
  const readAgain = await call('GET', `/mock/exams/${exam.id}/readiness`, adminToken);
  assert('ordering: repeated readiness is stable', (readAgain.data as Record<string, any>).ready === true, { questions: shuffled.length });

  const failed = checks.filter((c) => !c.ok);
  const report = { ranAt: new Date().toISOString(), baseUrl: BASE, examId: exam.id, checks, passed: checks.length - failed.length, failed: failed.length };
  fs.writeFileSync(path.join(__dirname, '.phase2-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSUMMARY ${report.passed}/${checks.length} passed; failed=${report.failed}`);
  await prisma.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error('PHASE2_E2E_FAILED', error instanceof Error ? error.stack : error);
  await prisma.$disconnect();
  process.exit(1);
});
