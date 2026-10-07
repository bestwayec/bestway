"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Mic, Send, Square } from "lucide-react";
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
  useUploadMockSpeaking,
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
import { api } from '@/lib/api-client';
import { hasPendingRecordings, hasActiveRecording } from '@/lib/durable-recordings';
import { ObjectiveQuestionInput } from './objective-question-input';
import { usedMatchingOptions } from '@/lib/objective-question';
import { MultilevelSectionProgress, MultilevelTaskMeta, MultilevelTaskProgress, multilevelTaskLabels, multilevelTaskName, studentSaveMessage, studentSubmitMessage, studentSubmitNeedsReview } from './multilevel-student-ui';
import { MultilevelSubmitReview } from './multilevel-submit-review';
import { multilevelMissingWork } from '@/lib/multilevel-completeness';

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
  const exam = examQ.data;
  const versioned = !!attempt.specificationVersion;

  const bulk = useBulkMockAnswers(attempt.id);
  const submit = useSubmitMock(attempt.id);
  const flag = useFlagMockCheat(attempt.id);
  const advance = useAdvanceMockSection(attempt.id);

  // Timed = exam-strict playback (full_test ham, single_skill ham).
  // Eslatma: `strict` clipboard/contextmenu bloklashni ham yoqadi — Timed
  // Reading/Writing single_skill da ham ataylab bloklanadi (exam sharti, izchil).
  const isFullTest = (attempt.flowMode ?? "single_skill") === "full_test";
  const strict = attempt.mode === "timed";

  // Boshlang'ich javoblar + speaking audio holati (attempt'dan)
  const initial = React.useMemo(() => {
    const ans: Record<string, string> = {};
    const audio = new Set<string>();
    for (const s of attempt.sections)
      for (const g of s.groups)
        for (const q of g.questions) {
          ans[q.id] = q.response ?? "";
          if (q.hasAudio) audio.add(q.id);
        }
    return { ans, audio };
  }, [attempt]);

  // Server answers are the authoritative resume state. Edits stay in memory only
  // until autosave persists them, so a reload cannot manufacture a second attempt.
  const [answers, setAnswers] = React.useState<Record<string, string>>(() => initial.ans);
  const [audioSet, setAudioSet] = React.useState<Set<string>>(initial.audio);
  const [selectedSection, setActiveSection] = React.useState(0);
  const [activeTaskBySkill, setActiveTaskBySkill] = React.useState<Partial<Record<"writing" | "speaking", number>>>({});
  // The exam query can resolve after mount. Full-test navigation always follows
  // the server skill, including a resume directly into Reading/Writing/Speaking.
  const activeSection = isFullTest && attempt.currentSkill
    ? Math.max(0, exam?.sections.findIndex((s) => s.skill === attempt.currentSkill) ?? 0)
    : selectedSection;
  const [cheatWarn, setCheatWarn] = React.useState(false);
  const [cheatCount, setCheatCount] = React.useState(0);
  // Pre-submit completeness surface (STEP 19): 'submit' = final hand-in,
  // 'advance' = warning before the one-way "Next section" move.
  const [review, setReview] = React.useState<null | "submit" | "advance">(null);

  const answersRef = React.useRef(answers);
  React.useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const dirty = React.useRef<Set<string>>(new Set());
  const submittingRef = React.useRef(false);
  const saveInFlight = React.useRef<Promise<unknown> | null>(null);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("saved");
  React.useEffect(() => {
    const saved = (event: Event) => { const detail = (event as CustomEvent<{attemptId:string;questionId:string}>).detail; if (detail?.attemptId === attempt.id) setAudioSet((previous) => new Set([...previous,detail.questionId])); };
    window.addEventListener('multilevel:recording-uploaded', saved);
    return () => window.removeEventListener('multilevel:recording-uploaded', saved);
  }, [attempt.id]);

  const flush = React.useCallback(() => {
    if (versioned && (saveInFlight.current || submittingRef.current)) return;
    const ids = [...dirty.current].filter((id) => !versioned || !isFullTest || attempt.sections.find((s) => s.skill === attempt.currentSkill)?.groups.some((g) => g.questions.some((q) => q.id === id)));
    if (!ids.length) return;
    if (!versioned) dirty.current.clear();
    const snapshot = { ...answersRef.current };
    if (versioned) {
      setSaveState("saving");
      saveInFlight.current = bulk.mutateAsync(ids.map((id) => ({questionId:id,response:snapshot[id] ?? ''}))).then(() => {
        ids.forEach((id) => { if (answersRef.current[id] === snapshot[id]) dirty.current.delete(id); });
        if (!dirty.current.size) setSaveState("saved");
      }).catch(() => { setSaveState("error"); toast.error("Your response could not be saved. Try again."); }).finally(() => { saveInFlight.current = null; });
      return;
    }
    bulk.mutate(
      ids.map((id) => ({ questionId: id, response: answersRef.current[id] ?? "" })),
      { onSuccess: () => {
        ids.forEach((id) => { if (answersRef.current[id] === snapshot[id]) dirty.current.delete(id); });
      }, onError: () => { ids.forEach((id) => dirty.current.add(id)); toast.error(tc("saveFailed")); } },
    );
  }, [bulk, tc, versioned, isFullTest, attempt.sections, attempt.currentSkill]);

  // Debounce autosave
  React.useEffect(() => {
    const id = setTimeout(flush, 1500);
    return () => clearTimeout(id);
  }, [answers, flush]);

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
  const deadlineTs = versioned && isFullTest && attempt.currentSkill ? attempt.sectionDeadlines?.[attempt.currentSkill] : attempt.overallDeadlineAt ?? attempt.deadlineAt;
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
      if (!auto && !confirmed && !confirm(t("submitConfirm"))) return;
      submittingRef.current = true;
      window.dispatchEvent(new Event(STOP_RECORDINGS_EVENT));
      try {
        if (versioned) await saveInFlight.current;
        const all = Object.entries(answersRef.current)
          .filter(([qid, v]) => versioned ? (!isFullTest || attempt.sections.find((s) => s.skill === attempt.currentSkill)?.groups.some((g) => g.questions.some((q) => q.id === qid))) : v !== '')
          .map(([questionId, response]) => ({ questionId, response }));
        if (all.length && (!versioned || !auto)) await bulk.mutateAsync(all);
        await submit.mutateAsync();
        toast.success(t("submitted"));
      } catch (e) {
        submittingRef.current = false;
        // A refused incomplete hand-in reopens the review panel so the student
        // sees exactly which section still owes work.
        if (studentSubmitNeedsReview(e)) setReview("submit");
        toast.error(versioned ? studentSubmitMessage(e) : (e instanceof Error ? e.message : tc("unknownError")));
      }
    },
    [bulk, submit, t, tc, versioned, attempt.id, attempt.sections, attempt.currentSkill, isFullTest],
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
          void advance.mutateAsync().catch(() => toast.error('Section transition failed. Retrying…')).finally(() => { submittingRef.current = false; });
        } else void doSubmit(true);
      }
    }, 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [deadline, doSubmit, serverOffset, versioned, isFullTest, attempt.currentSkill, advance]);

  // Full-test: keyingi bo'limga o'tish (flush + advance). Review tugashi ham shu yerga keladi.
  const goNextSection = React.useCallback(async () => {
    if (versioned && submittingRef.current) return;
    if (versioned) submittingRef.current = true;
    try {
      if (versioned) {
        await saveInFlight.current;
        const ids = attempt.sections.find((s) => s.skill === attempt.currentSkill)?.groups.flatMap((g) => g.questions.map((q) => q.id)) ?? [];
        await bulk.mutateAsync(ids.map((questionId) => ({ questionId, response: answersRef.current[questionId] ?? '' })));
        ids.forEach((id) => dirty.current.delete(id));
      } else flush();
      await advance.mutateAsync();
      toast.success("Next section");
    } catch (e) {
      toast.error(versioned ? "This section could not be completed. Please try again." : (e instanceof Error ? e.message : tc("unknownError")));
    } finally { if (versioned) submittingRef.current = false; }
  }, [advance, flush, tc, versioned, attempt.sections, attempt.currentSkill, bulk]);

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

  // Anti-cheat: warn-only (qaror #5) — tab/blur ni qayd etadi, imtihonni to'xtatmaydi.
  // Clipboard (copy/cut/paste) + contextmenu + drag ildizda bloklanadi (spec §7).
  React.useEffect(() => {
    if (attempt.mode !== "timed") return;
    function report(event: string) {
      flag.mutate(event);
      setCheatWarn(true);
      setCheatCount((c) => c + 1);
    }
    function onHide() {
      if (document.visibilityState === "hidden") report("tab_switch");
    }
    function onBlur() {
      report("blur");
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
    };
  }, [attempt.mode, flag]);

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
            <p className="truncate font-semibold text-fg">{exam.title}</p>
            <p className="text-xs text-fg-muted">
              {answered} / {total} {t("answered")}
              {bulk.isPending && <Loader2 className="ml-2 inline size-3 animate-spin" />}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {remaining != null && <Timer ms={remaining} label={t("timeLeft")} />}
            {isFullTest && activeSection < exam.sections.length - 1 ? (
              <Button size="sm" variant="outline" loading={advance.isPending} onClick={() => (multilevelReview && missingWork ? setReview("advance") : void goNextSection())}>
                Next section
              </Button>
            ) : null}
            <Button size="sm" loading={submit.isPending} onClick={() => (multilevelReview && missingWork ? setReview("submit") : doSubmit(false))}>
              <Send />
              {t("submit")}
            </Button>
          </div>
        </div>
        {cheatWarn && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="size-3.5" />
            {t("tabSwitchWarning")}
            {cheatCount > 1 ? ` (${cheatCount})` : ""} — timer continues.
          </p>
        )}
        {versioned && <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted" role="status">
          <span className={cn(saveState === "error" && "text-danger")}>{studentSaveMessage(saveState)}</span>
          {saveState === "error" && <button type="button" className="font-semibold text-brand underline-offset-2 hover:underline" onClick={flush}>Retry</button>}
        </div>}
      </div>

      {/* Bo'lim tablari (full-test da faqat status — bosib bo'lmaydi) */}
      {exam.sections.length > 1 && (
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
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
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

      {versioned && exam.type === "multilevel" && section && <div className="mb-4"><MultilevelSectionProgress current={section.skill} /></div>}

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
            onAnswer={setAnswer}
          /> : section.groups.map((g) => (
            <GroupBlock
              key={g.id}
              group={!versioned && exam.type === 'multilevel' ? { ...g, questions: g.questions.map((q) => ({ ...q, guidance: undefined })) } : g}
              skill={section.skill}
              strict={strict && section.skill === "listening"}
              timed={strict}
              attemptId={attempt.id}
              answers={answers}
              audioSet={audioSet}
              onAnswer={setAnswer}
              onReviewComplete={section.skill === "listening" ? onListeningReviewComplete : undefined}
            />
          ))}
        </div>
      )}

      {review && missingWork && (
        <MultilevelSubmitReview
          work={missingWork}
          advance={review === "advance"}
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
    </div>
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
  onAnswer,
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
  onAnswer: (qid: string, value: string) => void;
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
  return <div className="space-y-4">
    <MultilevelTaskProgress skill={skill} current={activeTask} total={groups.length} labels={labels} onSelect={setActiveTask} />
    <GroupBlock
      group={group}
      skill={skill}
      strict={strict}
      timed={timed}
      attemptId={attemptId}
      answers={answers}
      audioSet={audioSet}
      onAnswer={onAnswer}
      sharedWritingStimulus={sharedWritingStimulus}
    />
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="outline" disabled={activeTask === 0} onClick={() => setActiveTask(activeTask - 1)}>Previous</Button>
      <Button type="button" variant="outline" disabled={activeTask === groups.length - 1} onClick={() => setActiveTask(activeTask + 1)}>Next</Button>
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
  onAnswer: (qid: string, val: string) => void;
  onReviewComplete?: () => void;
  sharedWritingStimulus?: string;
}) {
  const hasPassage = !!group.passageText && !(skill === "writing" && sharedWritingStimulus);
  const hasGappedContent = hasGappedDocument(group.contentHtml);
  const audioSrc = media(`/mock/groups/${group.id}/audio${strict ? `?attemptId=${attemptId}` : ""}`);
  return (
    <Card className="p-4 sm:p-5">
      {group.title && <h3 className="font-semibold text-fg">{group.title}</h3>}
      {group.hasAudio && skill === "listening" ? (
        group.questions[0]?.guidance && strict ? <MultilevelListening
          prepare={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/prepare`)}
          play={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/play`)}
          load={async () => { const res = await fetch(audioSrc); if (!res.ok) throw new Error('Audio loading failed'); return res.blob(); }}
        /> : <ListeningAudio
          src={audioSrc}
          strict={strict}
          onReviewComplete={strict ? onReviewComplete : undefined}
        />
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
        <p className="mt-3 text-sm font-medium text-fg-muted">{group.instructions}</p>
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

      <div className={cn("mt-3", hasPassage && !hasGappedContent && "lg:grid lg:grid-cols-2 lg:gap-6")}>
        {hasPassage && !hasGappedContent && (
          <div className="mb-4 max-h-[70vh] overflow-y-auto whitespace-pre-line rounded-[8px] border border-border bg-bg-subtle p-4 text-sm leading-relaxed text-fg lg:mb-0">
            {group.passageText}
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
          <div className="space-y-4">
            {group.questions.map((q) => (
              <QuestionInput
                key={q.id}
                question={q}
                groupTitle={group.title ?? undefined}
                attemptId={attemptId}
                value={answers[q.id] ?? ""}
                hasAudio={audioSet.has(q.id)}
                timed={timed}
                unavailableOptions={group.optionsReusable === false ? usedMatchingOptions(group.questions, answers, q.id) : []}
                onChange={(v) => onAnswer(q.id, v)}
                multilevelSkill={skill}
              />
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
  timed: boolean;
  onChange: (v: string) => void;
  unavailableOptions?: string[];
  multilevelSkill?: MockSkill;
  groupTitle?: string;
}) {
  const t = useTranslations("mock");

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
        {q.guidance ? <MultilevelRecorder attemptId={attemptId} questionId={q.id} timed={timed} initialHasAudio={hasAudio}
          startPhase={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/speaking/${q.id}/start`)}
          upload={async (blob) => { const form = new FormData(); form.append('audio', blob, blob.type.includes('mp4') ? 'speaking.m4a' : 'speaking.webm'); return api.post(`/mock/attempts/${attemptId}/speaking/${q.id}`, form); }}
        /> : <SpeakingRecorder attemptId={attemptId} questionId={q.id} initialHasAudio={hasAudio} />}
      </div>
    );
  }

  if (ESSAY.has(q.type)) {
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    // Spec §2.3: Task1 min 150, Task2 min 250 (soft — warning, no hard block).
    const minWords = q.guidance?.wordMin ?? (q.type === "essay_task1" ? 150 : q.type === "essay_task2" ? 250 : (q.wordLimit ?? 0));
    const underMin = minWords > 0 && words > 0 && words < minWords;
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
          onChange={(e) => onChange(e.target.value)}
          className="min-h-48"
          placeholder="..."
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
        />
        <p className={cn("text-right text-xs tabular-nums", underMin ? "text-warning" : "text-fg-subtle")}>
          {words} {t("words")}
          {q.guidance?.wordMax ? ` / ${minWords === q.guidance.wordMax ? `~${minWords}` : `${minWords}–${q.guidance.wordMax}`} target` : minWords > 0 ? ` · min ${minWords}` : ''}
          {underMin ? ` — keep writing to reach the target` : ""}
        </p>
      </div>
    );
  }

  return <ObjectiveQuestionInput question={q} value={value} onChange={onChange} unavailableOptions={unavailableOptions} />;
}

function SpeakingRecorder({
  attemptId,
  questionId,
  initialHasAudio,
}: {
  attemptId: string;
  questionId: string;
  initialHasAudio: boolean;
}) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const upload = useUploadMockSpeaking(attemptId);
  const [recording, setRecording] = React.useState(false);
  const [hasAudio, setHasAudio] = React.useState(initialHasAudio);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunks = React.useRef<Blob[]>([]);

  const halt = React.useCallback(() => {
    const mr = recRef.current;
    if (mr && mr.state === "recording") mr.stop();
    setRecording(false);
  }, []);

  React.useEffect(() => {
    window.addEventListener(STOP_RECORDINGS_EVENT, halt);
    return () => {
      window.removeEventListener(STOP_RECORDINGS_EVENT, halt);
      halt();
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [halt]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "speaking.webm");
        upload.mutate(
          { questionId, form },
          {
            onSuccess: () => {
              setHasAudio(true);
              toast.success(tc("saved"));
            },
            onError: () => toast.error(tc("unknownError")),
          },
        );
      };
      recRef.current = mr;
      streamRef.current = stream;
      mr.start();
      setRecording(true);
    } catch {
      toast.error(t("micError"));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-border bg-bg-subtle p-3">
      {recording ? (
        <Button size="sm" variant="danger" onClick={halt}>
          <Square className="fill-current" />
          {t("stopRecording")}
        </Button>
      ) : (
        <Button size="sm" variant="outline" loading={upload.isPending} onClick={start}>
          <Mic />
          {hasAudio ? t("reRecord") : t("record")}
        </Button>
      )}
      {hasAudio && !recording && (
        <audio
          controls
          src={media(`/mock/attempts/${attemptId}/answers/${questionId}/audio`)}
          className="h-9"
          preload="none"
        >
          <track kind="captions" />
        </audio>
      )}
      {recording && (
        <span className="flex items-center gap-1.5 text-sm text-danger">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          {t("recording")}
        </span>
      )}
    </div>
  );
}
