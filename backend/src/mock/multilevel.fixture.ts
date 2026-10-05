import { MockSkill } from '@prisma/client';
import { BlueprintSection, MULTILEVEL_SPECIFICATION } from './multilevel-specification';

/** Original deterministic test content. Never seeds the production question bank. */
export function multilevelFixture(): BlueprintSection[] {
  return (Object.keys(MULTILEVEL_SPECIFICATION) as MockSkill[]).map((skill) => ({
    skill,
    groups: MULTILEVEL_SPECIFICATION[skill].parts.map((p, pi) => ({
      sortOrder: pi, partNumber: skill === 'listening' ? pi + 1 : null,
      passageText: skill === 'writing' && pi < 2 ? 'The fictional community library is changing its opening hours. Write to a friend and to the library manager about the proposed change.' : null,
      audioKey: skill === 'listening' ? `test-only/community-${pi}.wav` : null,
      audioDurationSec: skill === 'listening' ? 60 : null,
      imageKey: skill === 'speaking' && pi === 1 ? 'test-only/community-pictures.png' : null,
      maxScore: p.rawMax ?? null,
      stimulusRef: skill === 'writing' && pi < 2 ? 'community-library-task-1' : null,
      questions: Array.from({ length: p.count }, (_, qi) => {
        const type = skill === 'reading' && pi === 3 ? qi < 4 ? 'multiple_choice' : 'true_false_notgiven'
          : skill === 'reading' && pi === 4 ? qi < 4 ? 'summary_completion' : 'multiple_choice'
          : p.types[qi % p.types.length];
        const options = p.options ?? (skill === 'reading' && type === 'multiple_choice' ? 4 : 0);
        return { type, points: p.rawMax ?? 1, wordLimit: 1,
          prompt: `${skill} ${p.key}: describe the fictional community library, item ${qi+1}.`,
          options: Array.from({ length: options }, (_, i) => `Community option ${i+1}`) };
      }),
    })),
  }));
}
