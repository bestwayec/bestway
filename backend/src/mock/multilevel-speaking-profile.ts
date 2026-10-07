/**
 * BestWay product timings, independently versioned from the UZBMB blueprint.
 *
 * V2 is historical: it added a short product preparation to Speaking Parts 1.1
 * and 1.2 on top of the blueprint. V3 is current and removes preparation from
 * both, so the response itself starts immediately. Both profiles are frozen —
 * an attempt keeps the profile it was created with.
 */
export interface MultilevelSpeakingProfile {
  version: string;
  isOfficialTiming: boolean;
  parts: ReadonlyArray<{ key: string; prepSeconds: readonly number[]; responseSeconds: readonly number[] }>;
}

export const BESTWAY_MULTILEVEL_SPEAKING_2026_V2 = 'BESTWAY_MULTILEVEL_SPEAKING_2026_V2';
export const MULTILEVEL_SPEAKING_V2: MultilevelSpeakingProfile = Object.freeze({
  version: BESTWAY_MULTILEVEL_SPEAKING_2026_V2,
  isOfficialTiming: false,
  parts: [
    { key: '1.1', prepSeconds: [5, 5, 5], responseSeconds: [30, 30, 30] },
    { key: '1.2', prepSeconds: [10, 5, 5], responseSeconds: [45, 30, 30] },
    { key: '2', prepSeconds: [60], responseSeconds: [120] },
    { key: '3', prepSeconds: [60], responseSeconds: [120] },
  ],
});

export const BESTWAY_MULTILEVEL_SPEAKING_2026_V3 = 'BESTWAY_MULTILEVEL_SPEAKING_2026_V3';
export const MULTILEVEL_SPEAKING_V3: MultilevelSpeakingProfile = Object.freeze({
  version: BESTWAY_MULTILEVEL_SPEAKING_2026_V3,
  isOfficialTiming: false,
  parts: [
    { key: '1.1', prepSeconds: [0, 0, 0], responseSeconds: [30, 30, 30] },
    { key: '1.2', prepSeconds: [0, 0, 0], responseSeconds: [45, 30, 30] },
    { key: '2', prepSeconds: [60], responseSeconds: [120] },
    { key: '3', prepSeconds: [60], responseSeconds: [120] },
  ],
});

/** Profile newly created / cloned / imported Multilevel exams receive. */
export const BESTWAY_MULTILEVEL_CURRENT_SPEAKING_PROFILE = BESTWAY_MULTILEVEL_SPEAKING_2026_V3;

export const MULTILEVEL_SPEAKING_PROFILES: Readonly<Record<string, MultilevelSpeakingProfile>> = Object.freeze({
  [BESTWAY_MULTILEVEL_SPEAKING_2026_V2]: MULTILEVEL_SPEAKING_V2,
  [BESTWAY_MULTILEVEL_SPEAKING_2026_V3]: MULTILEVEL_SPEAKING_V3,
});

/** Product profile for a stored version, or `undefined` when unrecognised. */
export function multilevelSpeakingProfile(version: string | null | undefined): MultilevelSpeakingProfile | undefined {
  if (typeof version !== 'string') return undefined;
  return MULTILEVEL_SPEAKING_PROFILES[version];
}

/**
 * Profiles that gate each speaking response behind the previous response's
 * upload acknowledgement. Both product profiles enforce it, so a supported
 * attempt never loses that ordering guarantee when the profile version moves.
 */
export function speakingProfileRequiresUploadAck(version: string | null | undefined): boolean {
  return multilevelSpeakingProfile(version) !== undefined;
}

export function speakingProfileTiming(version: string | null | undefined, partIndex: number, questionIndex: number) {
  const profile = multilevelSpeakingProfile(version);
  if (!profile) return undefined;
  const part = profile.parts[partIndex];
  return part && { prepSeconds: part.prepSeconds[questionIndex], responseSeconds: part.responseSeconds[questionIndex] };
}
