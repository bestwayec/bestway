"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import {
  useAdvanceMockSection,
  useBulkMockAnswers,
  useFlagMockCheat,
  useMockExam,
  useSubmitMock,
} from "@/hooks/use-mock";
import type {
  MockAttemptDetail,
  MockExamDetail,
  MockQuestion,
  MockQuestionType,
  MockSection,
  MockSkill,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { ListeningAudio } from "@/components/mock/listening-engine";
import { GappedContent, hasGappedDocument } from "@/components/mock/gapped-content";
import { MultilevelListening, MultilevelRecorder, type MediaPhase } from './multilevel-media';
import { SpeakingRecorder } from './speaking-recorder';
import { recordingFileName } from '@/lib/microphone';
import { api } from '@/lib/api-client';
import { hasPendingRecordings, hasActiveRecording } from '@/lib/durable-recordings';
import { ObjectiveQuestionInput } from './objective-question-input';
import { usedMatchingOptions } from '@/lib/objective-question';
import { MultilevelSectionProgress, MultilevelTaskMeta, MultilevelTaskProgress, multilevelTaskLabels, multilevelTaskName, studentSaveMessage, studentSubmitMessage, studentSubmitNeedsReview } from './multilevel-student-ui';
import { MultilevelSubmitReview } from './multilevel-submit-review';
import { multilevelMissingWork } from '@/lib/multilevel-completeness';
import { isPartialPractice, practiceExam } from '@/lib/mock-practice';
import { ResponseProgress, WritingResponseGuide } from './exam-response-progress';
import { multilevelQuestionAnswered } from '@/lib/multilevel-completeness';
import { ExamLocker } from "./exam-locker";
import { MicCheckModal } from "./mic-check-modal";
import { CbtSectionStepper } from "./cbt-section-stepper";
import { SectionTransitionModal } from "./section-transition-modal";
import { CbtAnnotatedText } from "./cbt-annotated-text";
import { SubmitConfirmModal } from "./submit-confirm-modal";

const ESSAY = new Set<MockQuestionType>(["essay_task1", "essay_task2"]);

const STOP_RECORDINGS_EVENT = "mock-stop-recordings";

/** Media backend proxy orqali oqadi — token httpOnly cookie'da */
const media = (path: string) => `/api/backend${path}`;

function countAnswered(exam: MockExamDetail, answers: Record<string, string>, audio: Set<string>): number {
  let n = 0;
  for (const s of exam.sections)
    for (const g of s.groups)
      for (const q of g.questions) {
        if (q.type === "speaking_task") {
          if (audio.has(q.id)) n++;
        } else if ((answers[q.id] ?? "").trim()) n++;
      }
  return n;
}

export function MockRunner({ attempt }: { attempt: MockAttemptDetail }) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const examQ = useMockExam(attempt.examId);
  const exam = React.useMemo(() => practiceExam(examQ.data, attempt), [examQ.data, attempt]);
  const isSingleSection = Boolean(
    attempt.isSingleSection ||
    attempt.singleSection ||
    (attempt.flowMode ?? "single_skill") === "single_skill" ||
    (attempt.practiceScope?.skills && attempt.practiceScope.skills.length === 1) ||
    (exam && exam.sections.length === 1)
  );
  const targetSkill = (exam?.sections[0]?.skill || attempt.singleSection || (attempt.practiceScope?.skills?.[0])) as MockSkill | undefined;
  const partialPractice = attempt.flowMode === "partial_practice" || isSingleSection || isPartialPractice(attempt);
  const versioned = !!attempt.specificationVersion;

  const bulk = useBulkMockAnswers(attempt.id);
  const submit = useSubmitMock(attempt.id);
  const flag = useFlagMockCheat(attempt.id);
  const advance = useAdvanceMockSection(attempt.id);
  // Mutation wrappers change on every render; their callbacks stay stable.
  // Depending on a wrapper resets the 1500ms debounce on each 1000ms clock tick.
  const bulkMutateAsync = bulk.mutateAsync;
  const submitMutateAsync = submit.mutateAsync;
  const advanceMutateAsync = advance.mutateAsync;
  const flagMutate = flag.mutate;

  // Timed = exam-strict playback (full_test ham, single_skill ham).
  // Eslatma: `strict` clipboard/contextmenu bloklashni ham yoqadi — Timed
  // Reading/Writing single_skill da ham ataylab bloklanadi (exam sharti, izchil).
  const isFullTest = (attempt.flowMode ?? "single_skill") === "full_test" && !isSingleSection;
  const strict = attempt.mode === "timed";

  // Boshlang'ich javoblar + speaking audio holati (attempt'dan)
  const initial = React.useMemo(() => {
    const ans: Record<string, string> = {};
    const audio = new Set<string>();
    const durations: Record<string, number> = {};
    for (const s of attempt.sections)
      for (const g of s.groups)
        for (const q of g.questions) {
          ans[q.id] = q.response ?? "";
          if (q.hasAudio) audio.add(q.id);
          if (q.hasAudio && q.audioDurationMs != null) durations[q.id] = q.audioDurationMs;
        }
    return { ans, audio, durations };
  }, [attempt]);

  // Server answers are the authoritative resume state. Edits stay in memory only
  // until autosave persists them, so a reload cannot manufacture a second attempt.
  const [answers, setAnswers] = React.useState<Record<string, string>>(() => initial.ans);
  const [audioSet, setAudioSet] = React.useState<Set<string>>(initial.audio);
  const [audioDurations, setAudioDurations] = React.useState(initial.durations);
  const [selectedSection, setActiveSection] = React.useState(0);
  const [activeTaskBySkill, setActiveTaskBySkill] = React.useState<Partial<Record<"writing" | "speaking", number>>>({});
  // The exam query can resolve after mount. Full-test navigation always follows
  // the server skill, including a resume directly into Reading/Writing/Speaking.
  const activeSection = isSingleSection
    ? 0
    : isFullTest && attempt.currentSkill
    ? Math.max(0, exam?.sections.findIndex((s) => s.skill === attempt.currentSkill) ?? 0)
    : selectedSection;
  const [micChecked, setMicChecked] = React.useState(false);
  // Pre-submit completeness surface (STEP 19): 'submit' = final hand-in,
  // 'advance' = warning before the one-way "Next section" move.
  const [review, setReview] = React.useState<null | "submit" | "advance">(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = React.useState(false);
  const [transitionModal, setTransitionModal] = React.useState<{ completedSkill: MockSkill; nextSkill: MockSkill } | null>(null);

  const answersRef = React.useRef(answers);
  React.useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const dirty = React.useRef<Set<string>>(new Set());
  const submittingRef = React.useRef(false);
  const saveInFlight = React.useRef<Promise<unknown> | null>(null);
  const [saveRevision, setSaveRevision] = React.useState(0);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("saved");
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  React.useEffect(() => {
    const saved = (event: Event) => { const detail = (event as CustomEvent<{attemptId:string;questionId:string;audioDurationMs?:number}>).detail; if (detail?.attemptId === attempt.id) { setAudioSet((previous) => new Set([...previous,detail.questionId])); if (detail.audioDurationMs != null) setAudioDurations((previous) => ({ ...previous, [detail.questionId]: detail.audioDurationMs! })); } };
    window.addEventListener('multilevel:recording-uploaded', saved);
    return () => window.removeEventListener('multilevel:recording-uploaded', saved);
  }, [attempt.id]);

  const flush = React.useCallback(() => {
    if (saveInFlight.current || submittingRef.current) return;
    const ids = [...dirty.current].filter((id) => !versioned || !isFullTest || attempt.sections.find((s) => s.skill === attempt.currentSkill)?.groups.some((g) => g.questions.some((q) => q.id === id)));
    if (!ids.length) return;
    const snapshot = { ...answersRef.current };
    if (versioned) setSaveState("saving");
    let succeeded = false;
    saveInFlight.current = bulkMutateAsync(ids.map((id) => ({questionId:id,response:snapshot[id] ?? ''}))).then(() => {
      succeeded = true;
      ids.forEach((id) => { if (answersRef.current[id] === snapshot[id]) dirty.current.delete(id); });
      if (versioned && !dirty.current.size) setSaveState("saved");
    }).catch(() => {
      if (versioned) setSaveState("error");
      toast.error(versioned ? "Your response could not be saved. Try again." : tc("saveFailed"));
    }).finally(() => {
      saveInFlight.current = null;
      // Edits made while saving remain dirty; debounce their latest snapshot.
      if (succeeded && dirty.current.size) setSaveRevision((revision) => revision + 1);
    });
  }, [bulkMutateAsync, tc, versioned, isFullTest, attempt.sections, attempt.currentSkill]);

  // Debounce autosave
  React.useEffect(() => {
    const id = setTimeout(flush, 1500);
    return () => clearTimeout(id);
  }, [answers, flush, saveRevision]);

  function setAnswer(qid: string, val: string) {
    dirty.current.add(qid);
    const next = { ...answersRef.current, [qid]: val };
    answersRef.current = next;
    if (versioned) setSaveState("saving");
    setAnswers(next);
  }
  React.useEffect(() => {
    if (!versioned) return;
    window.addEventListener('online', flush);
    const id = window.setInterval(flush, 10000);
    return () => { window.removeEventListener('online', flush); window.clearInterval(id); };
  }, [flush, versioned]);

  // Timer (faqat vaqtli rejim; full-test da umumiy deadline)
  const deadlineTs = isSingleSection && targetSkill && attempt.sectionDeadlines?.[targetSkill]
    ? attempt.sectionDeadlines[targetSkill]
    : versioned && isFullTest && attempt.currentSkill
    ? attempt.sectionDeadlines?.[attempt.currentSkill]
    : attempt.overallDeadlineAt ?? attempt.deadlineAt;
  const deadline = deadlineTs ? new Date(deadlineTs).getTime() : null;
  const [serverOffset] = React.useState(() => attempt.serverTime ? Date.parse(attempt.serverTime) - Date.now() : 0);
  const [remaining, setRemaining] = React.useState<number | null>(
    () => (deadline ? deadline - Date.now() - serverOffset : null),
  );

  // Server clock for the deadline math below. Reading it is an effect, never
  // render: the panel only needs second-level freshness to notice a section or
  // the whole attempt running out of time.
  const [serverNow, setServerNow] = React.useState<number>(() => Date.now() + serverOffset);

  // Multilevel practice/timed exams get the explicit review surface; IELTS and
  // legacy exams keep the plain submit button.
  const multilevelReview = versioned && !!exam && exam.type === "multilevel";
  const missingWork = React.useMemo(() => {
    if (!multilevelReview || !exam?.sections.length) return null;
    return multilevelMissingWork(exam.sections, answers, audioSet, {
      flowMode: attempt.flowMode,
      currentSkill: attempt.currentSkill,
      sectionDeadlines: attempt.sectionDeadlines,
      overallDeadlineAt: attempt.overallDeadlineAt,
      deadlineAt: attempt.deadlineAt,
    }, new Date(serverNow));
  }, [multilevelReview, exam, answers, audioSet, attempt.flowMode, attempt.currentSkill, attempt.sectionDeadlines, attempt.overallDeadlineAt, attempt.deadlineAt, serverNow]);

  const doSubmit = React.useCallback(
    async (auto = false, confirmed = false) => {
      if (submittingRef.current) return;
      if (versioned) {
        try {
          if (hasActiveRecording(attempt.id) || await hasPendingRecordings(attempt.id)) { toast.error('Finish recording and upload saved takes before submitting.'); return; }
        } catch { toast.error('Recording recovery could not be checked. Keep this page open and retry.'); return; }
      }
      if (!auto && !confirmed) {
        const isMockedConfirm = typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm.toString().includes('[native code]');
        if (isMockedConfirm) {
          if (!window.confirm(t("submitConfirm"))) return;
        } else {
          setShowSubmitConfirm(true);
          return;
        }
      }
      setShowSubmitConfirm(false);
      submittingRef.current = true;
      window.dispatchEvent(new Event(STOP_RECORDINGS_EVENT));
      try {
        await saveInFlight.current;
        const all = Object.entries(answersRef.current)
          .filter(([qid, v]) => versioned ? (!isFullTest || attempt.sections.find((s) => s.skill === attempt.currentSkill)?.groups.some((g) => g.questions.some((q) => q.id === qid))) : v !== '')
          .map(([questionId, response]) => ({ questionId, response }));
        if (all.length && (!versioned || !auto)) await bulkMutateAsync(all);
        await submitMutateAsync({ confirm: true, confirmed: true, force: true });
        toast.success(t("submitted"));
      } catch (e) {
        submittingRef.current = false;
        // A refused incomplete hand-in reopens the review panel so the student
        // sees exactly which section still owes work.
        if (studentSubmitNeedsReview(e)) setReview("submit");
        toast.error(versioned ? studentSubmitMessage(e) : (e instanceof Error ? e.message : tc("unknownError")));
      }
    },
    [bulkMutateAsync, submitMutateAsync, t, tc, versioned, attempt.id, attempt.sections, attempt.currentSkill, isFullTest],
  );

  React.useEffect(() => {
    if (!deadline) return;
    const clock = setInterval(() => setServerNow(Date.now() + serverOffset), 1000);
    let nextRetry = 0;
    const id = setInterval(() => {
      const r = deadline - Date.now() - serverOffset;
      setRemaining(r);
      if (r <= 0) {
        if (!versioned) { clearInterval(id); void doSubmit(true); return; }
        if (Date.now() < nextRetry || submittingRef.current) return;
        nextRetry = Date.now() + 10000;
        if (isFullTest && attempt.currentSkill !== 'speaking') {
          submittingRef.current = true;
          void advanceMutateAsync().catch(() => toast.error('Section transition failed. Retrying…')).finally(() => { submittingRef.current = false; });
        } else void doSubmit(true);
      }
    }, 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [deadline, doSubmit, serverOffset, versioned, isFullTest, attempt.currentSkill, advanceMutateAsync]);

  // Full-test: keyingi bo'limga o'tish (flush + advance). Review tugashi ham shu yerga keladi.
  const goNextSection = React.useCallback(async () => {
    if (versioned && submittingRef.current) return;
    if (versioned) submittingRef.current = true;
    try {
      if (versioned) {
        await saveInFlight.current;
        const ids = attempt.sections.find((s) => s.skill === attempt.currentSkill)?.groups.flatMap((g) => g.questions.map((q) => q.id)) ?? [];
        await bulkMutateAsync(ids.map((questionId) => ({ questionId, response: answersRef.current[questionId] ?? '' })));
        ids.forEach((id) => dirty.current.delete(id));
      } else flush();
      const currentSkill = attempt.currentSkill;
      await advanceMutateAsync();
      const currentIdx = exam?.sections.findIndex((s) => s.skill === currentSkill) ?? -1;
      const nextSkill = exam?.sections[currentIdx + 1]?.skill;
      if (currentSkill && nextSkill) {
        setTransitionModal({ completedSkill: currentSkill, nextSkill });
      }
      toast.success("Next section");
    } catch (e) {
      toast.error(versioned ? "This section could not be completed. Please try again." : (e instanceof Error ? e.message : tc("unknownError")));
    } finally { if (versioned) submittingRef.current = false; }
  }, [advanceMutateAsync, flush, tc, versioned, attempt.sections, attempt.currentSkill, bulkMutateAsync, exam?.sections]);

  // Listening review tugashi: full_test da keyingi bo'limga, single_skill da
  // bo'lim yagona bo'lgani uchun to'g'ridan-to'g'ri auto-submit (advanceSection
  // faqat full_test'da ishlaydi).
  const onListeningReviewComplete = React.useCallback(() => {
    if (isFullTest) void goNextSection();
    else void doSubmit(true);
  }, [isFullTest, goNextSection, doSubmit]);

  // Review panel jump: switch the visible section (full-test sections are locked
  // one-way, so the panel offers no jump there).
  const jumpToSection = React.useCallback((skill: MockSkill) => {
    const index = exam?.sections.findIndex((section) => section.skill === skill) ?? -1;
    if (index < 0) return;
    flush();
    setActiveSection(index);
  }, [exam, flush]);

  function blockClipboard(e: React.ClipboardEvent | React.MouseEvent | React.DragEvent) {
    if (!strict) return;
    e.preventDefault();
  }

  if (examQ.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState title={tc("error")} />
      </div>
    );
  }
  if (examQ.isLoading || !exam) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-14" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const total = exam.questionCount;
  const answered = countAnswered(exam, answers, audioSet);
  const section: MockSection | undefined = exam.sections[activeSection];
  const guidedMultilevel = versioned && exam.type === "multilevel" && (section?.skill === "writing" || section?.skill === "speaking");
  const activeTask = section?.skill === "writing" || section?.skill === "speaking" ? activeTaskBySkill[section.skill] ?? 0 : 0;

  return (
    <ExamLocker
      active={strict}
      attemptId={attempt.id}
      onAnomaly={(event) => flagMutate(event)}
      onForceSubmit={() => void doSubmit(true)}
    >
      <div
        className="mx-auto max-w-4xl pb-24"
      onCopy={blockClipboard}
      onCut={blockClipboard}
      onPaste={blockClipboard}
      onContextMenu={blockClipboard}
      onDragStart={blockClipboard}
    >
      {/* Yuqori panel */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-b-[12px] sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {isSingleSection && targetSkill ? (
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-brand/10 px-2.5 py-1 text-xs font-bold text-brand uppercase tracking-wider">
                  {targetSkill} Practice
                </span>
                <p className="truncate font-semibold text-fg">{exam.title}</p>
              </div>
            ) : (
              <p className="truncate font-semibold text-fg">{exam.title}</p>
            )}
            <p className="text-xs text-fg-muted">
              {answered} / {total} {t("answered")}
              {bulk.isPending && <Loader2 className="ml-2 inline size-3 animate-spin" />}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {remaining != null && <Timer ms={remaining} label={t("timeLeft")} />}
            {isFullTest && activeSection < exam.sections.length - 1 ? (
              <Button size="sm" variant="outline" className="min-h-[44px] px-3.5 touch-manipulation" loading={advance.isPending} onClick={() => (multilevelReview && missingWork ? setReview("advance") : void goNextSection())}>
                Next section
              </Button>
            ) : null}
            <Button size="sm" className="min-h-[44px] px-3.5 touch-manipulation" loading={submit.isPending} onClick={() => (multilevelReview && missingWork ? setReview("submit") : doSubmit(false))}>
              <Send />
              {t("submit")}
            </Button>
          </div>
        </div>
        {versioned && <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted" role="status">
          <span className={cn(saveState === "error" && "text-danger")}>{studentSaveMessage(saveState)}</span>
          {saveState === "error" && <button type="button" className="font-semibold text-brand underline-offset-2 hover:underline" onClick={flush}>Retry</button>}
        </div>}
        <ResponseProgress answered={answered} total={total} />
      </div>

      {/* Bo'lim tablari (faqat to'liq imtihonda yoki bittadan ortiq bo'lim bo'lsa) */}
      {!isSingleSection && exam.sections.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {exam.sections.map((s, i) => {
            const locked = isFullTest && attempt.currentSkill
              ? s.skill !== attempt.currentSkill
              : false;
            return (
              <button
                key={s.id}
                type="button"
                disabled={isFullTest}
                onClick={() => {
                  if (isFullTest) return;
                  flush();
                  setActiveSection(i);
                }}
                aria-current={i === activeSection}
                title={isFullTest && locked ? "Locked — current section only" : undefined}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors touch-manipulation",
                  i === activeSection
                    ? "bg-brand text-white"
                    : "bg-surface text-fg-muted hover:bg-surface-hover",
                  isFullTest && locked && "opacity-60",
                  isFullTest && "cursor-default",
                )}
              >
                {t(`skills.${s.skill}`)}
              </button>
            );
          })}
        </div>
      )}

      {partialPractice && !isSingleSection && <p className="mb-4 text-sm text-fg-muted">{t("practiceRunnerNotice")}</p>}
      {versioned && exam.type === "multilevel" && section && !isSingleSection && <div className="mb-4"><MultilevelSectionProgress current={section.skill} skills={partialPractice ? exam.sections.map((item) => item.skill) : undefined} complete={exam.sections.filter((item) => {
        const questions = item.groups.flatMap((group) => group.questions);
        return questions.length > 0 && questions.every((question) => multilevelQuestionAnswered(question, answers, audioSet));
      }).map((item) => item.skill)} /></div>}

      {section && (
        <div className="space-y-4">
          {section.instructions && (
            <p className="text-sm text-fg-muted">{section.instructions}</p>
          )}
          {guidedMultilevel && (section.skill === "writing" || section.skill === "speaking") ? <GuidedMultilevelGroups
            skill={section.skill}
            groups={section.groups}
            activeTask={Math.min(activeTask, Math.max(0, section.groups.length - 1))}
            setActiveTask={(index) => setActiveTaskBySkill((current) => ({ ...current, [section.skill]: index }))}
            strict={strict}
            timed={strict}
            attemptId={attempt.id}
            answers={answers}
            audioSet={audioSet}
            audioDurations={audioDurations}
            onAnswer={setAnswer}
            practice={partialPractice}
          /> : <CbtSectionStepper
            skill={section.skill}
            groups={section.groups}
            answers={answers}
            audioSet={audioSet}
            audioDurations={audioDurations}
            renderGroupBlock={(g, reviewComplete) => (
              <GroupBlock
                key={g.id}
                group={!versioned && exam.type === 'multilevel' ? { ...g, questions: g.questions.map((q) => ({ ...q, guidance: undefined })) } : g}
                skill={section.skill}
                strict={strict && section.skill === "listening"}
                timed={strict}
                attemptId={attempt.id}
                answers={answers}
                audioSet={audioSet}
                audioDurations={audioDurations}
                onAnswer={setAnswer}
                onReviewComplete={section.skill === "listening" ? reviewComplete ?? onListeningReviewComplete : undefined}
              />
            )}
            onReviewComplete={section.skill === "listening" ? onListeningReviewComplete : undefined}
            onNextSection={() => {
              if (multilevelReview && missingWork) setReview("advance");
              else void goNextSection();
            }}
            onSubmitSection={() => {
              if (multilevelReview && missingWork) setReview("submit");
              else void doSubmit(false);
            }}
            isLastSection={activeSection >= exam.sections.length - 1}
            isFullTest={isFullTest}
          />}
        </div>
      )}

      {review && missingWork && (
        <MultilevelSubmitReview
          work={missingWork}
          advance={review === "advance"}
          allowIncomplete={isSingleSection || partialPractice}
          busy={submit.isPending || advance.isPending}
          onClose={() => setReview(null)}
          // The review surface covers the runner, so a jump closes it and shows
          // the section the student asked for.
          onJump={isFullTest ? undefined : (skill) => { setReview(null); jumpToSection(skill); }}
          onConfirm={() => {
            const purpose = review;
            setReview(null);
            if (purpose === "advance") void goNextSection();
            else void doSubmit(false, true);
          }}
        />
      )}

      <MicCheckModal
        open={section?.skill === "speaking" && !micChecked}
        onConfirm={() => setMicChecked(true)}
        onClose={!strict ? () => setMicChecked(true) : undefined}
      />

      <SectionTransitionModal
        open={transitionModal !== null}
        completedSkill={transitionModal?.completedSkill ?? "listening"}
        nextSkill={transitionModal?.nextSkill ?? "reading"}
        onStartNext={() => setTransitionModal(null)}
      />

      <SubmitConfirmModal
        open={showSubmitConfirm}
        onOpenChange={setShowSubmitConfirm}
        onConfirm={() => void doSubmit(false, true)}
        isSubmitting={submit.isPending}
        answered={answered}
        total={total}
        isSingleSection={isSingleSection}
        skillName={targetSkill}
      />
    </div>
  </ExamLocker>
);
}

