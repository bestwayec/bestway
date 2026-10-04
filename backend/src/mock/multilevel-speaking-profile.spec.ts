import { describe, expect, it } from 'vitest';
import { BESTWAY_MULTILEVEL_SPEAKING_2026_V2, MULTILEVEL_SPEAKING_V2, speakingProfileTiming } from './multilevel-speaking-profile';
import { taskGuidance } from './multilevel-specification';

describe('versioned BestWay Multilevel speaking timings', () => {
  it('preserves the complete V2 preparation and response contract', () => {
    expect(MULTILEVEL_SPEAKING_V2).toEqual({
      version: BESTWAY_MULTILEVEL_SPEAKING_2026_V2,
      isOfficialTiming: false,
      parts: [
        { key: '1.1', prepSeconds: [5, 5, 5], responseSeconds: [30, 30, 30] },
        { key: '1.2', prepSeconds: [10, 5, 5], responseSeconds: [45, 30, 30] },
        { key: '2', prepSeconds: [60], responseSeconds: [120] },
        { key: '3', prepSeconds: [60], responseSeconds: [120] },
      ],
    });
  });

  it('exposes every V2 question timing with one holistic maximum per part', () => {
    const guidance = [3, 3, 1, 1].map((count, partIndex) =>
      Array.from({ length: count }, (_, questionIndex) => {
        const value = taskGuidance('speaking', partIndex, questionIndex, BESTWAY_MULTILEVEL_SPEAKING_2026_V2)!;
        return [value.prepSeconds, value.responseSeconds, value.rawMax];
      }),
    );
    expect(guidance).toEqual([
      [[5, 30, 5], [5, 30, 5], [5, 30, 5]],
      [[10, 45, 5], [5, 30, 5], [5, 30, 5]],
      [[60, 120, 5]],
      [[60, 120, 6]],
    ]);
  });

  it.each([undefined, null, 'HISTORICAL_PROFILE'])('does not replace historical profile %s with V2', (version) => {
    expect(speakingProfileTiming(version, 0, 0)).toBeUndefined();
    expect(taskGuidance('speaking', 0, 0, version)).toMatchObject({ prepSeconds: 0, responseSeconds: 30 });
    expect(taskGuidance('speaking', 1, 0, version)).toMatchObject({ prepSeconds: 15, responseSeconds: 45 });
  });
});
