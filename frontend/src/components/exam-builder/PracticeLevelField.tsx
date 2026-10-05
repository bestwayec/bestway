"use client";

import { Field } from "@/components/ui/input";
import type { PracticeLevel } from "@/lib/types";

export function PracticeLevelField({ value, onChange }: { value: PracticeLevel | null; onChange: (value: PracticeLevel | null) => void }) {
  return <Field label="Practice content level" hint="A learning level for practice content. Full mock estimated results remain Below B1 / B1 / B2 / C1."><select aria-label="Practice content level" className="min-h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-fg" value={value ?? ""} onChange={(event) => onChange((event.target.value || null) as PracticeLevel | null)}><option value="">Not specified</option>{["A1", "A2", "B1", "B2", "C1"].map((level) => <option key={level}>{level}</option>)}</select></Field>;
}