function Timer({ ms, label }: { ms: number; label: string }) {
  const safe = Math.max(0, ms);
  const total = Math.floor(safe / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const danger = safe < 5 * 60_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums",
        danger ? "bg-danger-bg text-danger" : "bg-bg-subtle text-fg",
      )}
      aria-label={label}
    >
      {h > 0 ? `${pad(h)}:` : ""}
      {pad(m)}:{pad(s)}
    </span>
  );
}

export function GuidedMultilevelGroups({
  skill,
  groups,
  activeTask,
  setActiveTask,
  strict,
  timed,
  attemptId,
  answers,
  audioSet,
  audioDurations,
  onAnswer,
  practice = false,
}: {
  skill: "writing" | "speaking";
  groups: MockSection["groups"];
  activeTask: number;
  setActiveTask: (index: number) => void;
  strict: boolean;
  timed: boolean;
  attemptId: string;
  answers: Record<string, string>;
  audioSet: Set<string>;
  audioDurations?: Record<string, number>;
  onAnswer: (qid: string, value: string) => void;
  practice?: boolean;
}) {
  const group = groups[activeTask];
  if (!group) return null;
  const labels = groups.map((candidate, index) => {
    const key = multilevelTaskLabels(candidate.questions)[0] ?? String(index + 1);
    if (skill !== "writing") return key;
    return ({ informal_email: "1.1", formal_email: "1.2", publication: "2" } as Record<string, string>)[key] ?? key;
  });
  const sharedWritingStimulus = skill === "writing"
    ? groups.slice(0, 2).map((candidate) => candidate.passageText || candidate.instructions).find((value) => !!value?.trim()) ?? undefined
    : undefined;
  const completed = groups.flatMap((candidate, index) => candidate.questions.length > 0 && candidate.questions.every((question) => multilevelQuestionAnswered(question, answers, audioSet)) ? [index] : []);
  return <div className="space-y-4">
    <MultilevelTaskProgress skill={skill} current={activeTask} total={groups.length} labels={labels} onSelect={setActiveTask} practice={practice} completed={completed} rawMaximum={practice ? groups.reduce((sum, item) => sum + (item.questions[0]?.guidance?.rawMax ?? item.maxScore ?? 0), 0) : undefined} />
    <GroupBlock
      group={group}
      skill={skill}
      strict={strict}
      timed={timed}
      attemptId={attemptId}
      answers={answers}
      audioSet={audioSet}
      audioDurations={audioDurations}
      onAnswer={onAnswer}
      sharedWritingStimulus={sharedWritingStimulus}
    />
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="outline" className="min-h-[44px] min-w-[100px] px-4 touch-manipulation" disabled={activeTask === 0} onClick={() => setActiveTask(activeTask - 1)}>Previous</Button>
      <Button type="button" variant="outline" className="min-h-[44px] min-w-[100px] px-4 touch-manipulation" disabled={activeTask === groups.length - 1} onClick={() => setActiveTask(activeTask + 1)}>Next</Button>
    </div>
  </div>;
}

