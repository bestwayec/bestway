export interface ContentGroup {
  id?: string;
  title?: string | null;
  passageText?: string | null;
  stimulusRef?: string | null;
  partNumber?: number | null;
  hasAudio?: boolean;
}

export interface ContentUnit<T extends ContentGroup> {
  key: string;
  number: number;
  source: T;
  groups: T[];
}

export function examContentUnits<T extends ContentGroup>(
  groups: readonly T[],
  skill: string,
  canonicalListening = true,
): ContentUnit<T>[] {
  const units: ContentUnit<T>[] = [];
  const explicit = new Map<string, ContentUnit<T>>();
  let previousText = "";
  for (const [index, group] of groups.entries()) {
    const ref = skill === "reading" ? group.stimulusRef :
      skill === "listening" && canonicalListening && group.partNumber ? String(group.partNumber) : null;
    const text = skill === "reading" && !ref ? (group.passageText ?? "").trim().replace(/\s+/g, " ") : "";
    let unit = ref ? explicit.get(ref) : text && text === previousText ? units.at(-1) : undefined;
    if (!unit) {
      unit = { key: ref ? `${skill}:${ref}` : group.id ?? String(index), number: units.length + 1, source: group, groups: [] };
      units.push(unit);
      if (ref) explicit.set(ref, unit);
    }
    unit.groups.push(group);
    if (skill === "reading" && !unit.source.passageText?.trim() && group.passageText?.trim()) unit.source = group;
    if (skill === "listening" && !unit.source.hasAudio && group.hasAudio) unit.source = group;
    previousText = text;
  }
  if (skill === "listening" && canonicalListening && units.every((unit) => unit.source.partNumber)) {
    units.sort((a, b) => a.source.partNumber! - b.source.partNumber!);
  }
  return units.map((unit, index) => ({
    ...unit,
    number: skill === "listening" ? unit.source.partNumber ?? index + 1 : index + 1,
  }));
}
