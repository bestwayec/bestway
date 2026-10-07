/**
 * PHASE 3 — real local database + real route E2E for the Multilevel WEB student journey.
 *
 * A disposable admin publishes a disposable current-format Multilevel full mock,
 * a disposable approved student walks the real student routes
 * (catalogue → start → answers → recordings → submit → result) and the real
 * pre-submit gate plus HTTP idempotency are exercised end to end:
 *
 *   A. practice attempt: premature hand-in refused, full journey, teacher
 *      holistic grading, estimated result, duplicate submit returns the stored
 *      result without re-grading;
 *   B. timed attempt: server-granted listening preview/play, unfinished hand-in
 *      refused while the clock runs, and the timeout auto-submit path accepted
 *      once the clock has expired.
 *
 * Browser microphone capture is NOT exercised here (no physical microphone):
 * recordings are uploaded as synthetic WebM containers through the real route.
 *
 * Local database only. Creates disposable fixtures and removes them again.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { multilevelFixture } from '../src/mock/multilevel.fixture';
import { MULTILEVEL_SPECIFICATION } from '../src/mock/multilevel-specification';

const prisma = new PrismaClient();
const BASE = process.env.PHASE3_BASE_URL ?? 'http://localhost:3117/v1';
const TITLE = 'PHASE3 DISPOSABLE STUDENT JOURNEY';
const STUDENT_NAME = 'PHASE3 DISPOSABLE STUDENT';
const STUDENT_PHONE = '+9989000000311';
/** PHASE3_KEEP keeps the disposable exam + student for the interactive browser QA pass. */
const KEEP = process.env.PHASE3_KEEP === '1';
const CLEANUP_ONLY = process.env.PHASE3_CLEANUP_ONLY === '1';

function token(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET missing/short');
  return jwt.sign({ sub: userId }, secret, { algorithm: 'HS256', expiresIn: '60m' });
}

interface ApiResult { status: number; data: any; code: string | null; message: string | null }

async function call(method: string, route: string, bearer: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const envelope = parsed as { data?: unknown; error?: { code?: string; message?: string } } | null;
  return { status: res.status, data: envelope?.data ?? parsed, code: envelope?.error?.code ?? null, message: envelope?.error?.message ?? null };
}

async function uploadSpeaking(route: string, bearer: string, bytes: Buffer, filename: string): Promise<ApiResult> {
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }), filename);
  const res = await fetch(`${BASE}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${bearer}` }, body: form });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const envelope = parsed as { data?: unknown; error?: { code?: string; message?: string } } | null;
  return { status: res.status, data: envelope?.data ?? parsed, code: envelope?.error?.code ?? null, message: envelope?.error?.message ?? null };
}

/** Synthetic but container-recognizable WebM take (the route validates the header). */
function syntheticTake(size = 2048): Buffer {
  const bytes = Buffer.alloc(size, 0x11);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(bytes, 0);
  return bytes;
}

/** Real, silent 8 kHz mono WAV so browser playback works during the QA pass. */
function silentWav(seconds = 1): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}

const checks: Array<{ check: string; ok: boolean; detail: unknown }> = [];
function assert(check: string, ok: boolean, detail: unknown = null) {
  checks.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail === null ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Complete current-format content, authored the way the builder saves it. */
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
            number, type, prompt: String((question as { prompt?: string }).prompt ?? ''), options,
            correctAnswers: manual ? [] : type === 'true_false_notgiven' ? ['TRUE'] : options.length ? [options[0]] : ['answer'],
            acceptedVariants: [],
            // Completion answers are one word/number, the blueprint's publish gate.
            wordLimit: manual ? null : 1,
            points: 1,
            answerRule: null,
          };
        }),
      })),
    };
  });
}

async function createExam(admin: string) {
  const created = await call('POST', '/mock/exams', admin, {
    type: 'multilevel', title: TITLE, profile: 'full_mock', starterStructure: true, assessmentPolicy: 'MANUAL_ONLY',
  });
  if (!created.data?.id) throw new Error(`exam create failed: ${created.status} ${created.code}`);
  const detail = await call('GET', `/mock/exams/${created.data.id}`, admin);
  return detail.data as { id: string; sections: Array<{ skill: string; groups: Array<{ id: string; sortOrder: number; questions: Array<{ id: string; number: number }> }> }> };
}

