"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { PreviewGroup } from "./StudentPreview";
import { clusterDisplayPassages } from "./reading-preview-model";
import { ReadingPassagePanel } from "./reading-passage-panel";
import { ReadingTaskGroup } from "./reading-task-group";
import { PreviewBottomNavigation } from "./preview-bottom-navigation";
import { PreviewStaticHtml } from "./preview-static-html";

const MIN_SPLIT = 30;
const MAX_SPLIT = 70;

/**
 * Full-screen Reading workspace: passage panel + question panel above a
 * fixed bottom navigation. Preview-only — answers stay in local state,
 * nothing is saved or submitted.
 */
export function ReadingPreviewShell({ groups }: { groups: PreviewGroup[] }) {
  const passages = React.useMemo(() => clusterDisplayPassages(groups), [groups]);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = React.useState(passages[0]?.key ?? "");
  const [activeQuestionId, setActiveQuestionId] = React.useState<string | null>(null);
  const [mobileTab, setMobileTab] = React.useState<"passage" | "questions">("passage");
  const [splitPct, setSplitPct] = React.useState(50);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const leftPanelRef = React.useRef<HTMLDivElement | null>(null);
  const rightPanelRef = React.useRef<HTMLElement | null>(null);
  const draggingRef = React.useRef(false);

  const groupsKey = groups.map((g) => g.id).join("|");
  const [prevKey, setPrevKey] = React.useState(groupsKey);
  if (prevKey !== groupsKey) {
    setPrevKey(groupsKey);
    setAnswers({});
    setActiveKey(passages[0]?.key ?? "");
    setActiveQuestionId(null);
    setMobileTab("passage");
  }

  const active = passages.find((p) => p.key === activeKey) ?? passages[0];
  if (!active) return null;

  function setAnswer(qid: string, val: string) {
    setAnswers((a) => ({ ...a, [qid]: val }));
  }

  function scrollToQuestion(questionId: string) {
    requestAnimationFrame(() => {
      const el =
        document.getElementById(`preview-q-${questionId}`) ??
        document.getElementById(`preview-gap-${questionId}`);
      el?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }

  function selectPassage(key: string) {
    setActiveKey(key);
    setActiveQuestionId(null);
    leftPanelRef.current?.scrollTo({ top: 0, behavior: "auto" });
    rightPanelRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }

  function selectQuestion(questionId: string) {
    setActiveQuestionId(questionId);
    if (window.matchMedia("(max-width: 767px)").matches) {
      setMobileTab("questions");
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToQuestion(questionId)));
      return;
    }
    scrollToQuestion(questionId);
  }

  function pctFromClientX(clientX: number): number | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ((clientX - rect.left) / rect.width) * 100));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-fg">
      {/* Mobile Passage / Questions switch */}
      <div className="shrink-0 border-b border-border px-3 pt-2 md:hidden">
        <div className="grid grid-cols-2 gap-1" role="tablist" aria-label="Reading preview panels">
          {(["passage", "questions"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mobileTab === tab}
              onClick={() => setMobileTab(tab)}
              className={cn(
                "min-h-11 rounded-t-field px-3 text-sm font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                mobileTab === tab ? "bg-surface text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {tab === "passage" ? "Passage" : "Questions"}
            </button>
          ))}
        </div>
      </div>

      {/* Panels */}
      <div
        ref={containerRef}
        style={{ "--split": `${splitPct}%` } as React.CSSProperties}
        className="flex min-h-0 flex-1"
      >
        {/* Left: passage */}
        <div
          className={cn(
            "min-h-0 max-md:w-full md:w-[calc(var(--split)-8px)]",
            mobileTab !== "passage" && "max-md:hidden",
          )}
        >
          <div
            ref={leftPanelRef}
            className="h-full overflow-y-auto overscroll-contain px-5 py-4 md:px-8"
          >
            <ReadingPassagePanel
              passage={active}
              staticDocs={active.staticDocs}
              labelledBy={`reading-passage-title-${active.key}`}
            />
          </div>
        </div>

        {/* Resizable divider */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize passage and question panels"
          aria-valuenow={Math.round(splitPct)}
          aria-valuemin={MIN_SPLIT}
          aria-valuemax={MAX_SPLIT}
          tabIndex={0}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            const pct = pctFromClientX(e.clientX);
            if (pct != null) setSplitPct(pct);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setSplitPct((v) =>
                Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, v + (e.key === "ArrowRight" ? 2 : -2))),
              );
            } else if (e.key === "Home") {
              e.preventDefault();
              setSplitPct(MIN_SPLIT);
            } else if (e.key === "End") {
              e.preventDefault();
              setSplitPct(MAX_SPLIT);
            }
          }}
          className="hidden w-4 shrink-0 cursor-col-resize items-stretch justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand md:flex"
        >
          <div aria-hidden="true" className="w-px bg-border" />
        </div>

        {/* Right: task groups */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            mobileTab !== "questions" && "max-md:hidden",
          )}
        >
          <section
            ref={rightPanelRef}
            aria-label={`Questions for passage ${active.ordinal}`}
            className="h-full overflow-y-auto overscroll-contain px-5 py-4 md:px-8"
          >
            {active.passageText?.trim() && active.staticDocs.length > 0 && (
              <div className="mb-6 space-y-3">
                {active.staticDocs.map((doc) => (
                  <PreviewStaticHtml key={doc.groupId} html={doc.staticHtml} />
                ))}
              </div>
            )}
            {active.blocks.map((block, i) => (
              <React.Fragment key={block.key}>
                {i > 0 && <div aria-hidden="true" className="my-6 h-px bg-border" />}
                <ReadingTaskGroup block={block} answers={answers} onAnswer={setAnswer} />
              </React.Fragment>
            ))}
            {active.blocks.length === 0 && (
              <p className="text-sm text-fg-muted">No questions yet.</p>
            )}
          </section>
        </div>
      </div>

      <PreviewBottomNavigation
        passages={passages}
        activeKey={active.key}
        activeQuestionId={activeQuestionId}
        answers={answers}
        onSelectPassage={selectPassage}
        onSelectQuestion={selectQuestion}
      />
    </div>
  );
}
