/**
 * PHASE 1.5 — disposable local fixtures.
 *
 * Exam + authored content are created through the REAL HTTP application APIs
 * (POST /mock/exams, PUT /mock/groups/:id/content). Prisma is used only for the
 * three things the current APIs deliberately cannot express:
 *   1. historical/legacy metadata (specificationVersion + stale maxScore/stimulusRef)
 *   2. media keys (uploading real multipart audio/image is fixture plumbing)
 *   3. Fixture B student history (attempt / answer / assessment result)
 *
 * Nothing here touches production and no existing local row is modified.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { multilevelFixture } from '../src/mock/multilevel.fixture';
import { MULTILEVEL_SPECIFICATION } from '../src/mock/multilevel-specification';

const prisma = new PrismaClient();
const BASE = process.env.PHASE15_BASE_URL ?? 'http://localhost:3115/v1';
const LEGACY_VERSION = 'UZBMB_MULTILEVEL_EN_PHASE15_LEGACY';
const OUT_FILE = path.join(__dirname, '.phase15-fixtures.json');

function token(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET missing/short');
  return jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: '30m' });
}

async function api<T>(method: string, route: string, bearer: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(parsed)?.slice(0, 400)}`);
  // The API envelope is { success, data }.
  return ((parsed as { data?: unknown } | null)?.data ?? parsed) as T;
}

/** One copy of the full Multilevel blueprint with resolvable answer keys. */
function buildContent() {
  const fixture = multilevelFixture();
  return fixture.map((section) => {
    let number = 0;
    const parts = MULTILEVEL_SPECIFICATION[section.skill].parts;
    return {
      skill: section.skill,
      groups: section.groups.map((group, gi) => ({
        spec: parts[gi],
        questions: group.questions.map((question) => {
          number += 1;
          const type = String(question.type);
          const options = Array.isArray(question.options) ? (question.options as string[]) : [];
          const manual = ['essay_task1', 'essay_task2', 'speaking_task'].includes(type);
          const decision = type === 'true_false_notgiven';
          const correctAnswers = manual ? [] : decision ? ['TRUE'] : options.length ? [options[0]] : ['answer'];
          return {
            number,
            type,
            prompt: question.prompt,
            options,
            correctAnswers,
            acceptedVariants: [],
            wordLimit: manual ? null : 1,
            points: 1,
            answerRule: null,
          };
        }),
      })),
    };
  });
}

interface ExamDetail {
  id: string; title: string; sections: Array<{ skill: string; groups: Array<{ id: string }> }>;
}

async function createBase(admin: string, title: string): Promise<ExamDetail> {
  const created = await api<{ id: string }>('POST', '/mock/exams', admin, {
    type: 'multilevel', title, profile: 'full_mock', starterStructure: true,
  });
  const detail = await api<ExamDetail>('GET', `/mock/exams/${created.id}`, admin);
  const content = buildContent();
  for (const wanted of content) {
    const section = detail.sections.find((s) => s.skill === wanted.skill);
    if (!section) throw new Error(`missing section ${wanted.skill}`);
    if (section.groups.length !== wanted.groups.length) {
      throw new Error(`${wanted.skill}: ${section.groups.length} groups vs ${wanted.groups.length} spec parts`);
    }
    for (const [gi, group] of wanted.groups.entries()) {
      const target = section.groups[gi];
      const body: Record<string, unknown> = {
        questions: group.questions, deletedQuestionIds: [],
        partNumber: wanted.skill === 'listening' ? gi + 1 : undefined,
        audioDurationSec: wanted.skill === 'listening' ? 60 : undefined,
        passageText: wanted.skill === 'reading' ? `Phase 1.5 disposable passage for reading part ${gi + 1}.` : undefined,
      };
      await api('PUT', `/mock/groups/${target.id}/content`, admin, body);
    }
  }
  return detail;
}

/** Historical state: stale metadata + a legacy specification stamp. */
async function makeLegacy(examId: string) {
  const groups = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId } },
    select: { id: true, section: { select: { skill: true } }, sortOrder: true },
  });
  for (const group of groups) {
    const spec = MULTILEVEL_SPECIFICATION[group.section.skill].parts[group.sortOrder];
    if (group.section.skill === 'writing') {
      await prisma.mockQuestionGroup.update({
        where: { id: group.id },
        data: group.sortOrder === 0
          ? { maxScore: 1, stimulusRef: 'phase15-legacy-a' }
          : group.sortOrder === 1
            ? { maxScore: 2, stimulusRef: 'phase15-legacy-b' }
            : { maxScore: spec.rawMax! },
      });
    } else if (group.section.skill === 'speaking') {
      await prisma.mockQuestionGroup.update({ where: { id: group.id }, data: { maxScore: 1 } });
    }
  }
  await prisma.mockExam.update({ where: { id: examId }, data: { specificationVersion: LEGACY_VERSION } });
}