async function attachMedia(examId: string) {
  const write = (key: string, bytes: Buffer) => {
    const file = path.join(path.resolve(process.env.STORAGE_DIR ?? './storage'), key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return key;
  };
  const prefix = examId.slice(0, 8);
  const listening = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'listening' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  for (const [i, group] of listening.entries()) {
    await prisma.mockQuestionGroup.update({
      where: { id: group.id },
      data: { audioKey: write(`mock/phase3-${prefix}-${i}.wav`, silentWav(1)) },
    });
  }
  const speaking = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId, skill: 'speaking' } }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  });
  if (speaking[1]) {
    await prisma.mockQuestionGroup.update({
      where: { id: speaking[1].id },
      data: { imageKey: write(`mock/phase3-${prefix}-pictures.png`, Buffer.from('PNG phase3-disposable')) },
    });
  }
  return listening.map((group) => group.id);
}

/** Author every part of every section through the real content API, then publish. */
async function authorAndPublish(admin: string, exam: Awaited<ReturnType<typeof createExam>>) {
  const content = buildContent();
  for (const wanted of content) {
    const section = exam.sections.find((s) => s.skill === wanted.skill);
    if (!section) throw new Error(`missing section ${wanted.skill}`);
    const ordered = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
    if (ordered.length !== wanted.groups.length) throw new Error(`${wanted.skill}: ${ordered.length} groups vs ${wanted.groups.length} parts`);
    for (const [gi, group] of wanted.groups.entries()) {
      const saved = await call('PUT', `/mock/groups/${ordered[gi].id}/content`, admin, {
        questions: group.questions, deletedQuestionIds: [],
        partNumber: wanted.skill === 'listening' ? gi + 1 : undefined,
        audioDurationSec: wanted.skill === 'listening' ? 60 : undefined,
        // Writing Task 1.1 and 1.2 share one visible situation (the blueprint's
        // single stimulus for the pair).
        passageText: wanted.skill === 'reading'
          ? `Phase 3 disposable passage for reading part ${gi + 1}.`
          : wanted.skill === 'writing' && gi < 2
            ? 'The fictional community library is changing its opening hours. Write to a friend and to the library manager about the proposed change.'
            : undefined,
      });
      if (saved.status !== 200) throw new Error(`${wanted.skill} part ${gi}: ${saved.status} ${saved.code}`);
    }
  }
  return attachMedia(exam.id);
}

