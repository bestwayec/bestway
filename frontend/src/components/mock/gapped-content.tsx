"use client";

import * as React from "react";
import parse, { Element } from "html-react-parser";
import sanitizeHtml from "sanitize-html";
import { cn } from "@/lib/utils";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td", "h3", "h4", "span",
];

export interface GappedQuestionRef {
  id: string;
  number: number;
  prompt: string;
}

export interface GappedSlot<Question extends GappedQuestionRef = GappedQuestionRef> {
  number: number;
  question: Question | null;
}

export function hasGappedDocument(contentHtml: string | null | undefined): contentHtml is string {
  return !!contentHtml?.trim();
}

/** Defense in depth: never trust stored HTML at the rendering boundary. */
export function sanitizeGappedContent(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { span: ["data-gap"] },
    allowedSchemes: [],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      span: (_tagName, attributes): sanitizeHtml.Tag => {
        const raw = attributes["data-gap"];
        const number = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
        return number >= 1 && number <= 200
          ? { tagName: "span", attribs: { "data-gap": String(number) } }
          : { tagName: "span", attribs: {} };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "span" && !frame.attribs["data-gap"],
  });
}

/**
 * Shared rich document renderer. The caller owns the slot UI, so the exact
 * same sanitized document can host student inputs, preview inputs or builder
 * markers without duplicating document parsing.
 */
export function GappedContent<Question extends GappedQuestionRef>({
  contentHtml,
  questions,
  renderGap,
  className,
}: {
  contentHtml: string;
  questions: Question[];
  renderGap: (slot: GappedSlot<Question>) => React.ReactNode;
  className?: string;
}) {
  const byNumber = React.useMemo(
    () => new Map(questions.map((question) => [question.number, question])),
    [questions],
  );
  const safeHtml = React.useMemo(() => sanitizeGappedContent(contentHtml), [contentHtml]);

  return (
    <div
      className={cn(
        "gapped-content min-w-0 text-sm leading-relaxed text-fg",
        "[&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mb-2 [&_h4]:font-semibold",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_table]:w-full",
        "[&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border",
        "[&_th]:border-border [&_th]:bg-bg-subtle [&_th]:p-2 [&_th]:text-left [&_ul]:my-2",
        "[&_ul]:list-disc [&_ul]:pl-6",
        className,
      )}
    >
      {parse(safeHtml, {
        replace(node) {
          if (!(node instanceof Element) || node.name !== "span") return undefined;
          const raw = node.attribs?.["data-gap"];
          if (!raw || !/^\d{1,3}$/.test(raw)) return undefined;
          const number = Number(raw);
          return <React.Fragment key={`gap-${number}`}>{renderGap({ number, question: byNumber.get(number) ?? null })}</React.Fragment>;
        },
      })}
    </div>
  );
}
