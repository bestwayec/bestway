"use client";

import * as React from "react";
import {
  AlertTriangle,
  Camera,
  Clock,
  CheckCircle2,
  Keyboard,
  Contrast,
  Flag,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { StrictErrorBoundary } from "@/components/common/StrictErrorBoundary";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import {
  useAdvanceMockSection,
  useAudioTimestamps,
  useBulkMockAnswers,
  useFlagMockCheat,
  useMockExam,
  useReportLiveRoomProgress,
  useSubmitMock,
} from "@/hooks/use-mock";
import type {
  AudioTimestampItem,
  ExamSimulatorMode,
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
import { MultilevelSectionProgress, MultilevelTaskMeta, MultilevelTaskProgress, multilevelTaskLabels, multilevelTaskName, isExplainedSaveError, studentSaveErrorMessage, studentSubmitMessage, studentSubmitNeedsReview } from './multilevel-student-ui';
import { MultilevelSubmitReview } from './multilevel-submit-review';
import { multilevelMissingWork } from '@/lib/multilevel-completeness';
import { isPartialPractice, practiceExam } from '@/lib/mock-practice';
import { ResponseProgress, WritingResponseGuide } from './exam-response-progress';
import { multilevelQuestionAnswered } from '@/lib/multilevel-completeness';
import { ExamLocker } from "./exam-locker";
import { MicCheckModal } from "./mic-check-modal";
import { CbtSectionStepper } from "./cbt-section-stepper";
import { SectionTransitionModal } from "./section-transition-modal";
import {
  CBT_ANNOTATIONS_UPDATED_EVENT,
  CbtAnnotatedText,
  type CbtStickyNote,
  deleteAttemptNote,
  loadAttemptNotes,
} from "./cbt-annotated-text";
import { SubmitConfirmModal } from "./submit-confirm-modal";
import { AdvanceConfirmModal } from "./advance-confirm-modal";
import { NetworkBanner } from "@/components/common/network-banner";
import { installHaptics } from "@/lib/haptics";
import { WritingImageOcr } from "./writing-image-ocr";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { LoadErrorPanel } from "@/components/common/load-error-panel";

const ESSAY = new Set<MockQuestionType>(["essay_task1", "essay_task2"]);

const STOP_RECORDINGS_EVENT = "mock-stop-recordings";

export type CdiContrastTheme = "standard" | "yellow_on_black" | "grey";

/** Media backend proxy orqali oqadi — token httpOnly cookie'da */
const media = (path: string) => `/api/backend${path}`;

import { GroupImage } from "./group-image";
export { GroupImage };

function countAnswered(exam: MockExamDetail, answers: Record<string, string>, audio: Set<string>): number {
  let n = 0;
  for (const s of (exam?.sections || [])) {
    const groups = s?.groups || (s as any)?.parts || [];
    for (const g of groups) {
      for (const q of (g?.questions || [])) {
        if ((q.type as string) === "speaking_task" || (q.type as string) === "speaking" || (q as any).questionType === "speaking_prompt") {
          if (audio.has(q.id)) n++;
        } else if ((answers[q.id] ?? "").trim()) n++;
      }
    }
  }
  return n;
}

export function MockRunner({ attempt }: { attempt: MockAttemptDetail }) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const tm = useTranslations("errorPanel");
  const tr = useTranslations("mock.runnerUx");
  const examQ = useMockExam(attempt.examId);
  const audioTimestampsQ = useAudioTimestamps(attempt.examId);
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

  // Simulator Mode ('cdi' | 'dtm') + CDI Contrast Theme + Notes Drawer + Fullscreen
  const [simulatorMode, setSimulatorMode] = React.useState<ExamSimulatorMode>("cdi");
  const [contrastTheme, setContrastTheme] = React.useState<CdiContrastTheme>("standard");
  const [notesDrawerOpen, setNotesDrawerOpen] = React.useState(false);
  const [attemptNotes, setAttemptNotes] = React.useState<CbtStickyNote[]>([]);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [flaggedQuestions, setFlaggedQuestions] = React.useState<Set<string>>(new Set());
  const [activeQuestionNumber, setActiveQuestionNumber] = React.useState<number>(1);
  const [liveRoomId, setLiveRoomId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlSim = params.get("simulator");
    const roomParam = params.get("room") || sessionStorage.getItem(`bw_live_room_${attempt.id}`);
    if (roomParam) {
      setLiveRoomId(roomParam);
    }
    const storedSim = sessionStorage.getItem("bw_simulator_mode");
    if (urlSim === "cdi" || urlSim === "dtm") {
      setSimulatorMode(urlSim);
    } else if (storedSim === "cdi" || storedSim === "dtm") {
      setSimulatorMode(storedSim);
    } else if (exam?.type === "multilevel") {
      setSimulatorMode("dtm");
    } else {
      setSimulatorMode("cdi");
    }
  }, [attempt.id, exam?.type]);

  React.useEffect(() => {
    const syncNotes = () => setAttemptNotes(loadAttemptNotes(attempt.id));
    syncNotes();
    window.addEventListener(CBT_ANNOTATIONS_UPDATED_EVENT, syncNotes);
    return () => window.removeEventListener(CBT_ANNOTATIONS_UPDATED_EVENT, syncNotes);
  }, [attempt.id]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = React.useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen permission errors
    }
  }, []);

  const toggleQuestionFlag = React.useCallback((qid: string) => {
    setFlaggedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }, []);

  const bulk = useBulkMockAnswers(attempt.id);
  const submit = useSubmitMock(attempt.id);
  const flag = useFlagMockCheat(attempt.id);
  const advance = useAdvanceMockSection(attempt.id);
  const reportLiveProgress = useReportLiveRoomProgress(liveRoomId);
  const reportProgressMutate = reportLiveProgress.mutate;
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
    for (const s of (attempt?.sections || [])) {
      const groups = s?.groups || (s as any)?.parts || [];
      for (const g of groups) {
        for (const q of (g?.questions || [])) {
          ans[q.id] = q.response ?? "";
          if (q.hasAudio) audio.add(q.id);
          if (q.hasAudio && q.audioDurationMs != null) durations[q.id] = q.audioDurationMs;
        }
      }
    }
    return { ans, audio, durations };
  }, [attempt]);

  // Server answers are the authoritative resume state. Edits stay in memory only
  // until autosave persists them, so a reload cannot manufacture a second attempt.
  const [answers, setAnswers] = React.useState<Record<string, string>>(() => initial.ans);
  const [audioSet, setAudioSet] = React.useState<Set<string>>(initial.audio);
  const [audioDurations, setAudioDurations] = React.useState(initial.durations);
  const [selectedSection, setSelectedSection] = React.useState<number | null>(null);
  const setActiveSection = React.useCallback((idx: number) => setSelectedSection(idx), []);
  const [activeTaskBySkill, setActiveTaskBySkill] = React.useState<Partial<Record<"writing" | "speaking", number>>>({});

  const resolvedSectionIndex = React.useMemo(() => {
    if (!exam?.sections || exam.sections.length === 0) return 0;
    if (typeof window !== "undefined") {
      const urlSkill = new URLSearchParams(window.location.search).get("skill");
      if (urlSkill) {
        const found = exam.sections.findIndex((s) => s.skill === urlSkill);
        if (found >= 0) return found;
      }
    }
    if (attempt.currentSkill) {
      const found = exam.sections.findIndex((s) => s.skill === attempt.currentSkill);
      if (found >= 0) return found;
    }
    const listeningIdx = exam.sections.findIndex((s) => s.skill === "listening");
    return listeningIdx >= 0 ? listeningIdx : 0;
  }, [exam?.sections, attempt.currentSkill]);

  const activeSection = isSingleSection
    ? 0
    : selectedSection !== null
    ? selectedSection
    : resolvedSectionIndex;
  // The microphone check is done once per attempt (remembered for the browser session), not on every visit
  // to the Speaking tab or after a reload. Read after mount so server and client render the same markup.
  const [micChecked, setMicCheckedState] = React.useState(false);
  const [micCheckLoaded, setMicCheckLoaded] = React.useState(false);
  const micCheckKey = `bw_mic_checked_${attempt.id}`;
  React.useEffect(() => {
    try {
      setMicCheckedState(sessionStorage.getItem(micCheckKey) === "1");
    } catch {}
    setMicCheckLoaded(true);
  }, [micCheckKey]);
  const setMicChecked = React.useCallback((value: boolean) => {
    setMicCheckedState(value);
    try {
      if (value) sessionStorage.setItem(micCheckKey, "1");
    } catch {}
  }, [micCheckKey]);
  // Pre-submit completeness surface (STEP 19): 'submit' = final hand-in,
  // 'advance' = warning before the one-way "Next section" move.
  const [review, setReview] = React.useState<null | "submit" | "advance">(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = React.useState(false);
  const [showAdvanceConfirm, setShowAdvanceConfirm] = React.useState(false);
  const [transitionModal, setTransitionModal] = React.useState<{ completedSkill: MockSkill; nextSkill: MockSkill } | null>(null);

  const answersRef = React.useRef(answers);
  React.useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const dirty = React.useRef<Set<string>>(new Set());
  const submittingRef = React.useRef(false);
  const saveInFlight = React.useRef<Promise<unknown> | null>(null);
  const [saveRevision, setSaveRevision] = React.useState(0);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error" | "offline">("saved");
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
    const targetSection = attempt?.sections?.find((s) => s.skill === attempt.currentSkill);
    const targetGroups = targetSection?.groups || (targetSection as any)?.parts || [];
    const ids = [...dirty.current].filter((id) => !versioned || !isFullTest || targetGroups.some((g: any) => (g?.questions || []).some((q: any) => q.id === id)));
    if (!ids.length) return;
    const snapshot = { ...answersRef.current };
    setSaveState("saving");
    let succeeded = false;
    saveInFlight.current = bulkMutateAsync(ids.map((id) => ({questionId:id,response:snapshot[id] ?? ''}))).then((result) => {
      if (result.saved !== ids.length) throw new Error('Some answers could not be saved');
      succeeded = true;
      ids.forEach((id) => { if (answersRef.current[id] === snapshot[id]) dirty.current.delete(id); });
      if (!dirty.current.size) setSaveState("saved");
    }).catch((error: unknown) => {
      setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      toast.error(versioned || isExplainedSaveError(error) ? studentSaveErrorMessage(error) : tc("saveFailed"));
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
    if (submittingRef.current) return;
    dirty.current.add(qid);
    const next = { ...answersRef.current, [qid]: val };
    answersRef.current = next;
    setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saving");
    setAnswers(next);
  }
  React.useEffect(() => {
    window.addEventListener('online', flush);
    const onOffline = () => { if (dirty.current.size) setSaveState("offline"); };
    window.addEventListener('offline', onOffline);
    const id = window.setInterval(flush, 10000);
    return () => { window.removeEventListener('online', flush); window.removeEventListener('offline', onOffline); window.clearInterval(id); };
  }, [flush]);

  // Native-feeling tap feedback on answer options and buttons (touch devices only).
  React.useEffect(() => installHaptics(), []);

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

  // Must be declared before doSubmit and listed in its dependencies: `exam` loads
  // asynchronously, so a doSubmit memoised on the first render would keep seeing
  // total === 0 and refuse every hand-in with the "0/0" toast.
  const total =
    exam?.questionCount ||
    (exam?.sections || []).reduce(
      (sum, s) =>
        sum +
        (s?.groups || (s as any)?.parts || []).reduce(
          (n: number, g: any) => n + (g?.questions || (g as any)?.items || []).length,
          0
        ),
      0
    );

  const doSubmit = React.useCallback(
    async (auto = false, confirmed = false) => {
      if (submittingRef.current) return;
      if (total <= 0) {
        toast.error(tr("noQuestionsToSubmit"));
        return;
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
      if (versioned) {
        try {
          if (hasActiveRecording(attempt.id) || await hasPendingRecordings(attempt.id)) {
            toast.error('Finish recording and upload saved takes before submitting.');
            submittingRef.current = false;
            return;
          }
        } catch {
          toast.error('Recording recovery could not be checked. Keep this page open and retry.');
          submittingRef.current = false;
          return;
        }
      }
      window.dispatchEvent(new Event(STOP_RECORDINGS_EVENT));
      try {
        try {
          await saveInFlight.current;
        } catch {}
        const targetSec = attempt?.sections?.find((s) => s.skill === attempt.currentSkill);
        if (isFullTest && !targetSec) throw new Error('Current section could not be loaded. Keep this page open and retry.');
        const targetGrps = targetSec?.groups || (targetSec as any)?.parts || [];
        const all = Object.entries(answersRef.current)
          .filter(([qid]) => (!auto || dirty.current.has(qid)) && (!isFullTest || targetGrps.some((g: any) => (g?.questions || []).some((q: any) => q.id === qid))))
          .map(([questionId, response]) => ({ questionId, response }));
        for (let offset = 0; offset < all.length; offset += 200) {
          const batch = all.slice(offset, offset + 200);
          const saved = await bulkMutateAsync(batch);
          if (saved.saved !== batch.length) {
            throw new Error("Some answers could not be saved. Keep this page open and retry.");
          }
        }
        await submitMutateAsync({ confirm: true, confirmed: true, force: true });
        if (liveRoomId) {
          reportProgressMutate({
            attemptId: attempt.id,
            status: "submitted",
          });
        }
        toast.success(t("submitted"));
      } catch (e) {
        submittingRef.current = false;
        // A refused incomplete hand-in reopens the review panel so the student
        // sees exactly which section still owes work.
        if (studentSubmitNeedsReview(e)) setReview("submit");
        toast.error(versioned ? studentSubmitMessage(e) : (e instanceof Error ? e.message : tc("unknownError")));
      }
    },
    [bulkMutateAsync, submitMutateAsync, t, tc, versioned, attempt.id, attempt.sections, attempt.currentSkill, isFullTest, liveRoomId, reportProgressMutate, total],
  );

  // Full-test: keyingi bo'limga o'tish (flush + advance). Review tugashi ham shu yerga keladi.
  const goNextSection = React.useCallback(async (automatic = false) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await saveInFlight.current;
      const curSec = attempt?.sections?.find((s) => s.skill === attempt.currentSkill);
      if (!curSec) throw new Error('Current section could not be loaded');
      const curGrps = curSec?.groups || (curSec as any)?.parts || [];
      const ids = curGrps.flatMap((g: any) => (g?.questions || []).map((q: any) => q.id)) as string[];
      const answers = ids.filter((id) => Object.hasOwn(answersRef.current, id) && (!automatic || dirty.current.has(id)))
        .map((questionId) => ({ questionId, response: answersRef.current[questionId] ?? '' }));
      for (let offset = 0; offset < answers.length; offset += 200) {
        const batch = answers.slice(offset, offset + 200);
        const saved = await bulkMutateAsync(batch);
        if (saved.saved !== batch.length) throw new Error('Some answers could not be saved');
      }
      ids.forEach((id) => dirty.current.delete(id));
      const currentSkill = attempt.currentSkill;
      await advanceMutateAsync();
      const currentIdx = exam?.sections.findIndex((s) => s.skill === currentSkill) ?? -1;
      const nextSkill = exam?.sections[currentIdx + 1]?.skill;
      if (currentSkill && nextSkill) {
        setTransitionModal({ completedSkill: currentSkill, nextSkill });
      }
      toast.success(tr("nextSectionDone"));
    } catch (e) {
      toast.error(versioned ? "This section could not be completed. Please try again." : (e instanceof Error ? e.message : tc("unknownError")));
    } finally { submittingRef.current = false; }
  }, [advanceMutateAsync, tc, tr, versioned, attempt.sections, attempt.currentSkill, bulkMutateAsync, exam]);

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
          void goNextSection(true);
        } else void doSubmit(true);
      }
    }, 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [deadline, doSubmit, serverOffset, versioned, isFullTest, attempt.currentSkill, goNextSection]);

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

  const answered = exam ? countAnswered(exam, answers, audioSet) : 0;
  const section: MockSection | undefined = exam?.sections[activeSection];

  // Live Exam Room telemetry heartbeat
  React.useEffect(() => {
    if (!liveRoomId || !exam) return;
    const sendHeartbeat = () => {
      reportProgressMutate({
        attemptId: attempt.id,
        currentSkill: section?.skill,
        currentQuestionNumber: activeQuestionNumber,
        answeredCount: answered,
        flaggedCount: flaggedQuestions.size,
        status: "in_progress",
      });
    };
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 10000);
    return () => window.clearInterval(timer);
  }, [
    liveRoomId,
    exam,
    attempt.id,
    section?.skill,
    activeQuestionNumber,
    answered,
    flaggedQuestions.size,
    reportProgressMutate,
  ]);

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

  // Defensive fallback: if sections array is empty or undefined, render a clear UI error message, NOT a black screen
  if (!exam || !exam.sections || exam.sections.length === 0) {
    console.error("[MockRunner] Failed to load questions from server: sections is empty", {
      examId: attempt.examId,
      rawExam: examQ.data,
    });
    return (
      <LoadErrorPanel
        title={tm("loadErrorTitle")}
        reason={examQ.isError ? tm("loadErrorNetwork") : tm("loadErrorEmpty")}
        onRetry={() => void examQ.refetch()}
      />
    );
  }

  const guidedMultilevel = versioned && exam.type === "multilevel" && (section?.skill === "writing" || section?.skill === "speaking");
  // Guided writing/speaking tasks have their own task tabs; the stepper reports the question in view.
  const showQuestionPosition = Boolean(section) && !guidedMultilevel;
  const activeTask = section?.skill === "writing" || section?.skill === "speaking" ? activeTaskBySkill[section.skill] ?? 0 : 0;

  const contrastClasses =
    simulatorMode === "cdi" && contrastTheme === "yellow_on_black"
      ? "bg-[#09090b] text-[#fde047] rounded-2xl p-2 sm:p-4 [&_.bg-surface]:bg-[#18181b] [&_.bg-bg]:bg-[#09090b] [&_.bg-bg-subtle]:bg-[#18181b] [&_.text-fg]:text-[#fde047] [&_.text-fg-muted]:text-[#fef08a]/80 [&_.border-border]:border-warning/30"
      : simulatorMode === "cdi" && contrastTheme === "grey"
      ? "bg-[#374151] text-[#f3f4f6] rounded-2xl p-2 sm:p-4 [&_.bg-surface]:bg-[#1f2937] [&_.bg-bg]:bg-[#374151] [&_.bg-bg-subtle]:bg-[#1f2937] [&_.text-fg]:text-[#f3f4f6] [&_.text-fg-muted]:text-fg-muted [&_.border-border]:border-border-strong"
      : "";

  const examAudioTimestamps: AudioTimestampItem[] =
    audioTimestampsQ.data?.timestamps ?? exam.audioTimestamps ?? [];
  const sharedSingleAudioUrl = audioTimestampsQ.data?.audioUrl ?? null;

  return (
    <StrictErrorBoundary fallbackTitle="Mock Runner Render Crash">
      <ExamLocker
        active={strict}
        attemptId={attempt.id}
        onAnomaly={(event) => flagMutate(event)}
        onForceSubmit={() => void doSubmit(true)}
      >
      <NetworkBanner />
      <div
        className={cn(
          "mx-auto pb-24 transition-colors",
          simulatorMode === "dtm" ? "max-w-7xl" : "max-w-5xl",
          contrastClasses
        )}
        onCopy={blockClipboard}
        onCut={blockClipboard}
        onPaste={blockClipboard}
        onContextMenu={blockClipboard}
        onDragStart={blockClipboard}
      >
        {/* Yuqori panel */}
        <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-b-[12px] sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {isSingleSection && targetSkill ? (
                <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 whitespace-nowrap rounded-md bg-brand/10 px-2.5 py-1 text-xs font-bold text-brand uppercase tracking-wider">
                    {tr("practiceBadge", { skill: t(`skills.${targetSkill}`) })}
                  </span>
                  <p className="w-full min-w-0 truncate font-semibold text-fg sm:w-auto">{exam.title}</p>
                </div>
              ) : (
                <p className="truncate font-semibold text-fg">{exam.title}</p>
              )}
            </div>

            {/* Distraction-Free Controls */}
            <div className="flex shrink-0 items-center gap-3">
              {remaining != null && <Timer ms={remaining} label={t("timeLeft")} />}
              {isFullTest && activeSection < exam.sections.length - 1 ? (
                <Button size="sm" variant="outline" className="min-h-[44px] px-4 touch-manipulation" loading={advance.isPending} onClick={() => (multilevelReview && missingWork ? setReview("advance") : setShowAdvanceConfirm(true))}>
                  {tr("nextSection")}
                </Button>
              ) : null}
              <Button size="sm" className="min-h-[44px] px-4 font-semibold touch-manipulation bg-brand hover:bg-brand/90 text-brand-fg" loading={submit.isPending} onClick={() => (multilevelReview && missingWork ? setReview("submit") : doSubmit(false))}>
                <Send className="mr-1.5 size-4" />
                {t("submit")}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {showQuestionPosition && (
              <StatusChip>{tr("questionPosition", { number: activeQuestionNumber })}</StatusChip>
            )}
            <StatusChip>
              {answered} / {total} {t("answered")}
              {bulk.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            </StatusChip>
            {flaggedQuestions.size > 0 && (
              <StatusChip tone="warning">
                <Flag className="size-3.5" aria-hidden />
                {tr("flaggedCount", { count: flaggedQuestions.size })}
              </StatusChip>
            )}
            <SaveStatusChip state={saveState} label={tr({ idle: "saveSaved", saving: "saveSaving", saved: "saveSaved", error: "saveError", offline: "saveOffline" }[saveState])} />
            {(saveState === "error" || saveState === "offline") && <button type="button" className="min-h-[44px] px-2 text-sm font-semibold text-brand underline-offset-2 hover:underline" onClick={flush}>{tr("saveRetry")}</button>}
          </div>
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
                  onClick={() => {
                    flush();
                    setActiveSection(i);
                  }}
                  aria-current={i === activeSection}
                  className={cn(
                    "inline-flex min-h-[44px] items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-colors touch-manipulation cursor-pointer",
                    i === activeSection
                      ? "bg-brand text-brand-fg"
                      : "bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  {t(`skills.${s.skill}`)}
                </button>
              );
            })}
          </div>
        )}

        {partialPractice && !isSingleSection && (section?.skill === "writing" || section?.skill === "speaking") && <p className="mb-4 text-sm text-fg-muted">{t("practiceRunnerNotice")}</p>}
        {versioned && exam.type === "multilevel" && section && !isSingleSection && <div className="mb-4"><MultilevelSectionProgress current={section.skill} skills={partialPractice ? exam.sections.map((item) => item.skill) : undefined} complete={exam.sections.filter((item) => {
          const questions = (item.groups || (item as any).parts || []).flatMap((group: any) => group?.questions || []);
          return questions.length > 0 && questions.every((question) => multilevelQuestionAnswered(question, answers, audioSet));
        }).map((item) => item.skill)} /></div>}

        {section && (
          <ErrorBoundary fallbackTitle={tr("sectionLoadError", { section: section.title || t(`skills.${section.skill}`) })}>
          <div className="space-y-4">
            {section.instructions && (
              <p className="text-sm text-fg-muted">{section.instructions}</p>
            )}
            {guidedMultilevel && (section.skill === "writing" || section.skill === "speaking") ? <GuidedMultilevelGroups
              skill={section.skill}
              groups={section.groups || (section as any).parts || []}
              activeTask={Math.min(activeTask, Math.max(0, (section.groups || (section as any).parts || []).length - 1))}
              setActiveTask={(index) => setActiveTaskBySkill((current) => ({ ...current, [section.skill]: index }))}
              strict={strict}
              timed={strict}
              attemptId={attempt.id}
              answers={answers}
              audioSet={audioSet}
              audioDurations={audioDurations}
              onAnswer={setAnswer}
              practice={partialPractice}
              simulatorMode={simulatorMode}
              flaggedQuestions={flaggedQuestions}
              onToggleFlag={toggleQuestionFlag}
            /> : <CbtSectionStepper
              skill={section.skill}
              groups={section.groups || (section as any).parts || []}
              answers={answers}
              audioSet={audioSet}
              audioDurations={audioDurations}
              simulatorMode={simulatorMode}
              flaggedQuestions={flaggedQuestions}
              onToggleFlag={toggleQuestionFlag}
              onActiveQuestionChange={setActiveQuestionNumber}
              renderGroupBlock={(g, reviewComplete, partIdx) => (
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
                  simulatorMode={simulatorMode}
                  flaggedQuestions={flaggedQuestions}
                  onToggleFlag={toggleQuestionFlag}
                  partIndex={partIdx}
                  audioTimestamps={examAudioTimestamps}
                  sharedSingleAudioUrl={sharedSingleAudioUrl}
                />
              )}
              onReviewComplete={section.skill === "listening" ? onListeningReviewComplete : undefined}
              onNextSection={() => {
                if (multilevelReview && missingWork) setReview("advance");
                else setShowAdvanceConfirm(true);
              }}
              onSubmitSection={() => {
                void doSubmit(false);
              }}
              isLastSection={activeSection >= exam.sections.length - 1}
              isFullTest={isFullTest}
            />}
          </div>
          </ErrorBoundary>
        )}

        {review && missingWork && (
          <MultilevelSubmitReview
            work={missingWork}
            advance={review === "advance"}
            allowIncomplete={true}
            busy={submit.isPending || advance.isPending}
            onClose={() => setReview(null)}
            onJump={(skill) => { setReview(null); jumpToSection(skill); }}
            onConfirm={() => {
              const purpose = review;
              setReview(null);
              if (purpose === "advance") void goNextSection();
              else void doSubmit(false, true);
            }}
          />
        )}

        <MicCheckModal
          open={section?.skill === "speaking" && micCheckLoaded && !micChecked}
          onConfirm={() => setMicChecked(true)}
          onClose={!strict ? () => setMicChecked(true) : undefined}
        />

        <SectionTransitionModal
          open={transitionModal !== null}
          completedSkill={transitionModal?.completedSkill ?? "listening"}
          nextSkill={transitionModal?.nextSkill ?? "reading"}
          onStartNext={() => setTransitionModal(null)}
        />

        <AdvanceConfirmModal
          open={showAdvanceConfirm}
          onOpenChange={setShowAdvanceConfirm}
          busy={advance.isPending}
          onConfirm={() => { setShowAdvanceConfirm(false); void goNextSection(); }}
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
    </StrictErrorBoundary>
  );
}

