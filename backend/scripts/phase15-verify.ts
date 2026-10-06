/**
 * PHASE 1.5 — real-DB / real-route verification of the admin Multilevel
 * inspection → safe repair → corrected clone capability, plus permissions and
 * the desktop-version endpoint. Read-only against every row it does not own.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { MULTILEVEL_VERSION } from '../src/mock/multilevel-specification';

const prisma = new PrismaClient();
const BASE = process.env.PHASE15_BASE_URL ?? 'http://localhost:3115/v1';
const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, '.phase15-fixtures.json'), 'utf8')) as {
  legacyVersion: string;
  users: { admin: string; superAdmin: string; teacher: string; student: string };
  fixtureA: { id: string; title: string };
  fixtureB: { id: string; title: string; attemptId: string };
};

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
  const envelope = parsed as { success?: boolean; data?: unknown; error?: { code?: string } } | null;
  return { status: res.status, data: envelope?.data ?? parsed, code: envelope?.error?.code ?? null };
}

const checks: Array<{ check: string; ok: boolean; detail: unknown }> = [];
function assert(check: string, ok: boolean, detail: unknown = null) {
  checks.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail === null ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`);
}
const eq = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

async function snapshot(examId: string) {
  const [exam, sections, groups, questions, attempts, answers, jobs] = await Promise.all([
    prisma.mockExam.findUniqueOrThrow({ where: { id: examId } }),
    prisma.mockSection.findMany({ where: { examId }, orderBy: { sortOrder: 'asc' } }),
    prisma.mockQuestionGroup.findMany({ where: { section: { examId } }, orderBy: { id: 'asc' } }),
    prisma.mockQuestion.findMany({ where: { group: { section: { examId } } }, orderBy: { id: 'asc' } }),
    prisma.mockAttempt.findMany({ where: { examId }, orderBy: { id: 'asc' } }),
    prisma.mockAnswer.findMany({ where: { attempt: { examId } }, orderBy: { id: 'asc' } }),
    prisma.assessmentJob.findMany({ where: { attempt: { examId } }, orderBy: { id: 'asc' } }),
  ]);
  return { exam, sections, groups, questions, attempts, answers, jobs };
}

async function main() {
  const admin = token(FIXTURES.users.admin);
  const superAdmin = token(FIXTURES.users.superAdmin);
  const student = token(FIXTURES.users.student);
  const teacherRow = await prisma.user.findFirstOrThrow({
    where: { role: 'teacher', isActive: true, NOT: { id: { startsWith: 'runtime-owner' } } }, select: { id: true },
  });
  const teacher = token(teacherRow.id);
  const A = FIXTURES.fixtureA.id;
  const B = FIXTURES.fixtureB.id;

  // ─────────── 3. Inspection against real DB, with zero-write proof ───────────
  const beforeA = await snapshot(A);
  const inspection = await call('GET', `/mock/exams/${A}/multilevel-repair-inspection`, admin);
  const afterA = await snapshot(A);

  assert('inspection: admin gets 200', inspection.status === 200, inspection.status);
  const plan = inspection.data as Record<string, any>;
  assert('inspection: zero history counts', eq(plan.attempts, {
    attemptCount: 0, activeAttemptCount: 0, completedAttemptCount: 0, submissionCount: 0, resultCount: 0,
  }), plan.attempts);
  assert('inspection: readiness false before repair', plan.readiness.ready === false, plan.readiness.exactIssues);
  assert('inspection: repair allowed (zero history)', plan.safeRepairAllowed === true);
  assert('inspection: legacy version detected', plan.currentVersion === false && plan.specificationVersion === FIXTURES.legacyVersion, plan.specificationVersion);
  assert('inspection: requires unpublish', plan.requiresUnpublish === true);
  assert('inspection: recommended REPAIR_DRAFT_THEN_REVIEW', plan.recommendedAction === 'REPAIR_DRAFT_THEN_REVIEW');
  assert('inspection: writing metadata (legacy)', eq(plan.writing.map((w: any) => [w.role, w.maxScore, w.expectedMaxScore]), [
    ['Informal Letter', 1, 5], ['Formal Letter', 2, 5], ['Publication', 6, 6],
  ]), plan.writing.map((w: any) => [w.role, w.maxScore, w.expectedMaxScore]));
  assert('inspection: writing stimulus NOT shared yet', plan.writingSharesStimulusRef === false, plan.writing.map((w: any) => w.stimulusRef));
  assert('inspection: speaking metadata (legacy)', eq(plan.speaking.map((s: any) => [s.part, s.responseCount, s.expectedResponseCount, s.maxScore, s.expectedMaxScore, s.imageAssetCount]), [
    ['1.1', 3, 3, 1, 5, 0], ['1.2', 3, 3, 1, 5, 1], ['2', 1, 1, 1, 5, 0], ['3', 1, 1, 1, 6, 0],
  ]), plan.speaking);
  assert('inspection: ZERO writes (DB identical before/after)', eq(beforeA, afterA));

  // ─────────── 4. Zero-history safe repair + authoritative readiness ───────────
  const needsConfirmation = await call('POST', `/mock/exams/${A}/apply-multilevel-safe-repair`, admin, { confirm: false });
  assert('repair: unconfirmed is rejected', needsConfirmation.status === 400 && needsConfirmation.code === 'CONFIRMATION_REQUIRED', [needsConfirmation.status, needsConfirmation.code]);

  const repair = await call('POST', `/mock/exams/${A}/apply-multilevel-safe-repair`, admin, { confirm: true });
  assert('repair: admin confirmed repair succeeds', repair.status === 201 || repair.status === 200, repair.status);
  const repaired = repair.data as Record<string, any>;
  assert('repair: unpublished + version upgraded + draft', repaired.unpublished === true && repaired.versionUpgraded === true && repaired.status === 'DRAFT_REQUIRES_REVIEW', repaired);

  const rowsA = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId: A } },
    select: { maxScore: true, stimulusRef: true, section: { select: { skill: true } }, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  const writingA = rowsA.filter((g) => g.section.skill === 'writing');
  const speakingA = rowsA.filter((g) => g.section.skill === 'speaking');
  const examA = await prisma.mockExam.findUniqueOrThrow({ where: { id: A } });
  assert('repair: writing caps reconciled 5/5/6 (raw 16)', eq(writingA.map((g) => g.maxScore), [5, 5, 6]), writingA.map((g) => g.maxScore));
  assert('repair: writing 1.1 + 1.2 share one stimulus', !!writingA[0].stimulusRef && writingA[0].stimulusRef === writingA[1].stimulusRef, writingA.map((g) => g.stimulusRef));
  assert('repair: speaking caps reconciled 5/5/5/6 (raw 21)', eq(speakingA.map((g) => g.maxScore), [5, 5, 5, 6]), speakingA.map((g) => g.maxScore));
  assert('repair: original identity preserved', examA.id === A && examA.title === FIXTURES.fixtureA.title, { id: examA.id, title: examA.title });
  assert('repair: stays draft, not auto-published', examA.isPublished === false);
  assert('repair: current specification applied', examA.specificationVersion === MULTILEVEL_VERSION, examA.specificationVersion);
  assert('repair: no attempt/result created', (await prisma.mockAttempt.count({ where: { examId: A } })) === 0 && (await prisma.assessmentJob.count({ where: { attempt: { examId: A } } })) === 0);

  const readiness = await call('GET', `/mock/exams/${A}/readiness`, admin);
  const rdata = readiness.data as Record<string, any>;
  assert('repair: authoritative readiness === true', rdata.ready === true, rdata.items?.filter((i: any) => !i.ok));

  // ─────────── 5. History-protected exam + corrected copy ───────────
  const beforeB = await snapshot(B);
  const inspectionB = await call('GET', `/mock/exams/${B}/multilevel-repair-inspection`, admin);
  const planB = inspectionB.data as Record<string, any>;
  assert('history: attempt/submission/result counted', planB.attempts.attemptCount > 0 && planB.attempts.submissionCount > 0 && planB.attempts.resultCount > 0, planB.attempts);
  assert('history: repair forbidden', planB.safeRepairAllowed === false && planB.historyExists === true && planB.recommendedAction === 'CREATE_CORRECTED_COPY', { safeRepairAllowed: planB.safeRepairAllowed, recommendedAction: planB.recommendedAction });

  const deniedRepair = await call('POST', `/mock/exams/${B}/apply-multilevel-safe-repair`, admin, { confirm: true });
  assert('history: in-place repair rejected with 409', deniedRepair.status === 409 && deniedRepair.code === 'EXAM_VERSION_IN_USE', [deniedRepair.status, deniedRepair.code]);
  assert('history: source exam + history unchanged', eq(beforeB, await snapshot(B)));

  const clone = await call('POST', `/mock/exams/${B}/clone-corrected-multilevel`, admin);
  assert('clone: created', clone.status === 201 || clone.status === 200, clone.status);
  const copy = clone.data as Record<string, any>;
  assert('clone: draft requiring review, source preserved', copy.status === 'DRAFT_REQUIRES_REVIEW' && copy.sourcePreserved === true, copy);
  assert('clone: new identity', typeof copy.id === 'string' && copy.id !== B, copy.id);
  assert('history: source exam + history still unchanged after clone', eq(beforeB, await snapshot(B)));

  const copyExam = await prisma.mockExam.findUniqueOrThrow({ where: { id: copy.id } });
  assert('clone: new exam is a draft', copyExam.isPublished === false);
  assert('clone: current specification version', copyExam.specificationVersion === MULTILEVEL_VERSION, copyExam.specificationVersion);
  assert('clone: no attempts/submissions/results copied', (await prisma.mockAttempt.count({ where: { examId: copy.id } })) === 0 && (await prisma.assessmentJob.count({ where: { attempt: { examId: copy.id } } })) === 0);
  const copyQuestions = await prisma.mockQuestion.count({ where: { group: { section: { examId: copy.id } } } });
  assert('clone: authored content copied (81 questions)', copyQuestions === 81, copyQuestions);
  const copyGroups = await prisma.mockQuestionGroup.findMany({
    where: { section: { examId: copy.id } },
    select: { maxScore: true, stimulusRef: true, audioKey: true, imageKey: true, section: { select: { skill: true } }, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  const copyWriting = copyGroups.filter((g) => g.section.skill === 'writing');
  const copySpeaking = copyGroups.filter((g) => g.section.skill === 'speaking');
  const copyListening = copyGroups.filter((g) => g.section.skill === 'listening');
  assert('clone: Multilevel group metadata reconciled', eq(copyWriting.map((g) => g.maxScore), [5, 5, 6]) && eq(copySpeaking.map((g) => g.maxScore), [5, 5, 5, 6]) && copyWriting[0].stimulusRef === copyWriting[1].stimulusRef);
  assert('clone: audio references preserved', copyListening.length > 0 && copyListening.every((g) => !!g.audioKey));
  assert('clone: speaking two-picture asset preserved', !!copySpeaking[1]?.imageKey);
  const copyReadiness = await call('GET', `/mock/exams/${copy.id}/readiness`, admin);
  assert('clone: readiness === true', (copyReadiness.data as Record<string, any>).ready === true, (copyReadiness.data as any).items?.filter((i: any) => !i.ok));

  // ─────────── Review readiness, Catalogue readiness and Start agree ───────────
  // Catalogue (list) and exam detail read the same definition through different
  // queries; all three must report the identical `ready` state.
  const list = await call('GET', '/mock/exams', admin);
  const listed = (Array.isArray(list.data) ? list.data : []) as Array<Record<string, any>>;
  const listedA = listed.find((e) => e.id === A);
  const listedCopy = listed.find((e) => e.id === copy.id);
  const detailA = await call('GET', `/mock/exams/${A}`, admin);
  const detailCopy = await call('GET', `/mock/exams/${copy.id}`, admin);
  assert('catalogue: repaired exam is listed', !!listedA, { listedCount: listed.length });
  assert('catalogue + detail + review readiness agree (repaired exam)',
    listedA?.ready === true && (detailA.data as Record<string, any>).ready === true && rdata.ready === true,
    { catalogue: listedA?.ready, detail: (detailA.data as Record<string, any>).ready, review: rdata.ready });
  assert('catalogue + detail + review readiness agree (corrected copy)',
    listedCopy?.ready === true && (detailCopy.data as Record<string, any>).ready === true && (copyReadiness.data as Record<string, any>).ready === true,
    { catalogue: listedCopy?.ready, detail: (detailCopy.data as Record<string, any>).ready, review: (copyReadiness.data as Record<string, any>).ready });

  // ─────────── 6. Permissions through the real routes ───────────
  const studentInspect = await call('GET', `/mock/exams/${A}/multilevel-repair-inspection`, student);
  const studentRepair = await call('POST', `/mock/exams/${A}/apply-multilevel-safe-repair`, student, { confirm: true });
  const studentClone = await call('POST', `/mock/exams/${A}/clone-corrected-multilevel`, student);
  const teacherInspect = await call('GET', `/mock/exams/${A}/multilevel-repair-inspection`, teacher);
  const teacherRepair = await call('POST', `/mock/exams/${A}/apply-multilevel-safe-repair`, teacher, { confirm: true });
  const teacherClone = await call('POST', `/mock/exams/${A}/clone-corrected-multilevel`, teacher);
  assert('permission: student forbidden (inspect/repair/clone)', [studentInspect.status, studentRepair.status, studentClone.status].every((s) => s === 403), [studentInspect.status, studentRepair.status, studentClone.status]);
  assert('permission: teacher forbidden (inspect/repair/clone)', [teacherInspect.status, teacherRepair.status, teacherClone.status].every((s) => s === 403), [teacherInspect.status, teacherRepair.status, teacherClone.status]);
  const superInspect = await call('GET', `/mock/exams/${A}/multilevel-repair-inspection`, superAdmin);
  assert('permission: super_admin allowed to inspect', superInspect.status === 200, superInspect.status);
  const anonInspect = await fetch(`${BASE}/mock/exams/${A}/multilevel-repair-inspection`);
  assert('permission: anonymous gets 401', anonInspect.status === 401, anonInspect.status);

  // ─────────── 7. desktop-version ───────────
  const versionRes = await fetch(`${BASE}/desktop-version`);
  const versionBody = (await versionRes.json()) as { data: Record<string, unknown> };
  const release = versionBody.data;
  assert('desktop-version: 200', versionRes.status === 200, versionRes.status);
  assert('desktop-version: version 0.5.1-rc.1', release.version === '0.5.1-rc.1', release.version);
  assert('desktop-version: installer URL', release.downloadUrl === 'https://github.com/bestwayec/bw-tauri/releases/download/v0.5.1-rc.1/Bestway.App_0.5.1-rc.1_x64-setup.exe', release.downloadUrl);
  assert('desktop-version: prerelease true', release.prerelease === true);
  assert('desktop-version: manual_installer channel', release.updateChannel === 'manual_installer');
  assert('desktop-version: no updater signature advertised', !('signature' in release) && !('pubkey' in release) && !('updaterUrl' in release), Object.keys(release));

  const failed = checks.filter((c) => !c.ok);
  const report = {
    ranAt: new Date().toISOString(), baseUrl: BASE,
    fixtureA: { id: A, repairedVersion: examA.specificationVersion, readiness: rdata.ready },
    fixtureB: { id: B, cloneId: copy.id, cloneReadiness: (copyReadiness.data as Record<string, any>).ready },
    checks, passed: checks.length - failed.length, failed: failed.length,
  };
  fs.writeFileSync(path.join(__dirname, '.phase15-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nSUMMARY ${report.passed}/${checks.length} passed; failed=${report.failed}`);
  await prisma.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (error) => {
  console.error('VERIFY_FAILED', error instanceof Error ? error.stack : error);
  await prisma.$disconnect();
  process.exit(1);
});
