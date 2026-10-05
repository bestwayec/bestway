"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import type { BuilderPart } from "@/components/mock/exam-builder/types";
import type { MockQuestionType, MockSkill } from "@/lib/types";
import { applyFormatPreset, applySharedOptionBank, gapHtmlToText, gapTextToHtml, presetForPart, QUESTION_FORMAT_PRESETS, type QuestionFormatPreset } from "./question-format-model";

const selectClass = "min-h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-fg";

/** Small typed authoring controls shared by Reading and Listening editors. */
export function QuestionGroupSettings({ part, skill, allowedTypes, onChange, onPreset, selectedPreset }: {
  part: BuilderPart;
  skill: MockSkill;
  allowedTypes: MockQuestionType[];
  onChange: (part: BuilderPart) => void;
  onPreset: (preset: QuestionFormatPreset) => void;
  selectedPreset?: QuestionFormatPreset;
}) {
  const preset = selectedPreset ?? presetForPart(part);
  const matching = part.questions.some((q) => ["matching", "matching_headings", "map_labelling"].includes(q.type));
  const completion = part.questions.some((q) => ["short_answer", "note_completion", "sentence_completion", "summary_completion", "table_completion"].includes(q.type));
  const [bank, setBank] = React.useState(() => part.questions.find((q) => ["matching", "matching_headings", "map_labelling"].includes(q.type))?.options.join("\n") ?? "");
  const [gapText, setGapText] = React.useState(() => gapHtmlToText(part.contentHtml));
  return (
    <div className="space-y-3 rounded-[8px] border border-border p-3">
      <Field label="Question group format" hint="Choose the interaction for new questions. Existing questions keep their content and type.">
        <select className={selectClass} aria-label="Question group format" value={preset?.key ?? ""} onChange={(event) => {
          const next = QUESTION_FORMAT_PRESETS.find((item) => item.key === event.target.value);
          if (next) { onChange(applyFormatPreset(part, next)); onPreset(next); }
        }}>
          <option value="">Choose a format</option>
          {QUESTION_FORMAT_PRESETS.filter((p) => allowedTypes.includes(p.type) && (skill === "listening" || !["speakers", "multi_extract"].includes(p.key))).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </Field>
      {part.contentLayout === "multi_extract" && <p className="text-xs text-fg-muted">This block is one extract with its own audio. Add another block for each further extract and its questions.</p>}
      {matching && (
        <>
          <Field label="Shared option bank" hint="One option per line, including its label (for example A. Green Park). Extra distractors are allowed. Mappings are chosen in each question.">
            <Textarea aria-label="Shared option bank" value={bank} onChange={(event) => setBank(event.target.value)} className="min-h-24" />
          </Field>
          <Button size="sm" variant="outline" onClick={() => onChange({ ...part, questions: applySharedOptionBank(part.questions, bank.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) })}>Apply bank to matching questions</Button>
          <Field label="Option use rule">
            <select className={selectClass} aria-label="Option use rule" value={part.optionsReusable == null ? "legacy" : part.optionsReusable ? "reusable" : "once"} onChange={(event) => onChange({ ...part, optionsReusable: event.target.value === "legacy" ? null : event.target.value === "reusable" })}>
              <option value="legacy">Keep existing behavior</option><option value="once">Use each option once</option><option value="reusable">Options may be reused</option>
            </select>
          </Field>
        </>
      )}
      {(completion || part.contentHtml) && (
        <Field label="Numbered gap context" hint="Use {1}, {2}, etc. for question numbers. Notes and sentences render with inline inputs. Leave blank to show the question prompts alone.">
          <Textarea aria-label="Numbered gap context" value={gapText} onChange={(event) => { setGapText(event.target.value); onChange({ ...part, contentHtml: gapTextToHtml(event.target.value) }); }} className="min-h-28" />
        </Field>
      )}
      <p className="text-xs text-fg-muted">Incomplete content can be saved as a draft. Publish checks the question count, media and answer mappings.</p>
    </div>
  );
}