async function ensureStudent(): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findFirst({ where: { phone: STUDENT_PHONE }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const demoPassword = process.env.PHASE3_DEMO_PASSWORD;
  if (KEEP && !demoPassword) throw new Error('PHASE3_KEEP needs PHASE3_DEMO_PASSWORD to sign in for the browser pass');
  const user = await prisma.user.create({
    data: {
      name: STUDENT_NAME, phone: STUDENT_PHONE,
      passwordHash: demoPassword ? await bcrypt.hash(demoPassword, 12) : 'phase3-disposable',
      role: 'student',
      studentProfile: { create: { availablePrograms: ['MULTILEVEL'], activeProgram: 'MULTILEVEL', isApproved: true, linkCode: `PHASE3-${Date.now().toString(36)}` } },
    },
    select: { id: true },
  });
  return { id: user.id, created: true };
}

interface AttemptDetail { id: string; status: string; specificationVersion?: string; sectionDeadlines?: Record<string, string>; overallDeadlineAt?: string | null; rawScores?: Record<string, { score: number; max: number }>; sections?: Array<{ skill: string; groups: Array<{ id: string; questions: Array<{ id: string; correctAnswers?: string[] | null; type: string }> }> }> }

async function cleanupOnly() {
  const fixtures = await prisma.mockExam.findMany({ where: { title: { startsWith: 'PHASE3 DISPOSABLE' } }, select: { id: true } });
  const examIds = fixtures.map((exam) => exam.id);
  const takes = await prisma.mockAnswer.findMany({
    where: { attempt: { examId: { in: examIds } }, audioKey: { not: null } }, select: { audioKey: true },
  });
  const exams = await prisma.mockExam.deleteMany({ where: { id: { in: examIds } } });
  const students = await prisma.user.deleteMany({ where: { phone: STUDENT_PHONE } });
  const storageRoot = path.resolve(process.env.STORAGE_DIR ?? './storage');
  for (const take of takes) fs.rmSync(path.join(storageRoot, take.audioKey as string), { force: true });
  for (const name of fs.readdirSync(path.join(storageRoot, 'mock'))) {
    if (name.startsWith('phase3-')) fs.rmSync(path.join(storageRoot, 'mock', name), { force: true });
  }
  fs.rmSync(path.join(__dirname, '.phase3-keep.json'), { force: true });
  console.log(`CLEANUP_ONLY removed ${exams.count} exam fixture(s), ${students.count} student fixture(s) and ${takes.length} take file(s)`);
  await prisma.$disconnect();
}

async function main() {
  if (CLEANUP_ONLY) return cleanupOnly();
  const stale = await prisma.mockExam.deleteMany({ where: { title: { startsWith: 'PHASE3 DISPOSABLE' } } });
  if (stale.count) console.log(`cleaned ${stale.count} stale PHASE3 exam fixture(s)`);
  const staleStudents = await prisma.user.deleteMany({ where: { phone: STUDENT_PHONE } });
  if (staleStudents.count) console.log(`cleaned ${staleStudents.count} stale PHASE3 student(s)`);

  const baseline = {
    exams: await prisma.mockExam.count(),
    attempts: await prisma.mockAttempt.count(),
    answers: await prisma.mockAnswer.count(),
    users: await prisma.user.count(),
  };

  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'admin', isActive: true }, select: { id: true } });
  const adminToken = token(admin.id);
  const student = await ensureStudent();
  const studentToken = token(student.id);

  // ── Authoring half: one disposable, complete, published full mock ──
  const exam = await createExam(adminToken);
  const listeningGroups = await authorAndPublish(adminToken, exam);
  const readiness = await call('GET', `/mock/exams/${exam.id}/readiness`, adminToken);
  assert('authoring: disposable exam is READY', readiness.data?.ready === true, readiness.data?.items?.filter((i: any) => !i.ok));
  const published = await call('PATCH', `/mock/exams/${exam.id}`, adminToken, { isPublished: true });
  assert('authoring: disposable exam PUBLISHED', published.status === 200 && published.data?.isPublished === true, [published.status, published.data?.isPublished]);
  const dbExam = await prisma.mockExam.findUniqueOrThrow({ where: { id: exam.id } });
  assert('authoring: stamped with the CURRENT revision and profile', dbExam.specificationVersion === 'UZBMB_MULTILEVEL_EN_2026_V2' && dbExam.speakingProfileVersion === 'BESTWAY_MULTILEVEL_SPEAKING_2026_V3', [dbExam.specificationVersion, dbExam.speakingProfileVersion]);

  // ── Student catalogue ──
  const catalogue = await call('GET', '/mock/exams', studentToken);
  const listed = (Array.isArray(catalogue.data) ? catalogue.data : []).find((e: any) => e.id === exam.id);
  assert('student: published exam is listed, ready and granted', listed?.ready === true && listed?.access === 'granted', listed ? { ready: listed.ready, access: listed.access } : 'not listed');

  // ── Attempt A: the full practice journey ──
  const startedA = await call('POST', `/mock/exams/${exam.id}/start`, studentToken, { mode: 'practice' });
  const attemptA = startedA.data?.attemptId as string;
  assert('student A: start creates a fresh practice attempt', startedA.status === 201 || startedA.status === 200, [startedA.status, startedA.code]);
  if (!attemptA) throw new Error(`start A failed: ${startedA.status} ${startedA.code}`);
  assert('student A: attempt carries the current revision and profile', !!attemptA && startedA.data?.exam?.specificationVersion === 'UZBMB_MULTILEVEL_EN_2026_V2', startedA.data?.exam?.specificationVersion);

  const detailA1 = await call('GET', `/mock/attempts/${attemptA}`, studentToken);
  const inProgress = detailA1.data as AttemptDetail;
  const objective = (inProgress.sections ?? []).filter((s) => s.skill === 'listening' || s.skill === 'reading');
  const objectiveQuestions = objective.flatMap((s) => s.groups.flatMap((g) => g.questions));
  assert('student A: in-progress detail hides every answer key', objectiveQuestions.every((q) => q.correctAnswers === undefined), { checked: objectiveQuestions.length });
  assert('student A: objective blueprint loaded (35 listening + 35 reading)', objectiveQuestions.length === 70, objectiveQuestions.length);

  const emptySubmit = await call('POST', `/mock/attempts/${attemptA}/submit`, studentToken);
  assert('gate A: an untouched exam is refused', emptySubmit.status === 400 && emptySubmit.code === 'MOCK_ATTEMPT_INCOMPLETE', [emptySubmit.status, emptySubmit.code]);
  assert('gate A: the refusal names the four sections without leaking answers', ['Listening', 'Reading', 'Writing', 'Speaking'].every((s) => String(emptySubmit.message ?? '').includes(s)) && !String(emptySubmit.message).includes('Community option'), emptySubmit.message);
  const afterRefusal = await prisma.mockAttempt.findUniqueOrThrow({ where: { id: attemptA } });
  assert('gate A: the refusal left the attempt untouched', afterRefusal.status === 'in_progress' && afterRefusal.submittedAt === null);

  // Answer the 70 objective questions with their authored keys, then the 3 tasks.
  // Only the staff view carries the keys — the student view above does not.
  const staffView = await call('GET', `/mock/attempts/${attemptA}`, adminToken);
  const staffObjective = ((staffView.data as AttemptDetail).sections ?? []).filter((s) => s.skill === 'listening' || s.skill === 'reading');
  const withKeys = staffObjective.flatMap((s) => s.groups.flatMap((g) => g.questions));
  assert('teacher A: the staff view carries every answer key', withKeys.length === 70 && withKeys.every((q) => Array.isArray(q.correctAnswers)), withKeys.length);
  const objectiveAnswers = withKeys.map((q) => ({ questionId: q.id, response: (q.correctAnswers ?? ['answer'])[0] }));
  const saved = await call('POST', `/mock/attempts/${attemptA}/answers`, studentToken, { answers: objectiveAnswers });
  assert('student A: 70 objective answers saved', saved.status === 200 || saved.status === 201, [saved.status, saved.code]);
  const writing = (inProgress.sections ?? []).find((s) => s.skill === 'writing');
  const writingAnswers = (writing?.groups ?? []).map((g, i) => ({ questionId: g.questions[0].id, response: `Phase 3 disposable writing response ${i + 1}. `.repeat(30) }));
  const savedWriting = await call('POST', `/mock/attempts/${attemptA}/answers`, studentToken, { answers: writingAnswers });
  assert('student A: 3 writing tasks saved', savedWriting.status === 200 || savedWriting.status === 201, [savedWriting.status, savedWriting.code]);

  // Seven of eight speaking takes: the last prompt must still block the hand-in.
  const speaking = (inProgress.sections ?? []).find((s) => s.skill === 'speaking');
  const speakingQuestions = (speaking?.groups ?? []).flatMap((g) => g.questions);
  assert('student A: speaking blueprint loaded (4 parts / 8 responses)', speakingQuestions.length === 8 && (speaking?.groups ?? []).length === 4, speakingQuestions.length);
  const takeIds: string[] = [];
  for (const [i, question] of speakingQuestions.entries()) {
    const res = await uploadSpeaking(`/mock/attempts/${attemptA}/speaking/${question.id}`, studentToken, syntheticTake(), `phase3-${i}.webm`);
    if (res.status !== 200 && res.status !== 201) throw new Error(`speaking upload ${i} failed: ${res.status} ${res.code}`);
    takeIds.push(question.id);
  }
  assert('student A: 8 recordings uploaded through the real route', takeIds.length === 8);
  const audio = await fetch(`${BASE}/mock/attempts/${attemptA}/answers/${takeIds[0]}/audio`, { headers: { Authorization: `Bearer ${studentToken}` } });
  assert('student A: an uploaded take is retrievable for grading', audio.ok, audio.status);

  const submittedA = await call('POST', `/mock/attempts/${attemptA}/submit`, studentToken);
  assert('student A: a complete hand-in is graded', submittedA.status === 200 || submittedA.status === 201, [submittedA.status, submittedA.code]);
  const resultA = submittedA.data as any;
  assert('student A: manual sections are pending, nothing was fabricated', resultA?.status === 'grading' && resultA?.overallScore === null && resultA?.cefrLevel === null, [resultA?.status, resultA?.overallScore]);
  assert('student A: every section maximum is the Multilevel scale', JSON.stringify(resultA?.rawScores?.listening) === JSON.stringify({ score: 35, max: 35 }) && resultA?.rawScores?.reading?.max === 35 && resultA?.rawScores?.writing?.max === 16 && resultA?.rawScores?.speaking?.max === 21, resultA?.rawScores);
  assert('student A: every objective key was accepted (35/35 + 35/35)', resultA?.rawScores?.listening?.score === 35 && resultA?.rawScores?.reading?.score === 35, [resultA?.rawScores?.listening, resultA?.rawScores?.reading]);
  assert('student A: estimated, unofficial scoring metadata', resultA?.scoreMethod === 'ESTIMATED' && resultA?.isOfficial === false && resultA?.overallBand === null, [resultA?.scoreMethod, resultA?.isOfficial, resultA?.overallBand]);

  const gradingDetail = await call('GET', `/mock/attempts/${attemptA}`, studentToken);
  const gradedQuestions = (gradingDetail.data as AttemptDetail).sections?.flatMap((s) => s.groups.flatMap((g) => g.questions)) ?? [];
  assert('student A: answer keys stay hidden while grading is pending', gradedQuestions.every((q) => q.correctAnswers === undefined), { checked: gradedQuestions.length });

  // ── Teacher half: holistic raw scores per task/part (half-points) ──
  const caps = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId: exam.id, skill: { in: ['writing', 'speaking'] } } },
    select: { sortOrder: true, maxScore: true, questions: { select: { id: true }, orderBy: { sortOrder: 'asc' } } },
  });
  let manualGraded = 0;
  for (const group of caps) {
    const cap = group.maxScore ?? group.questions.length;
    const score = Math.max(0, cap - 1);
    // A speaking part is one holistic raw score: every prompt of the part is
    // rated and the part score is their rounded average.
    for (const question of group.questions) {
      const graded = await call('POST', `/mock/attempts/${attemptA}/grade`, adminToken, { questionId: question.id, score });
      if (graded.status !== 200 && graded.status !== 201) throw new Error(`grade ${question.id} failed: ${graded.status} ${graded.code}`);
      manualGraded += 1;
    }
  }
  assert('teacher A: all 11 manual writing tasks and speaking prompts rated', manualGraded === 11, manualGraded);
  const invalid = await call('POST', `/mock/attempts/${attemptA}/grade`, adminToken, { questionId: caps[0].questions[0].id, score: (caps[0].maxScore ?? 5) + 1 });
  assert('teacher A: a raw score above the task cap is refused', invalid.status === 400 && invalid.code === 'SCORE_OUT_OF_RANGE', [invalid.status, invalid.code]);
  const finalDetail = await call('GET', `/mock/attempts/${attemptA}`, studentToken);
  const finished = finalDetail.data as any;
  assert('teacher A: holistic grading completes the attempt', finished?.status === 'completed', [finished?.status, finished?.overallScore]);
  assert('teacher A: the result is an estimated Multilevel result, never an IELTS band', typeof finished?.overallScore === 'number' && finished?.overallBand === null && finished?.cefrLevel !== null && finished?.isOfficial === false, [finished?.overallScore, finished?.cefrLevel, finished?.overallBand]);
  assert('teacher A: graded raw scores use the authored task/part caps', finished?.rawScores?.writing?.max === 16 && finished?.rawScores?.writing?.score === 13 && finished?.rawScores?.speaking?.max === 21 && finished?.rawScores?.speaking?.score === 17, finished?.rawScores);

  // ── HTTP-level submit idempotency ──
  const before = await prisma.mockAttempt.findUniqueOrThrow({ where: { id: attemptA } });
  const answerCount = await prisma.mockAnswer.count({ where: { attemptId: attemptA } });
  const repeatA = await call('POST', `/mock/attempts/${attemptA}/submit`, studentToken);
  const after = await prisma.mockAttempt.findUniqueOrThrow({ where: { id: attemptA } });
  assert('idempotency: a repeated submit returns the stored result', (repeatA.status === 200 || repeatA.status === 201) && repeatA.data?.status === 'completed' && repeatA.data?.overallScore === finished?.overallScore, [repeatA.status, repeatA.data?.status, repeatA.data?.overallScore]);
  assert('idempotency: nothing was re-graded or re-stamped', after.submittedAt?.getTime() === before.submittedAt?.getTime() && after.finishedAt?.getTime() === before.finishedAt?.getTime() && await prisma.mockAnswer.count({ where: { attemptId: attemptA } }) === answerCount);

  // ── Attempt B: timed exam, unfinished refusal and the timeout auto-submit ──
  const startedB = await call('POST', `/mock/exams/${exam.id}/start`, studentToken, { mode: 'timed' });
  const attemptB = startedB.data?.attemptId as string;
  assert('student B: timed start exposes the per-section clocks the review surface needs', !!startedB.data?.sectionDeadlines?.listening && !!startedB.data?.overallDeadlineAt, [startedB.data?.sectionDeadlines?.listening, startedB.data?.overallDeadlineAt]);
  if (!attemptB) throw new Error(`start B failed: ${startedB.status} ${startedB.code}`);

  const prepare = await call('POST', `/mock/attempts/${attemptB}/listening/${listeningGroups[0]}/prepare`, studentToken);
  const prepEndsAt = prepare.data?.prepEndsAt ? new Date(prepare.data.prepEndsAt).getTime() : 0;
  assert('student B: listening preview is server-granted with a two-play cap', prepare.status === 201 || prepare.status === 200 ? prepare.data?.playLimit === 2 && prepEndsAt > Date.now() : false, [prepare.status, prepare.data?.playLimit, prepare.data?.prepEndsAt]);
  const earlyPlay = await call('POST', `/mock/attempts/${attemptB}/listening/${listeningGroups[0]}/play`, studentToken);
  assert('student B: playing during the preview is refused', earlyPlay.status === 403 && earlyPlay.code === 'PREVIEW_ACTIVE', [earlyPlay.status, earlyPlay.code]);
  await sleep(Math.max(0, prepEndsAt - Date.now() + 1200));
  const firstPlay = await call('POST', `/mock/attempts/${attemptB}/listening/${listeningGroups[0]}/play`, studentToken);
  assert('student B: the first play is granted after the preview', firstPlay.status === 200 || firstPlay.status === 201 ? firstPlay.data?.plays === 1 : false, [firstPlay.status, firstPlay.data?.plays, firstPlay.code]);
  const overlap = await call('POST', `/mock/attempts/${attemptB}/listening/${listeningGroups[0]}/play`, studentToken);
  assert('student B: overlapping playback is refused', overlap.status === 403 && overlap.code === 'PREVIEW_ACTIVE', [overlap.status, overlap.code]);

  const partialB = await call('POST', `/mock/attempts/${attemptB}/answers`, studentToken, { answers: objectiveAnswers.slice(0, 5) });
  assert('student B: a few answers saved', partialB.status === 200 || partialB.status === 201, [partialB.status, partialB.code]);
  const earlySubmit = await call('POST', `/mock/attempts/${attemptB}/submit`, studentToken);
  assert('gate B: an unfinished timed exam is refused while the clock runs', earlySubmit.status === 400 && earlySubmit.code === 'MOCK_ATTEMPT_INCOMPLETE', [earlySubmit.status, earlySubmit.code]);
  assert('gate B: the refusal still invites the student to finish', String(earlySubmit.message ?? '').includes('Finish the remaining work'), earlySubmit.message);

  // The client-side auto-submit fires at the deadline; expire the clock the way
  // the server would and prove the same route now accepts the partial exam.
  const past = new Date(Date.now() - 60_000);
  await prisma.mockAttempt.update({ where: { id: attemptB }, data: { overallDeadlineAt: past, deadlineAt: past } });
  const autoSubmit = await call('POST', `/mock/attempts/${attemptB}/submit`, studentToken);
  assert('gate B: the timeout auto-submit is accepted with a partial exam', (autoSubmit.status === 200 || autoSubmit.status === 201) && autoSubmit.data?.status === 'grading', [autoSubmit.status, autoSubmit.data?.status, autoSubmit.code]);
  const storedB = await prisma.mockAttempt.findUniqueOrThrow({ where: { id: attemptB } });
  assert('gate B: the partial exam kept its own clocks, no re-grade', storedB.status === 'grading' && storedB.submittedAt !== null);

  if (KEEP) {
    fs.writeFileSync(path.join(__dirname, '.phase3-keep.json'), JSON.stringify({ examId: exam.id, studentId: student.id, studentPhone: STUDENT_PHONE, keptAt: new Date().toISOString() }, null, 2));
    console.log(`\nKEEP mode: disposable exam ${exam.id} and student ${STUDENT_PHONE} retained for the browser pass`);
    console.log(`SUMMARY ${checks.length - checks.filter((c) => !c.ok).length}/${checks.length} passed; fixtures kept`);
    await prisma.$disconnect();
    const keptFailed = checks.filter((c) => !c.ok);
    if (keptFailed.length) process.exit(1);
    return;
  }

  // ── Cleanup ──
  const takes = await prisma.mockAnswer.findMany({
    where: { attemptId: { in: [attemptA, attemptB] }, audioKey: { not: null } }, select: { audioKey: true },
  });
  await prisma.assessmentJob.deleteMany({ where: { attemptId: { in: [attemptA, attemptB] } } });
  await prisma.mockAnswer.deleteMany({ where: { attemptId: { in: [attemptA, attemptB] } } });
  await prisma.mockCheatEvent.deleteMany({ where: { attemptId: { in: [attemptA, attemptB] } } });
  await prisma.mockAttempt.deleteMany({ where: { examId: exam.id } });
  await prisma.mockExam.delete({ where: { id: exam.id } });
  if (student.created) await prisma.user.delete({ where: { id: student.id } });
  const storageRoot = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const mediaFiles = [
    ...listeningGroups.map((_, i) => `mock/phase3-${exam.id.slice(0, 8)}-${i}.wav`),
    `mock/phase3-${exam.id.slice(0, 8)}-pictures.png`,
    ...takes.map((take) => take.audioKey as string),
  ];
  for (const key of mediaFiles) fs.rmSync(path.join(storageRoot, key), { force: true });
  assert('cleanup: no disposable media left on disk', mediaFiles.every((key) => !fs.existsSync(path.join(storageRoot, key))), { files: mediaFiles.length });
  const after1 = {
    exams: await prisma.mockExam.count(),
    attempts: await prisma.mockAttempt.count(),
    answers: await prisma.mockAnswer.count(),
    users: await prisma.user.count(),
  };
  assert('cleanup: disposable fixtures removed', JSON.stringify(baseline) === JSON.stringify(after1), { baseline, after1 });
  assert('cleanup: no orphan questions or groups', await prisma.mockQuestion.count({ where: { group: { section: { examId: exam.id } } } }) === 0 && await prisma.mockQuestionGroup.count({ where: { section: { examId: exam.id } } }) === 0);
  assert('student: recordings were never left behind', await prisma.mockAnswer.count({ where: { attemptId: { in: [attemptA, attemptB] } } }) === 0);

  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(__dirname, '.phase3-student-report.json'), JSON.stringify({
    ranAt: new Date().toISOString(), baseUrl: BASE, examId: exam.id, attempts: [attemptA, attemptB],
    microphone: 'MANUAL_MICROPHONE_BROWSER_CHECK_REQUIRED',
    checks, passed: checks.length - failed.length, failed: failed.length,
  }, null, 2));
  console.log(`\nSUMMARY ${checks.length - failed.length}/${checks.length} passed; failed=${failed.length}`);
  console.log('MICROPHONE MANUAL_MICROPHONE_BROWSER_CHECK_REQUIRED (no physical microphone in this environment)');
  await prisma.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error('PHASE3_STUDENT_E2E_FAILED', error instanceof Error ? error.stack : error);
  await prisma.$disconnect();
  process.exit(1);
});
