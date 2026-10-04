/** BestWay product timings, independently versioned from the UZBMB blueprint. */
export const BESTWAY_MULTILEVEL_SPEAKING_2026_V2 = 'BESTWAY_MULTILEVEL_SPEAKING_2026_V2';
export const MULTILEVEL_SPEAKING_V2 = Object.freeze({
  version: BESTWAY_MULTILEVEL_SPEAKING_2026_V2,
  isOfficialTiming: false,
  parts: [
    { key: '1.1', prepSeconds: [5, 5, 5], responseSeconds: [30, 30, 30] },
    { key: '1.2', prepSeconds: [10, 5, 5], responseSeconds: [45, 30, 30] },
    { key: '2', prepSeconds: [60], responseSeconds: [120] },
    { key: '3', prepSeconds: [60], responseSeconds: [120] },
  ],
});

export function speakingProfileTiming(version: string | null | undefined, partIndex: number, questionIndex: number) {
  if (version !== BESTWAY_MULTILEVEL_SPEAKING_2026_V2) return undefined;
  const part = MULTILEVEL_SPEAKING_V2.parts[partIndex];
  return part && { prepSeconds: part.prepSeconds[questionIndex], responseSeconds: part.responseSeconds[questionIndex] };
}
