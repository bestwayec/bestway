import { describe, expect, it } from 'vitest';
import { BESTWAY_MULTILEVEL_SPEAKING_2026_V2, BESTWAY_MULTILEVEL_SPEAKING_2026_V3, MULTILEVEL_SPEAKING_V2, MULTILEVEL_SPEAKING_V3, speakingProfileTiming } from './multilevel-speaking-profile';
import { MULTILEVEL_VERSION_V1, taskGuidance } from './multilevel-specification';

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

  it('freezes the current V3 contract: no preparation on Parts 1.1 and 1.2', () => {
    expect(MULTILEVEL_SPEAKING_V3).toEqual({
      version: BESTWAY_MULTILEVEL_SPEAKING_2026_V3,
      isOfficialTiming: false,
      parts: [
        { key: '1.1', prepSeconds: [0, 0, 0], responseSeconds: [30, 30, 30] },
        { key: '1.2', prepSeconds: [0, 0, 0], responseSeconds: [45, 30, 30] },
        { key: '2', prepSeconds: [60], responseSeconds: [120] },
        { key: '3', prepSeconds: [60], responseSeconds: [120] },
      ],
    });
  });

  it.each([undefined, null, 'HISTORICAL_PROFILE'])('does not replace historical profile %s with a product profile', (version) => {
    expect(speakingProfileTiming(version, 0, 0)).toBeUndefined();
    // Without a product profile the immutable blueprint of the attempt's own
    // revision decides: current revision answers immediately...
    expect(taskGuidance('speaking', 0, 0, version)).toMatchObject({ prepSeconds: 0, responseSeconds: 30 });
    expect(taskGuidance('speaking', 1, 0, version)).toMatchObject({ prepSeconds: 0, responseSeconds: 45 });
    // ...while revision 1 keeps its historical preparation.
    expect(taskGuidance('speaking', 1, 0, version, MULTILEVEL_VERSION_V1)).toMatchObject({ prepSeconds: 15, responseSeconds: 45 });
  });
});