/** Media keys + real files so readiness' storage check passes locally. */
async function attachMedia(examId: string) {
  const base = path.resolve(process.env.STORAGE_DIR ?? './storage');
  fs.mkdirSync(path.join(base, 'mock'), { recursive: true });
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
      data: { audioKey: write(`mock/phase15-${examId.slice(0, 8)}-${i}.wav`, Buffer.from('RIFF....WAVEphase15-disposable')) },
    });
  }
  const speaking = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'speaking' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  const part12 = speaking[1];
  if (part12) {
    await prisma.mockQuestionGroup.update({
      where: { id: part12.id },
      data: { imageKey: write(`mock/phase15-${examId.slice(0, 8)}-pictures.png`, Buffer.from('PNG phase15-disposable')) },
    });
  }
  return { listeningKeys: listening.length, imageKey: part12 ? 1 : 0 };
}

async function main() {
  // Idempotent: drop only our own previous PHASE15 fixtures (cascades children).
  const stale = await prisma.mockExam.deleteMany({ where: { title: { startsWith: 'PHASE15 DISPOSABLE' } } });
  if (stale.count) console.log(`cleaned ${stale.count} stale PHASE15 fixture(s)`);

  const [admin, superAdmin, teacher] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: 'admin', isActive: true }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ where: { role: 'super_admin', isActive: true }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ where: { role: 'teacher', isActive: true }, select: { id: true } }),
  ]);
  const student = await prisma.user.findFirstOrThrow({
    where: { role: 'student', isActive: true, studentProfile: { isNot: null } },
    select: { id: true },
  });
  const adminToken = token(admin.id);

  // ── Fixture A: legacy, ZERO history, published (repairable in place) ──
  const draftA = await createBase(adminToken, 'PHASE15 DISPOSABLE LEGACY A');
  await makeLegacy(draftA.id);
  await attachMedia(draftA.id);
  await prisma.mockExam.update({ where: { id: draftA.id }, data: { isPublished: true, createdById: admin.id } });

  // ── Fixture B: legacy WITH student history (repair must be refused) ──
  const draftB = await createBase(adminToken, 'PHASE15 DISPOSABLE LEGACY B');
  await makeLegacy(draftB.id);
  await attachMedia(draftB.id);
  await prisma.mockExam.update({ where: { id: draftB.id }, data: { isPublished: true, createdById: admin.id } });

  const firstQuestion = await prisma.mockQuestion.findFirstOrThrow({
    where: { group: { section: { examId: draftB.id, skill: 'listening' } } }, orderBy: { number: 'asc' }, select: { id: true },
  });
  const attempt = await prisma.mockAttempt.create({
    data: {
      examId: draftB.id, studentId: student.id, status: 'completed',
      mode: 'timed', submittedAt: new Date(), finishedAt: new Date(),
      specificationVersion: LEGACY_VERSION, flowMode: 'full_test', currentSkill: 'listening',
      answers: { create: [{ questionId: firstQuestion.id, response: 'answer' }] },
    },
  });
  await prisma.assessmentJob.create({
    data: {
      attemptId: attempt.id, studentId: student.id, program: 'MULTILEVEL', skill: 'listening',
      inputHash: `phase15-${attempt.id}`, inputSnapshot: { phase15: true },
      rubricVersion: 'phase15', promptVersion: 'phase15', policyMode: 'MANUAL_ONLY',
      status: 'SUCCEEDED', finalScore: 1, finalResult: { phase15: true },
    },
  });

  const out = {
    createdAt: new Date().toISOString(),
    legacyVersion: LEGACY_VERSION,
    baseUrl: BASE,
    users: { admin: admin.id, superAdmin: superAdmin.id, teacher: teacher.id, student: student.id },
    fixtureA: { id: draftA.id, title: 'PHASE15 DISPOSABLE LEGACY A' },
    fixtureB: { id: draftB.id, title: 'PHASE15 DISPOSABLE LEGACY B', attemptId: attempt.id },
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('FIXTURES_OK');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FIXTURES_FAILED', error instanceof Error ? error.stack : error);
  await prisma.$disconnect();
  process.exit(1);
});