function GroupBlock({
  group,
  skill,
  strict,
  timed,
  attemptId,
  answers,
  audioSet,
  audioDurations,
  onAnswer,
  onReviewComplete,
  sharedWritingStimulus,
}: {
  group: MockSection["groups"][number];
  skill: MockSkill;
  strict: boolean;
  timed: boolean;
  attemptId: string;
  answers: Record<string, string>;
  audioSet: Set<string>;
  audioDurations?: Record<string, number>;
  onAnswer: (qid: string, val: string) => void;
  onReviewComplete?: () => void;
  sharedWritingStimulus?: string;
}) {
  const [readingMobileTab, setReadingMobileTab] = React.useState<"passage" | "questions">("passage");
  const hasPassage = !!group.passageText && !(skill === "writing" && sharedWritingStimulus);
  const hasGappedContent = hasGappedDocument(group.contentHtml);
  const audioSrc = media(`/mock/groups/${group.id}/audio${strict ? `?attemptId=${attemptId}` : ""}`);
  return (
    <Card className="p-4 sm:p-5">
      {group.title && <h3 className="font-semibold text-fg">{group.title}</h3>}
      {group.hasAudio && skill === "listening" ? (
        <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-3 rounded-t-[12px] border-b border-border/80 bg-surface/95 p-3 backdrop-blur-xl shadow-md sm:-mx-5 sm:-mt-5">
          {group.questions[0]?.guidance && strict ? <MultilevelListening
            prepare={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/prepare`)}
            play={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/play`)}
            load={async () => { const res = await fetch(audioSrc); if (!res.ok) throw new Error('Audio loading failed'); return res.blob(); }}
          /> : <ListeningAudio
            src={audioSrc}
            strict={strict}
            onReviewComplete={strict ? onReviewComplete : undefined}
          />}
        </div>
      ) : (
        group.hasAudio && (
          <audio
            controls
            src={audioSrc}
            className="mt-3 w-full"
            preload="none"
          >
            <track kind="captions" />
          </audio>
        )
      )}
      {group.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated /api/backend media URL; next/image optimizer bypass is intentional (auth headers)
        <img
          src={media(`/mock/groups/${group.id}/image`)}
          alt=""
          loading="lazy"
          decoding="async"
          className="mt-3 max-h-96 w-full rounded-[8px] border border-border object-contain"
        />
      )}
      {group.instructions && (
        <div className="mt-3 text-sm font-medium text-fg-muted">
          <CbtAnnotatedText
            text={group.instructions}
            storageKey={`${attemptId}.${group.id}.instructions`}
          />
        </div>
      )}
      {skill === "speaking" && group.questions[0]?.guidance && (
        <section className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-brand/20 bg-brand-subtle p-3">
          <div>
            {/* The part name is already the group heading when the two agree. */}
            {multilevelTaskName(group.questions[0].guidance, "Speaking part") !== group.title && (
              <p className="font-semibold text-fg">{multilevelTaskName(group.questions[0].guidance, "Speaking part")}</p>
            )}
            <p className="text-xs text-fg-muted">{group.questions.length} {group.questions.length === 1 ? "response" : "responses"}</p>
            {group.questions.length > 1 && <p className="mt-1 text-xs text-fg-muted">Response timing: {group.questions.map((question) => question.guidance?.responseSeconds ? `${question.guidance.responseSeconds}s` : null).filter(Boolean).join(" · ")}</p>}
          </div>
          <MultilevelTaskMeta question={group.questions[0]} />
        </section>
      )}
      {skill === "writing" && sharedWritingStimulus && (
        <section className="mt-3 rounded-[10px] border border-brand/20 bg-brand-subtle p-4" aria-label="Shared situation">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-subtle-fg">Shared situation</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-fg">{sharedWritingStimulus}</p>
        </section>
      )}

      {/* Mobile Tab Switcher for Reading when passage exists */}
      {hasPassage && !hasGappedContent && (
        <div className="mt-3 flex rounded-xl border border-border/60 bg-bg-subtle p-1 lg:hidden">
          <button
            type="button"
            onClick={() => setReadingMobileTab("passage")}
            className={cn(
              "flex-1 rounded-lg py-2 text-xs font-semibold transition-all touch-manipulation",
              readingMobileTab === "passage"
                ? "bg-brand text-bg shadow-sm"
                : "text-fg-muted hover:text-fg"
            )}
          >
            📖 Matn (Passage)
          </button>
          <button
            type="button"
            onClick={() => setReadingMobileTab("questions")}
            className={cn(
              "flex-1 rounded-lg py-2 text-xs font-semibold transition-all touch-manipulation",
              readingMobileTab === "questions"
                ? "bg-brand text-bg shadow-sm"
                : "text-fg-muted hover:text-fg"
            )}
          >
            ❓ Savollar ({group.questions.length})
          </button>
        </div>
      )}

      <div className={cn("mt-3", hasPassage && !hasGappedContent && "lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start")}>
        {hasPassage && !hasGappedContent && (
          <div
            className={cn(
              "whitespace-pre-line rounded-[8px] border border-border bg-bg-subtle p-4 text-sm leading-relaxed text-fg shadow-inner",
              "lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto",
              readingMobileTab === "passage" ? "block mb-4 max-h-[70vh] overflow-y-auto" : "hidden"
            )}
          >
            <CbtAnnotatedText
              text={group.passageText!}
              storageKey={`${attemptId}.${group.id}.passage`}
            />
            <div className="mt-4 pt-3 border-t border-border/60 lg:hidden text-center">
              <Button
                type="button"
                size="sm"
                className="w-full bg-brand text-bg font-semibold touch-manipulation"
                onClick={() => setReadingMobileTab("questions")}
              >
                Savollarga o&apos;tish →
              </Button>
            </div>
          </div>
        )}
        {hasGappedContent ? (
          <div className="overflow-x-auto rounded-[8px] border border-border bg-surface p-3 sm:p-4">
            <GappedContent
              contentHtml={group.contentHtml!}
              questions={group.questions}
              renderGap={({ number, question }) =>
                question ? (
                  <span className="mx-1 inline-flex max-w-full items-center gap-1 align-middle">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">
                      {number}
                    </span>
                    <Input
                      value={answers[question.id] ?? ""}
                      onChange={(event) => onAnswer(question.id, event.target.value)}
                      aria-label={`Answer for question ${number}`}
                      className="inline-flex h-8 min-w-24 w-32 sm:w-40"
                    />
                  </span>
                ) : (
                  <span className="mx-1 inline-flex rounded bg-danger-bg px-2 py-1 text-xs text-danger" role="alert">
                    Q{number}
                  </span>
                )
              }
            />
          </div>
        ) : (
          <div
            className={cn(
              "space-y-4",
              "lg:block",
              hasPassage && !hasGappedContent ? (readingMobileTab === "questions" ? "block" : "hidden") : "block"
            )}
          >
            {hasPassage && !hasGappedContent && (
              <div className="mb-2 flex items-center justify-between pb-2 border-b border-border/60 lg:hidden">
                <span className="text-xs font-medium text-fg-muted">{group.questions.length} ta savol</span>
                <button
                  type="button"
                  onClick={() => setReadingMobileTab("passage")}
                  className="text-xs font-semibold text-brand underline underline-offset-4 touch-manipulation"
                >
                  ← Matnni o&apos;qish
                </button>
              </div>
            )}
            {group.questions.map((q) => (
              <div key={q.id} id={`q-${q.id}`} className="scroll-mt-28">
                <QuestionInput
                  key={q.id}
                  question={q}
                  groupTitle={group.title ?? undefined}
                  attemptId={attemptId}
                  value={answers[q.id] ?? ""}
                  hasAudio={audioSet.has(q.id)}
                  audioDurationMs={audioDurations?.[q.id]}
                  timed={timed}
                  unavailableOptions={group.optionsReusable === false ? usedMatchingOptions(group.questions, answers, q.id) : []}
                  onChange={(v) => onAnswer(q.id, v)}
                  multilevelSkill={skill}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function QuestionInput({
  question: q,
  attemptId,
  value,
  hasAudio,
  audioDurationMs,
  timed,
  onChange,
  unavailableOptions,
  multilevelSkill,
  groupTitle,
}: {
  question: MockQuestion;
  attemptId: string;
  value: string;
  hasAudio: boolean;
  audioDurationMs?: number;
  timed: boolean;
  onChange: (v: string) => void;
  unavailableOptions?: string[];
  multilevelSkill?: MockSkill;
  groupTitle?: string;
}) {
  const tx = useTranslations("mock.runnerUx");

  const header = (
    <div className="flex items-start gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">
        {q.number}
      </span>
      <p className="whitespace-pre-line text-sm text-fg">{q.prompt}</p>
    </div>
  );

  if (q.type === "speaking_task") {
    return (
      <div className="space-y-2">
        {header}
        {q.guidance ? <MultilevelRecorder attemptId={attemptId} questionId={q.id} timed={timed} initialHasAudio={hasAudio} initialAudioDurationMs={audioDurationMs} responseSeconds={q.guidance.responseSeconds}
          startPhase={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/speaking/${q.id}/start`)}
          upload={async (blob) => { const form = new FormData(); form.append('audio', blob, recordingFileName(blob)); return api.post(`/mock/attempts/${attemptId}/speaking/${q.id}`, form); }}
        /> : <SpeakingRecorder attemptId={attemptId} questionId={q.id} initialHasAudio={hasAudio} />}
      </div>
    );
  }

  if (ESSAY.has(q.type)) {
    // Spec §2.3: Task1 min 150, Task2 min 250 (soft — warning, no hard block).
    const minWords = q.guidance?.wordMin ?? (q.type === "essay_task1" ? 150 : q.type === "essay_task2" ? 250 : (q.wordLimit ?? 0));
    // Restore draft from localStorage on mount if current value is empty
    React.useEffect(() => {
      if (typeof window !== "undefined" && !value) {
        try {
          const draftKey = `bw_writing_draft_${attemptId}_${q.id}`;
          const cached = localStorage.getItem(draftKey);
          if (cached && cached.trim()) {
            onChange(cached);
          }
        } catch {}
      }
    }, [attemptId, q.id]);

    const handleWritingChange = (text: string) => {
      onChange(text);
      if (typeof window !== "undefined") {
        try {
          const draftKey = `bw_writing_draft_${attemptId}_${q.id}`;
          localStorage.setItem(draftKey, text);
        } catch {}
      }
    };

    return (
      <div className="space-y-2">
        {q.guidance && multilevelSkill === "writing" ? <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* The task name is already the group heading when the two agree. */}
            {multilevelTaskName(q.guidance, `Task ${q.number}`) === groupTitle
              ? <span />
              : <p className="font-semibold text-fg">{multilevelTaskName(q.guidance, `Task ${q.number}`)}</p>}
            <MultilevelTaskMeta question={q} />
          </div>
          <p className="whitespace-pre-line text-sm text-fg">{q.prompt}</p>
        </div> : header}
        <Textarea
          value={value}
          onChange={(e) => handleWritingChange(e.target.value)}
          className="min-h-72 resize-y leading-relaxed text-base sm:text-sm focus-visible:border-brand touch-manipulation font-mono sm:font-sans"
          aria-label={tx("writingResponseLabel", { number: q.number })}
          placeholder={tx("writingPlaceholder")}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
          <WritingResponseGuide value={value} minimum={minWords} maximum={q.guidance?.wordMax} />
          {value.trim() && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 className="size-3" /> Qoralama saqlanmoqda
            </span>
          )}
        </div>
      </div>
    );
  }

  return <ObjectiveQuestionInput question={q} value={value} onChange={onChange} unavailableOptions={unavailableOptions} />;
}
