import { MockExamType, MockSkill, Prisma } from '@prisma/client';
import { MULTILEVEL_SPECIFICATION, MULTILEVEL_AUDIO } from './multilevel-specification';

/**
 * Editable starting points, without placeholder questions or answer keys.
 * Only the requested skills are created (single-skill practice); unchosen
 * sections are never auto-created.
 */
export function starterSections(
  type: MockExamType,
  skills?: MockSkill[],
): Prisma.MockSectionCreateWithoutExamInput[] {
  const all: MockSkill[] = ['listening', 'reading', 'writing', 'speaking'];
  const wanted = skills?.length ? all.filter((s) => skills.includes(s)) : all;
  const ielts = type !== 'multilevel';
  return wanted.map((skill) => {
    const sortOrder = all.indexOf(skill);
    const count = ielts ? { listening: 4, reading: 3, writing: 2, speaking: 3 }[skill] : MULTILEVEL_SPECIFICATION[skill].parts.length;
    const unit = skill === 'reading' ? 'Passage' : skill === 'writing' ? 'Task' : 'Part';
    return {
      skill,
      sortOrder,
      title: skill[0].toUpperCase() + skill.slice(1),
      ...(ielts && (skill === 'reading' || skill === 'writing') ? { durationMinutes: 60 } : {}),
      ...(!ielts ? { durationMinutes: MULTILEVEL_SPECIFICATION[skill].durationSeconds / 60 } : {}),
      groups: {
        create: Array.from({ length: count }, (_, index) => ({
          title: ielts ? `${unit} ${index + 1}` : `${unit} ${MULTILEVEL_SPECIFICATION[skill].parts[index].key}`,
          sortOrder: index,
          ...(skill === 'listening' ? { partNumber: index + 1, audioPlayLimit: ielts ? 1 : MULTILEVEL_AUDIO.playLimit } : {}),
        })),
      },
    };
  });
}