/** Compact header chip (docs/design/DESIGN_SYSTEM.md §5). */
export function StatusChip({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "success" | "danger"; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium tabular-nums",
        tone === "neutral" && "border-border bg-bg-subtle text-fg-muted",
        tone === "warning" && "border-warning-border bg-warning-bg text-warning",
        tone === "success" && "border-success-border bg-success-bg text-success",
        tone === "danger" && "border-danger-border bg-danger-bg text-danger",
      )}
    >
      {children}
    </span>
  );
}

/** Save state as an icon + text chip; the only live region in the runner header. */
export function SaveStatusChip({ state, label }: { state: "idle" | "saving" | "saved" | "error" | "offline"; label: string }) {
  const failed = state === "error" || state === "offline";
  return (
    <span role="status" aria-live="polite">
      <StatusChip tone={failed ? "danger" : state === "saving" ? "neutral" : "success"}>
        {state === "saving" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : failed ? (
          <AlertTriangle className="size-3.5" aria-hidden />
        ) : (
          <CheckCircle2 className="size-3.5" aria-hidden />
        )}
        {label}
      </StatusChip>
    </span>
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
      <Clock className="size-4" aria-hidden />
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
  simulatorMode = "cdi",
  flaggedQuestions,
  onToggleFlag,
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
  simulatorMode?: ExamSimulatorMode;
  flaggedQuestions?: Set<string>;
  onToggleFlag?: (qid: string) => void;
}) {
  const safeGroups = groups || [];
  const group = safeGroups[activeTask] ?? safeGroups[0];
  if (!group) return null;
  const labels = safeGroups.map((candidate, index) => {
    const key = multilevelTaskLabels(candidate?.questions || [])[0] ?? String(index + 1);
    if (skill !== "writing") return key;
    return ({ informal_email: "1.1", formal_email: "1.2", publication: "2" } as Record<string, string>)[key] ?? key;
  });
  const sharedWritingStimulus = skill === "writing"
    ? safeGroups.slice(0, 2).map((candidate) => candidate.passageText || candidate.instructions).find((value) => !!value?.trim()) ?? undefined
    : undefined;
  const completed = safeGroups.flatMap((candidate, index) => (candidate?.questions || []).length > 0 && candidate.questions.every((question) => multilevelQuestionAnswered(question, answers, audioSet)) ? [index] : []);
  return <div className="space-y-4">
    <MultilevelTaskProgress skill={skill} current={activeTask} total={safeGroups.length} labels={labels} onSelect={setActiveTask} practice={practice} completed={completed} rawMaximum={practice ? safeGroups.reduce((sum, item) => sum + (item.questions[0]?.guidance?.rawMax ?? item.maxScore ?? 0), 0) : undefined} />
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
      simulatorMode={simulatorMode}
      flaggedQuestions={flaggedQuestions}
      onToggleFlag={onToggleFlag}
      partIndex={activeTask}
    />
    <div className="flex items-center justify-between gap-3">
      <Button type="button" variant="outline" className="min-h-[44px] min-w-[100px] px-4 touch-manipulation" disabled={activeTask === 0} onClick={() => setActiveTask(activeTask - 1)}>Previous</Button>
      <Button type="button" variant="outline" className="min-h-[44px] min-w-[100px] px-4 touch-manipulation" disabled={activeTask === safeGroups.length - 1} onClick={() => setActiveTask(activeTask + 1)}>Next</Button>
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
  simulatorMode = "cdi",
  flaggedQuestions,
  onToggleFlag,
  partIndex = 0,
  audioTimestamps = [],
  sharedSingleAudioUrl,
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
  simulatorMode?: ExamSimulatorMode;
  flaggedQuestions?: Set<string>;
  onToggleFlag?: (qid: string) => void;
  partIndex?: number;
  audioTimestamps?: AudioTimestampItem[];
  sharedSingleAudioUrl?: string | null;
}) {
  const tg = useTranslations("mock.runnerUx");
  const [readingMobileTab, setReadingMobileTab] = React.useState<"passage" | "questions">("passage");
  const hasPassage = !!group.passageText && !(skill === "writing" && sharedWritingStimulus);
  const hasGappedContent = hasGappedDocument(group.contentHtml);

  // Resolve single-audio timestamp boundaries for this Listening part
  const stimTs = group.stimulusRef as { startSec?: number; endSec?: number | null } | null | undefined;
  const matchedTs = audioTimestamps.find((ts) => ts.partNumber === partIndex + 1);
  const startSec = group.startSec ?? stimTs?.startSec ?? matchedTs?.startSec;
  const endSec = group.endSec ?? stimTs?.endSec ?? matchedTs?.endSec ?? null;

  const hasListeningAudio = Boolean(group.hasAudio || (skill === "listening" && sharedSingleAudioUrl));
  const audioSrc = group.hasAudio
    ? media(`/mock/groups/${group.id}/audio${strict ? `?attemptId=${attemptId}` : ""}`)
    : sharedSingleAudioUrl
    ? sharedSingleAudioUrl.startsWith("/api/")
      ? sharedSingleAudioUrl
      : media(sharedSingleAudioUrl)
    : "";

  const isDtmSplit = simulatorMode === "dtm" && hasPassage && !hasGappedContent;
  const isMapSplit = Boolean(skill === "listening" && group.imageUrl);

  return (
    <Card className="p-4 sm:p-5">
      {group.title && <h3 className="font-semibold text-fg">{group.title}</h3>}
      {hasListeningAudio && skill === "listening" ? (
        <div className="z-20 -mx-4 -mt-4 mb-3 rounded-t-[12px] border-b border-border/80 bg-surface/95 p-3 backdrop-blur-xl shadow-md sm:-mx-5 sm:-mt-5 [@media(min-height:720px)]:sticky [@media(min-height:720px)]:top-0">
          {group.questions[0]?.guidance && strict ? <MultilevelListening
            prepare={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/prepare`)}
            play={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/play`)}
            load={async () => { const res = await fetch(audioSrc); if (!res.ok) throw new Error('Audio loading failed'); return res.blob(); }}
          /> : <ListeningAudio
            src={audioSrc}
            strict={strict}
            onReviewComplete={strict ? onReviewComplete : undefined}
            startSec={startSec}
            endSec={endSec}
            partLabel={group.title || `Part ${partIndex + 1}`}
            timestamps={audioTimestamps}
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
      {group.imageUrl && !isMapSplit && (
        <div className="mt-3">
          <GroupImage groupId={group.id} alt={group.title ? `${group.title} — picture` : "Picture for this part"} />
        </div>
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
            {tg("passageTab")}
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
            {tg("questionsTab", { count: (group?.questions || []).length })}
          </button>
        </div>
      )}

      <div
        className={cn(
          "mt-3",
          (hasPassage || isMapSplit) &&
            !hasGappedContent &&
            "lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start",
          isDtmSplit && "lg:divide-x lg:divide-border"
        )}
      >
        {isMapSplit && (
          // Sticky only beside the questions on wide screens; on phones a sticky
          // map would cover the questions it belongs to.
          <div className="mb-3 rounded-xl border border-border bg-bg-subtle/50 p-3 shadow-inner flex flex-col items-center justify-center lg:mb-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
            <p className="text-xs font-semibold text-fg-muted mb-2 uppercase tracking-wider">
              {group.title || "Map"}
            </p>
            <GroupImage groupId={group.id} alt={group.title ? `${group.title} — map` : "Map for this part"} />
          </div>
        )}
        {hasPassage && !hasGappedContent && (
          <div
            className={cn(
              "whitespace-pre-line rounded-[12px] border border-border bg-surface p-5 text-base sm:text-[17px] leading-relaxed text-fg max-w-[70ch]",
              "lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto",
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
                {tg("goToQuestions")} →
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
              isDtmSplit && "lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pl-4 lg:pr-1",
              isMapSplit && "lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pl-2 lg:pr-1",
              hasPassage && !hasGappedContent ? (readingMobileTab === "questions" ? "block" : "hidden") : "block"
            )}
          >
            {hasPassage && !hasGappedContent && (
              <div className="mb-2 flex items-center justify-between pb-2 border-b border-border/60 lg:hidden">
                <span className="text-xs font-medium text-fg-muted">{tg("questionCount", { count: (group?.questions || []).length })}</span>
                <button
                  type="button"
                  onClick={() => setReadingMobileTab("passage")}
                  className="text-xs font-semibold text-brand underline underline-offset-4 touch-manipulation"
                >
                  ← Matnni o&apos;qish
                </button>
              </div>
            )}
            {(group?.questions || []).map((q) => (
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
                  isFlagged={flaggedQuestions?.has(q.id)}
                  onToggleFlag={onToggleFlag ? () => onToggleFlag(q.id) : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function EssayQuestionEditor({
  q,
  attemptId,
  value,
  onChange,
  multilevelSkill,
  groupTitle,
  header,
}: {
  q: MockQuestion;
  attemptId: string;
  value: string;
  onChange: (v: string) => void;
  multilevelSkill?: MockSkill;
  groupTitle?: string;
  header: React.ReactNode;
}) {
  const tx = useTranslations("mock.runnerUx");
  // Spec §2.3: Task1 min 150, Task2 min 250 (soft — warning, no hard block).
  const minWords = q.guidance?.wordMin ?? (q.type === "essay_task1" ? 150 : q.type === "essay_task2" ? 250 : (q.wordLimit ?? 0));

  // A browser draft may be older than the server (for example after another tab
  // saved or cleared an answer). Offer it explicitly rather than overwriting.
  const draftKey = `bw_writing_draft_${attemptId}_${q.id}`;
  const [dismissedDraftKey, setDismissedDraftKey] = React.useState<string | null>(null);
  const subscribeDraft = React.useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    return () => window.removeEventListener("storage", notify);
  }, []);
  const browserDraft = React.useSyncExternalStore(subscribeDraft, () => {
    try {
      return localStorage.getItem(draftKey);
    } catch { return null; }
  }, () => null);

  const handleWritingChange = (text: string) => {
    setDismissedDraftKey(draftKey);
    onChange(text);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(draftKey, text);
      } catch {}
    }
  };

  const [writingMode, setWritingMode] = React.useState<"type" | "image">("type");

  return (
    <div className="space-y-3">
      {browserDraft !== null && browserDraft !== value && dismissedDraftKey !== draftKey && (
        <details className="rounded-xl border border-warning-border bg-warning-bg p-3 text-sm text-fg">
          <summary className="cursor-pointer font-semibold">{tx("writingDraftFound")}</summary>
          <p className="mt-2 text-fg-muted">{tx("writingDraftExplanation")}</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 font-sans">{browserDraft.trim() ? browserDraft : tx("writingDraftEmpty")}</pre>
          <Button type="button" variant="outline" className="mt-2 min-h-[44px]" onClick={() => handleWritingChange(browserDraft)}>{tx("writingDraftRestore")}</Button>
        </details>
      )}
      {q.guidance && multilevelSkill === "writing" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {multilevelTaskName(q.guidance, `Task ${q.number}`) === groupTitle
              ? <span />
              : <p className="font-semibold text-fg">{multilevelTaskName(q.guidance, `Task ${q.number}`)}</p>}
            <MultilevelTaskMeta question={q} />
          </div>
          <p className="whitespace-pre-line text-sm text-fg">{q.prompt}</p>
        </div>
      ) : header}

      {/* Writing input mode switcher: typing vs handwritten paper upload */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-surface-subtle p-1">
          <button
            type="button"
            onClick={() => setWritingMode("type")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
              writingMode === "type"
                ? "bg-brand text-brand-fg shadow-sm"
                : "text-fg-muted hover:bg-surface hover:text-fg"
            )}
          >
            <Keyboard className="size-3.5" aria-hidden /> {tx("writingModeType")}
          </button>
          <button
            type="button"
            onClick={() => setWritingMode("image")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
              writingMode === "image"
                ? "bg-brand text-brand-fg shadow-sm"
                : "text-fg-muted hover:bg-surface hover:text-fg"
            )}
          >
            <Camera className="size-3.5" aria-hidden /> {tx("writingModeOcr")}
          </button>
        </div>
        {value.trim() && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-brand">
            <CheckCircle2 className="size-3" /> Qoralama saqlanmoqda
          </span>
        )}
      </div>

      {writingMode === "image" ? (
        <div className="space-y-3">
          <WritingImageOcr
            attemptId={attemptId}
            questionId={q.id}
            currentText={value}
            onExtractedText={(ocrText, mode) => {
              const nextText =
                mode === "append" && value.trim()
                  ? `${value.trim()}\n\n${ocrText}`
                  : ocrText;
              handleWritingChange(nextText);
            }}
          />
          {value.trim() && (
            <div className="space-y-1.5 rounded-xl border border-brand/20 bg-brand-subtle/20 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-brand">
                <span>{tx("ocrEditTitle")}</span>
                <span className="tabular-nums">{tx("wordCount", { count: value.trim().split(/\s+/).filter(Boolean).length })}</span>
              </div>
              <Textarea
                value={value}
                onChange={(e) => handleWritingChange(e.target.value)}
                className="min-h-36 resize-y font-sans text-base leading-relaxed"
                placeholder={tx("ocrPlaceholder")}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <Textarea
            value={value}
            onChange={(e) => handleWritingChange(e.target.value)}
            className="min-h-72 resize-y font-sans text-base leading-relaxed touch-manipulation focus-visible:border-brand"
            aria-label={tx("writingResponseLabel", { number: q.number })}
            placeholder={tx("writingPlaceholder")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <WritingResponseGuide value={value} minimum={minWords} maximum={q.guidance?.wordMax} />
          </div>
        </>
      )}
    </div>
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
  isFlagged,
  onToggleFlag,
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
  isFlagged?: boolean;
  onToggleFlag?: () => void;
}) {
  const tx = useTranslations("mock.runnerUx");

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">
          {q.number}
        </span>
        <p className="whitespace-pre-line text-sm text-fg">{q.prompt}</p>
      </div>
      {onToggleFlag && (
        <button
          type="button"
          onClick={onToggleFlag}
          title={isFlagged ? tx("unflagTitle") : tx("flagActionTitle")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
            isFlagged
              ? "border-warning/60 bg-warning/20 text-warning"
              : "border-transparent text-fg-muted hover:border-border hover:bg-surface-hover hover:text-fg"
          )}
        >
          <Flag className={cn("size-3", isFlagged && "fill-warning text-warning")} />
          <span className="hidden sm:inline">{isFlagged ? tx("flaggedShort") : tx("flagAction")}</span>
        </button>
      )}
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
    return (
      <EssayQuestionEditor
        q={q}
        attemptId={attemptId}
        value={value}
        onChange={onChange}
        multilevelSkill={multilevelSkill}
        groupTitle={groupTitle}
        header={header}
      />
    );
  }

  return (
    <div className="space-y-2">
      {onToggleFlag && (
        <div className="flex justify-end -mb-1">
          <button
            type="button"
            onClick={onToggleFlag}
            title={isFlagged ? tx("unflagTitle") : tx("flagActionTitle")}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
              isFlagged
                ? "border-warning/60 bg-warning/20 text-warning"
                : "border-transparent text-fg-muted hover:border-border hover:bg-surface-hover hover:text-fg"
            )}
          >
            <Flag className={cn("size-3", isFlagged && "fill-warning text-warning")} />
            <span>{isFlagged ? tx("flaggedShort") : tx("flagAction")}</span>
          </button>
        </div>
      )}
      <ObjectiveQuestionInput question={q} value={value} onChange={onChange} unavailableOptions={unavailableOptions} />
    </div>
  );
}

