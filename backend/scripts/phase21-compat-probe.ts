/**
 * PHASE 2.1 — read-only compatibility probe against REAL stored rows.
 *
 * Proves the Phase 3 invariant on data that already exists in the local
 * database: an exam stamped with revision 1 keeps its revision, stays readable,
 * stays startable, and still serves its historical 15/5/5 Speaking Part 1.2
 * preparation through its own product profile. Never writes.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  MULTILEVEL_CURRENT_VERSION,
  MULTILEVEL_VERSION_V1,
  multilevelIsCurrentVersion,
  multilevelIsSupportedVersion,
  multilevelStartReadiness,
  taskGuidance,
} from '../src/mock/multilevel-specification';
import { BESTWAY_MULTILEVEL_SPEAKING_2026_V2 } from '../src/mock/multilevel-speaking-profile';

const prisma = new PrismaClient();

async function main() {
  const exam = await prisma.mockExam.findFirstOrThrow({
    where: { type: 'multilevel', specificationVersion: MULTILEVEL_VERSION_V1 },
    include: { sections: { orderBy: { sortOrder: 'asc' }, include: { groups: { orderBy: { sortOrder: 'asc' }, include: { questions: { orderBy: { sortOrder: 'asc' } } } } } } },
  });

  console.log('exam:', exam.id, '|', exam.title);
  console.log('stored specificationVersion:', exam.specificationVersion);
  console.log('stored speakingProfileVersion:', exam.speakingProfileVersion);

  const supported = multilevelIsSupportedVersion(exam.specificationVersion);
  const current = multilevelIsCurrentVersion(exam.specificationVersion);
  console.log('supported revision:', supported, '| is current:', current);

  const readiness = multilevelStartReadiness(exam as never);
  console.log('start readiness supported:', readiness.supported);
  console.log('start readiness issue count:', readiness.issues.length);
  console.log('first issues:', readiness.issues.slice(0, 4));

  const part12 = taskGuidance('speaking', 1, 0, exam.speakingProfileVersion, exam.specificationVersion);
  const part12q2 = taskGuidance('speaking', 1, 2, exam.speakingProfileVersion, exam.specificationVersion);
  console.log('stored exam Speaking 1.2 q1 guidance:', { prepSeconds: part12?.prepSeconds, responseSeconds: part12?.responseSeconds });
  console.log('stored exam Speaking 1.2 q3 guidance:', { prepSeconds: part12q2?.prepSeconds, responseSeconds: part12q2?.responseSeconds });

  // The exam's own product profile WINS over the blueprint (unchanged historical
  // behaviour), so a stored V1 exam keeps serving its 10/5/5 product timing even
  // though its blueprint records 15/5/5. Both facts must hold at once.
  const blueprintOnly = taskGuidance('speaking', 1, 0, null, MULTILEVEL_VERSION_V1);
  console.log('blueprint-only V1 (no profile) guidance:', { prepSeconds: blueprintOnly?.prepSeconds, responseSeconds: blueprintOnly?.responseSeconds });
  const profileOnCurrent = taskGuidance('speaking', 1, 0, BESTWAY_MULTILEVEL_SPEAKING_2026_V2, MULTILEVEL_CURRENT_VERSION);
  console.log('retired profile V2 still overrides on any revision:', { prepSeconds: profileOnCurrent?.prepSeconds, responseSeconds: profileOnCurrent?.responseSeconds });

  const ok =
    exam.specificationVersion === MULTILEVEL_VERSION_V1 &&
    exam.speakingProfileVersion === BESTWAY_MULTILEVEL_SPEAKING_2026_V2 &&
    supported === true && current === false &&
    readiness.supported === true &&
    // The stored exam serves exactly the timing it served before this change.
    part12?.prepSeconds === 10 && part12?.responseSeconds === 45 &&
    part12q2?.prepSeconds === 5 && part12q2?.responseSeconds === 30 &&
    // ...and its immutable blueprint still records the original 15/5/5.
    blueprintOnly?.prepSeconds === 15 && blueprintOnly?.responseSeconds === 45;
  console.log(ok ? '\nCOMPAT_OK historical revision preserved and readable' : '\nCOMPAT_FAIL');
  await prisma.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (error) => {
  console.error('COMPAT_PROBE_FAILED', error instanceof Error ? error.stack : error);
  await prisma.$disconnect();
  process.exit(1);
});
