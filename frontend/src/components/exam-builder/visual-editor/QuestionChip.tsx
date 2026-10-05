"use client";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { QTYPE_LABEL } from "@/components/mock/exam-builder/types";

const GROUP_COLOR: Record<string, string> = {
  Choice: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  "Fill in": "bg-green-500/15 text-green-700 border-green-500/30",
  Match: "bg-purple-500/15 text-purple-700 border-purple-500/30",
  "Write / Speak": "bg-orange-500/15 text-orange-700 border-orange-500/30",
};

export function groupOfType(t: string): string {
  if (["multiple_choice", "multi_select", "true_false_notgiven", "yes_no_notgiven"].includes(t)) return "Choice";
  if (["sentence_completion", "note_completion", "summary_completion", "table_completion", "short_answer"].includes(t)) return "Fill in";
  if (["matching", "matching_headings", "map_labelling"].includes(t)) return "Match";
  return "Write / Speak";
}

export function QuestionChip(props: NodeViewProps) {
  const store = (props.editor.storage as { visual?: {
    getNumber: (id: string) => number;
    isIncomplete: (id: string) => boolean;
    openDrawer: (id: string) => void;
    deleteNode: (id: string) => void;
  } }).visual;
  const clientId = (props.node.attrs.clientId ?? "") as string;
  const questionType = (props.node.attrs.questionType ?? "multiple_choice") as string;
  const number = store?.getNumber(clientId) ?? 0;
  const incomplete = store?.isIncomplete(clientId) ?? true;
  const label = (QTYPE_LABEL as Record<string, string>)[questionType] ?? questionType;
  const color = GROUP_COLOR[groupOfType(questionType)] ?? GROUP_COLOR.Choice;

  return (
    <NodeViewWrapper>
      <span
        role="button"
        tabIndex={0}
        aria-label={`Question ${number} — ${label} — ${incomplete ? "incomplete" : "complete"}`}
        data-question-node=""
        data-client-id={clientId}
        onClick={() => store?.openDrawer(clientId)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); store?.openDrawer(clientId); } }}
        className={`mx-0.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border px-2 py-1 align-baseline text-xs font-medium sm:py-0.5 ${color}`}
      >
        <span aria-hidden className="shrink-0 tabular-nums">#{number}</span>
        <span className="min-w-0 truncate">{label}</span>
        {incomplete && <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full bg-red-500" />}
        <button
          type="button"
          aria-label={`Delete question ${number}`}
          className="ml-0.5 min-h-6 min-w-6 shrink-0 rounded-full px-1 opacity-60 hover:opacity-100 sm:min-h-0 sm:min-w-0"
          onClick={(e) => { e.stopPropagation(); store?.deleteNode(clientId); }}
        >
          ×
        </button>
      </span>
    </NodeViewWrapper>
  );
}
