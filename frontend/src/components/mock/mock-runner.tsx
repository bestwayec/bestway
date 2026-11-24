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
import { GappedContent, hasGappedDocument, sanitizeGappedContent } from "@/components/mock/gapped-content";
import { MultilevelListening, MultilevelRecorder, type MediaPhase } from './multilevel-media';
import { SpeakingRecorder } from './speaking-recorder';
import { recordingFileName } from '@/lib/microphone';
import { api } from '@/lib/api-client';
import { hasPendingRecordings, hasActiveRecording } from '@/lib/durable-recordings';
import { MatchingOptionBank, ObjectiveQuestionInput } from './objective-question-input';
import { sharedMatchingOptions, usedMatchingOptions } from '@/lib/objective-question';
import { MultilevelSectionProgress, MultilevelTaskMeta, MultilevelTaskProgress, multilevelTaskLabels, multilevelTaskName, isExplainedSaveError, studentSaveErrorMessage, studentSubmitMessage, studentSubmitNeedsReview } from './multilevel-student-ui';
import { MultilevelSubmitReview } from './multilevel-submit-review';
import { multilevelMissingWork } from '@/lib/multilevel-completeness';
import { isPartialPractice, practiceExam } from '@/lib/mock-practice';
import { ResponseProgress, WritingResponseGuide } from './exam-response-progress';
import { multilevelQuestionAnswered } from '@/lib/multilevel-completeness';
import { canSelectSpeakingPart, nextSpeakingTarget, requestSpeakingAutoStart } from '@/lib/speaking-sequence';
import { ExamLocker } from "./exam-locker";
import { ReadingSplitDivider, useReadingSplit, useWritingSplit } from "./reading-split-divider";
import type { ListeningSchedule } from "@/lib/listening-schedule";
import { ExamSessionGate, useExamSession } from "./exam-session-gate";
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
import { clipboardDecision, countWords, suggestedWritingMinutes, WRITING_AREA_ATTRIBUTE } from "@/lib/writing-rules";
import { ExamToolbar, type ExamToolbarHandle } from "./exam-toolbar";
import { COLOUR_CLASS, DEFAULT_EXAM_SETTINGS, EXAM_VOLUME_EVENT, loadExamSettings, saveExamSettings, TEXT_ZOOM, timerAlert, timerTone, type ExamSettings } from "@/lib/exam-settings";
import { readLocal, resolveOnOpen, toDocument, touchLocal } from "@/lib/exam-workspace";
import { ExamNotesPanel } from "./exam-notes-panel";
import { VocabLookup, VOCAB_TEXT_ATTRIBUTE } from "./vocab-lookup";
import { AudioScriptToggle, RevealAnswer } from "./practice-tools";
import { RunnerTools, PhoneToolsRow, ClearAnswersDialog } from "./runner-tools";
import { ShortcutsDialog, useRunnerShortcuts } from "./runner-shortcuts";
import { highlightCurrentSelection } from "./cbt-annotated-text";
import {
  isMemoryEdit, loadQueue, persistEdit, readUnconfirmedSubmit, rememberUnconfirmedSubmit, removeEdit,
  type AnswerEdit, type AnswerReceipt, type QueuedAnswer,
} from "@/lib/answer-queue";
import { AnswerQueueBanner } from "./answer-queue-banner";
import { ApiError } from "@/lib/api-client";
import { installHaptics } from "@/lib/haptics";
import { WritingImageOcr } from "./writing-image-ocr";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { LoadErrorPanel } from "@/components/common/load-error-panel";

const ESSAY = new Set<MockQuestionType>(["essay_task1", "essay_task2"]);

type SaveState = "idle" | "queued" | "saving" | "saved" | "retrying" | "error" | "offline" | "conflict";

function isExamTimeUp(error: unknown) {
  return error instanceof ApiError && ["MOCK_TIME_UP", "MOCK_SECTION_TIME_UP"].includes(error.code);
}

function isSubmitted(status: unknown): boolean {
  return status === "grading" || status === "completed";
}


/** Media backend proxy orqali oqadi — token httpOnly cookie'da */
const media = (path: string) => `/api/backend${path}`;

import { examContentUnits } from "@/lib/exam-content-units";
import { gapNumbersIn } from "@/components/exam-builder/reading-preview-model";
import { nextSectionOnTimeout } from "@/lib/section-timeout";
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

// Sections list their groups as `groups` (newer exams) or `parts` (older ones).
type SectionGroupShape = { title?: string | null; hasAudio?: boolean; questions?: Array<{ id: string; number?: number; displayNumber?: number | null; type?: unknown }> };
function sectionGroupsOf(section: unknown): SectionGroupShape[] {
  const value = section as { groups?: unknown; parts?: unknown } | null | undefined;
  if (value?.groups) return value.groups as SectionGroupShape[];
  return (value?.parts as SectionGroupShape[] | undefined) || [];
}

export function MockRunner({ attempt, refreshAttempt }: { attempt: MockAttemptDetail; refreshAttempt?: () => void }) {
  const t = useTranslations("mock");
  const tc = useTranslations("common");
  const tm = useTranslations("errorPanel");
  const tr = useTranslations("mock.runnerUx");
  const ts = useTranslations("mock.sectionStart");
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
  // Text size, colours and volume chosen in Settings (this device only).
  const [examSettings, setExamSettings] = React.useState<ExamSettings>(() => (typeof window === "undefined" ? DEFAULT_EXAM_SETTINGS : loadExamSettings()));
  const updateExamSettings = React.useCallback((next: ExamSettings) => { setExamSettings(next); saveExamSettings(next); }, []);
  React.useEffect(() => {
    const onVolume = (event: Event) => {
      const volume = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(volume)) setExamSettings((current) => { const next = { ...current, volume }; saveExamSettings(next); return next; });
    };
    window.addEventListener(EXAM_VOLUME_EVENT, onVolume);
    return () => window.removeEventListener(EXAM_VOLUME_EVENT, onVolume);
  }, []);
  const [notesDrawerOpen, setNotesDrawerOpen] = React.useState(false);
  // Header panels and tools: Info (status and instructions), focus mode, word lookup (practice only), clear answers.
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [focusMode, setFocusMode] = React.useState(false);
  // "?" lists the keyboard shortcuts; H highlights the selected text (N / P / F live in the stepper).
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  useRunnerShortcuts({
    help: () => setShortcutsOpen(true),
    highlight: () => { if (!highlightCurrentSelection()) toast.info(tr("highlightHint")); },
  });
  const [vocabOn, setVocabOn] = React.useState(false);
  const [clearOpen, setClearOpen] = React.useState(false);
  const toolbarRef = React.useRef<ExamToolbarHandle>(null);
  const [attemptNotes, setAttemptNotes] = React.useState<CbtStickyNote[]>([]);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  // Flags, highlights and notes are kept with the attempt on the server; the newer of the
  // server copy and this device's cache is shown when the exam opens.
  const [workspaceAtOpen] = React.useState(() => resolveOnOpen(attempt.id, attempt.annotations));
  const [flaggedQuestions, setFlaggedQuestions] = React.useState<Set<string>>(() => new Set(workspaceAtOpen.workspace.flags));
  // The question the student is on, remembered with its section so another section never shows it.
  const [activeQuestion, setActiveQuestion] = React.useState<{ section: string | null; number: number }>({ section: null, number: 1 });
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

  // Send the workspace to the server one second after the last change; retried on the next
  // change or when the connection comes back. Failures never interrupt the exam.
  // Server clock offset, measured once when the attempt opens; edit times and deadlines are on the server clock.
  const [openingOffset] = React.useState(() => (attempt.serverTime ? Date.parse(attempt.serverTime) - Date.now() : 0));
  const serverOffsetRef = React.useRef(openingOffset);
  const workspacePending = React.useRef(workspaceAtOpen.push);
  const workspaceTimer = React.useRef<number | null>(null);
  const flagsRef = React.useRef(flaggedQuestions);
  const pushWorkspace = React.useCallback(() => {
    if (!workspacePending.current) return;
    const local = readLocal(attempt.id);
    const document = toDocument({ ...local, flags: [...flagsRef.current] });
    api.put(`/mock/attempts/${attempt.id}/annotations`, { annotations: document })
      .then(() => { workspacePending.current = false; })
      .catch(() => { workspacePending.current = true; });
  }, [attempt.id]);
  const scheduleWorkspace = React.useCallback(() => {
    workspacePending.current = true;
    touchLocal(attempt.id, [...flagsRef.current], Date.now() + serverOffsetRef.current);
    if (workspaceTimer.current) window.clearTimeout(workspaceTimer.current);
    workspaceTimer.current = window.setTimeout(pushWorkspace, 1000);
  }, [attempt.id, pushWorkspace]);
  React.useEffect(() => {
    if (workspaceAtOpen.push) pushWorkspace();
    window.addEventListener("online", pushWorkspace);
    return () => {
      window.removeEventListener("online", pushWorkspace);
      if (workspaceTimer.current) window.clearTimeout(workspaceTimer.current);
    };
  }, [pushWorkspace, workspaceAtOpen.push]);

  React.useEffect(() => {
    const syncNotes = () => setAttemptNotes(loadAttemptNotes(attempt.id));
    syncNotes();
    const changed = () => { syncNotes(); scheduleWorkspace(); };
    window.addEventListener(CBT_ANNOTATIONS_UPDATED_EVENT, changed);
    return () => window.removeEventListener(CBT_ANNOTATIONS_UPDATED_EVENT, changed);
  }, [attempt.id, scheduleWorkspace]);

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
    const next = new Set(flagsRef.current);
    if (next.has(qid)) next.delete(qid);
    else next.add(qid);
    flagsRef.current = next;
    setFlaggedQuestions(next);
    scheduleWorkspace();
  }, [scheduleWorkspace]);

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
    const revisions: Record<string, string | null> = {};
    for (const s of (attempt?.sections || [])) {
      const groups = s?.groups || (s as any)?.parts || [];
      for (const g of groups) {
        for (const q of (g?.questions || [])) {
          ans[q.id] = q.response ?? "";
          revisions[q.id] = q.answerRevision ?? null;
          if (q.hasAudio) audio.add(q.id);
          if (q.hasAudio && q.audioDurationMs != null) durations[q.id] = q.audioDurationMs;
        }
      }
    }
    return { ans, audio, durations, revisions };
  }, [attempt]);

  // Recover device edits over the last authorized server snapshot.
  const [queuedAtStart] = React.useState(() => loadQueue(attempt.id));
  const [answers, setAnswers] = React.useState<Record<string, string>>(() => {
    const merged = { ...initial.ans };
    for (const [questionId, entry] of Object.entries(queuedAtStart)) if (questionId in merged) merged[questionId] = entry.response;
    return merged;
  });
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
  const revisions = React.useRef(initial.revisions);
  const edits = React.useRef(new Map(Object.entries(queuedAtStart).filter(([id]) => Object.hasOwn(initial.ans, id))));
  const conflicts = React.useRef(new Map<string, Extract<AnswerReceipt, { status: "conflict" }>>());
  const [writer] = React.useState(() => typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));
  const lastLocalEdit = React.useRef(Math.max(0, ...[...edits.current.values()].map((edit) => edit.editedAt)));
  const memoryOnly = React.useRef(new Set([...edits.current].filter(([id, edit]) =>
    isMemoryEdit(attempt.id, id, edit)).map(([id]) => id)));
  const [storageUnavailable, setStorageUnavailable] = React.useState(memoryOnly.current.size > 0);
  const [confirmedAnswers, setConfirmedAnswers] = React.useState(initial.ans);
  const [queuedCount, setQueuedCount] = React.useState(edits.current.size);
  const [conflictCount, setConflictCount] = React.useState(0);
  const [submitUnconfirmed, setSubmitUnconfirmed] = React.useState(() => readUnconfirmedSubmit(attempt.id));
  const activeQuestionIds = React.useMemo(() => {
    const section = attempt.sections?.find((item) => item.skill === attempt.currentSkill);
    return new Set(sectionGroupsOf(section).flatMap((group) => (group.questions ?? []).map((question) => question.id)));
  }, [attempt.sections, attempt.currentSkill]);
  const canSaveQuestion = React.useCallback((id: string) => !isFullTest || activeQuestionIds.has(id), [activeQuestionIds, isFullTest]);
  const saveItems = React.useCallback(() =>
    [...edits.current].filter(([id]) => canSaveQuestion(id) && !conflicts.current.has(id))
      .sort(([, left], [, right]) => left.editedAt - right.editedAt), [canSaveQuestion]);
  const submittingRef = React.useRef(false);
  const saveInFlight = React.useRef<Promise<unknown> | null>(null);
  const [saveRevision, setSaveRevision] = React.useState(0);
  // One active session per attempt: another tab or device that takes over stops this one
  // from changing answers; everything typed here stays queued until "continue here".
  const examSession = useExamSession(attempt.id, attempt.status === "in_progress", () => {
    setSaveRevision((revision) => revision + 1);
    pushWorkspace();
  });
  const sessionElsewhereRef = React.useRef(false);
  React.useEffect(() => { sessionElsewhereRef.current = examSession.elsewhere; }, [examSession.elsewhere]);
  const [saveState, setSaveState] = React.useState<SaveState>(edits.current.size ? "queued" : "idle");
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

  // Refetches can update clean fields, but never replace an edit or a more recent receipt.
  React.useEffect(() => {
    const clean: Record<string, string> = {};
    for (const [id, value] of Object.entries(initial.ans)) {
      const remote = initial.revisions[id];
      const known = revisions.current[id];
      if (edits.current.has(id) || (known && (!remote || remote < known))) continue;
      revisions.current[id] = remote;
      if (answersRef.current[id] !== value) clean[id] = value;
    }
    if (!Object.keys(clean).length) return;
    answersRef.current = { ...answersRef.current, ...clean };
    setAnswers(answersRef.current);
    setConfirmedAnswers((confirmed) => ({ ...confirmed, ...clean }));
  }, [initial]);

  const updateQueueState = React.useCallback(() => {
    setQueuedCount(edits.current.size);
    setConflictCount(conflicts.current.size);
    setStorageUnavailable(memoryOnly.current.size > 0);
    setSaveState(conflicts.current.size ? "conflict" : edits.current.size ? "queued" : "saved");
  }, []);

  const savePending = React.useCallback(async () => {
    const items = saveItems();
    if (items.length) setSaveState((state) => state === "retrying" ? state : "saving");
    for (let offset = 0; offset < items.length; offset += 200) {
      const batch = items.slice(offset, offset + 200);
      const payload: AnswerEdit[] = batch.map(([questionId, { response, editedAt, baseRevision }]) => ({
        questionId, response, editedAt, ...(baseRevision !== undefined ? { baseRevision } : {}),
      }));
      const result = await bulkMutateAsync(payload);
      if (result.saved !== batch.length || !result.receipts || batch.some(([id, edit]) => {
        const receipt = result.receipts?.[id];
        return !receipt || receipt.editedAt !== edit.editedAt ||
          (receipt.revision !== null && typeof receipt.revision !== "string") ||
          (receipt.status !== "saved" && (receipt.status !== "conflict" || typeof receipt.response !== "string"));
      })) throw new Error("Missing answer acknowledgment");
      const confirmed: Record<string, string> = {};
      for (const [id, sent] of batch) {
        const receipt = result.receipts[id];
        revisions.current[id] = receipt.revision;
        if (receipt.status === "conflict") {
          conflicts.current.set(id, receipt);
          confirmed[id] = receipt.response;
          continue;
        }
        confirmed[id] = sent.response;
        removeEdit(attempt.id, id, sent);
        const current = edits.current.get(id);
        if (current?.editedAt === sent.editedAt && current.response === sent.response) {
          edits.current.delete(id);
          memoryOnly.current.delete(id);
        } else if (current?.writer && current.baseRevision === sent.baseRevision) {
          // The next edit was typed while this request was in flight. Advance only
          // its base revision. The editor and journal retain its current value.
          const rebased = { ...current, writer: current.writer, baseRevision: receipt.revision };
          edits.current.set(id, rebased);
          if (persistEdit(attempt.id, id, rebased)) memoryOnly.current.delete(id);
          else memoryOnly.current.add(id);
        }
      }
      setConfirmedAnswers((previous) => ({ ...previous, ...confirmed }));
      updateQueueState();
    }
  }, [attempt.id, bulkMutateAsync, saveItems, updateQueueState]);

  const flush = React.useCallback((retry = false) => {
    if (saveInFlight.current || submittingRef.current || sessionElsewhereRef.current || !saveItems().length) return;
    if (!navigator.onLine) {
      setSaveState("offline");
      return;
    }
    setSaveState((state) => retry || state === "error" || state === "offline" ? "retrying" : "saving");
    let succeeded = false;
    saveInFlight.current = savePending().then(() => {
      succeeded = true;
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "EXAM_SESSION_ELSEWHERE") {
        sessionElsewhereRef.current = true;
        setSaveState("queued");
        return;
      }
      setSaveState(navigator.onLine ? "error" : "offline");
      if (versioned || isExplainedSaveError(error)) toast.error(studentSaveErrorMessage(error));
    }).finally(() => {
      saveInFlight.current = null;
      if (succeeded && saveItems().length) setSaveRevision((revision) => revision + 1);
    });
  }, [saveItems, savePending, versioned]);

  React.useEffect(() => {
    const id = setTimeout(flush, 1500);
    return () => clearTimeout(id);
  }, [answers, flush, saveRevision]);

  function setAnswer(qid: string, val: string) {
    if (submittingRef.current || submitUnconfirmed || !canSaveQuestion(qid) || !Object.hasOwn(initial.ans, qid)) return;
    const previous = edits.current.get(qid);
    const stamp = Math.max(Date.now() + serverOffsetRef.current, lastLocalEdit.current + 1);
    lastLocalEdit.current = stamp;
    const edit = { response: val, editedAt: stamp, writer, baseRevision: previous ? previous.baseRevision : revisions.current[qid] ?? null };
    edits.current.set(qid, edit);
    if (persistEdit(attempt.id, qid, edit)) {
      memoryOnly.current.delete(qid);
      if (previous && previous.writer !== writer) removeEdit(attempt.id, qid, previous);
    } else memoryOnly.current.add(qid);
    answersRef.current = { ...answersRef.current, [qid]: val };
    updateQueueState();
    if (!navigator.onLine) setSaveState("offline");
    setAnswers(answersRef.current);
  }

  function resolveConflicts(useLocal: boolean) {
    if (submittingRef.current || saveInFlight.current) return;
    const next = { ...answersRef.current };
    for (const [id, receipt] of conflicts.current) {
      const edit = edits.current.get(id);
      if (!edit) continue;
      if (useLocal) {
        const resolved = { ...edit, writer, baseRevision: receipt.revision };
        edits.current.set(id, resolved);
        if (persistEdit(attempt.id, id, resolved)) {
          memoryOnly.current.delete(id);
          if (edit.writer !== writer) removeEdit(attempt.id, id, edit);
        } else memoryOnly.current.add(id);
      } else {
        removeEdit(attempt.id, id, edit);
        edits.current.delete(id);
        memoryOnly.current.delete(id);
        next[id] = receipt.response;
      }
    }
    conflicts.current.clear();
    answersRef.current = next;
    setAnswers(next);
    updateQueueState();
  }

  React.useEffect(() => {
    const retry = () => flush(true);
    window.addEventListener("online", retry);
    const onOffline = () => { if (edits.current.size) setSaveState("offline"); };
    window.addEventListener("offline", onOffline);
    const id = window.setInterval(flush, 10000);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(id);
    };
  }, [flush]);

  // Native-feeling tap feedback on answer options and buttons (touch devices only).
  React.useEffect(() => installHaptics(), []);

  // Timer (faqat vaqtli rejim; full-test da umumiy deadline)
  const deadlineTs = isSingleSection && targetSkill && attempt.sectionDeadlines?.[targetSkill]
    ? attempt.sectionDeadlines[targetSkill]
    // Full test (Multilevel and IELTS): the server's deadline of the current section.
    : isFullTest && attempt.currentSkill && attempt.sectionDeadlines?.[attempt.currentSkill]
    ? attempt.sectionDeadlines[attempt.currentSkill]
    : attempt.overallDeadlineAt ?? attempt.deadlineAt;
  const overallDeadline = attempt.overallDeadlineAt ? Date.parse(attempt.overallDeadlineAt) : Infinity;
  const deadline = deadlineTs ? Math.min(Date.parse(deadlineTs), overallDeadline) : null;
  const serverOffset = openingOffset;
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
      if (submittingRef.current || sessionElsewhereRef.current) return;
      if (total <= 0) {
        toast.error(tr("noQuestionsToSubmit"));
        return;
      }
      if (!auto && !confirmed) {
        const isMockedConfirm = typeof window.confirm === "function" && !window.confirm.toString().includes("[native code]");
        if (!isMockedConfirm) {
          setShowSubmitConfirm(true);
          return;
        }
        if (!window.confirm(t("submitConfirm"))) return;
      }
      setShowSubmitConfirm(false);
      submittingRef.current = true;
      const payload = { confirm: true, ...(auto ? { requireExpired: true } : {}) };
      const checkResult = () => api.get<{ status: string }>(`/mock/attempts/${attempt.id}`).catch(() => null);
      let submitted = false;
      try {
        if (submitUnconfirmed || readUnconfirmedSubmit(attempt.id)) {
          const current = await checkResult();
          if (isSubmitted(current?.status)) {
            submitted = true;
            return;
          }
          if (current?.status !== "in_progress") return;
        }
        if (!navigator.onLine) {
          toast.error(tr("finishOffline"));
          return;
        }
        if (hasActiveRecording(attempt.id) ||
            ((versioned || attempt.currentSkill === "speaking") && await hasPendingRecordings(attempt.id))) {
          toast.error(tr("finishPendingRecording"));
          return;
        }
        await saveInFlight.current;
        try {
          await savePending();
        } catch (error) {
          setSaveState(navigator.onLine ? "error" : "offline");
          if (!auto || !isExamTimeUp(error)) throw error;
        }
        if (!auto && [...edits.current.keys()].some(canSaveQuestion)) {
          toast.error(tr("finishPendingAnswers"));
          return;
        }

        // Persist the uncertain hand-in before the request so reload can reconcile it.
        rememberUnconfirmedSubmit(attempt.id, true);
        try {
          const result = await submitMutateAsync(payload);
          if (!isSubmitted(result.status)) throw new Error("Missing submission acknowledgment");
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
            rememberUnconfirmedSubmit(attempt.id, false);
            setSubmitUnconfirmed(false);
            throw error;
          }
          const current = await checkResult();
          if (!isSubmitted(current?.status)) {
            setSubmitUnconfirmed(true);
            return;
          }
        }
        submitted = true;
      } catch (error) {
        if (error instanceof ApiError && error.code === "EXAM_DEADLINE_ACTIVE" && auto) return;
        if (studentSubmitNeedsReview(error)) setReview("submit");
        toast.error(isExamTimeUp(error) ? tr("saveExpired") : versioned ? studentSubmitMessage(error) : tr("finishPendingAnswers"));
      } finally {
        if (submitted) {
          rememberUnconfirmedSubmit(attempt.id, false);
          setSubmitUnconfirmed(false);
          if (liveRoomId) reportProgressMutate({ attemptId: attempt.id, status: "submitted" });
          toast.success(t("submitted"));
          refreshAttempt?.();
        } else {
          submittingRef.current = false;
        }
      }
    },
    [attempt.id, attempt.currentSkill, canSaveQuestion, liveRoomId, refreshAttempt, reportProgressMutate, savePending, submitMutateAsync, submitUnconfirmed, t, total, tr, versioned],
  );

  const goNextSection = React.useCallback(async (automatic = false) => {
    const currentSkill = attempt.currentSkill;
    if (submittingRef.current || sessionElsewhereRef.current || !currentSkill ||
        !attempt.sections.some((section) => section.skill === currentSkill)) return;
    submittingRef.current = true;
    try {
      await saveInFlight.current;
      try {
        await savePending();
      } catch (error) {
        setSaveState(navigator.onLine ? "error" : "offline");
        if (!automatic || !isExamTimeUp(error)) throw error;
      }
      const hasPending = [...edits.current.keys()].some((id) => activeQuestionIds.has(id));
      if (!automatic && hasPending) {
        toast.error(tr("finishPendingAnswers"));
        return;
      }
      const result = await advanceMutateAsync({ expectedSkill: currentSkill, ...(automatic ? { requireExpired: true } : {}) });
      if (!result.saved || !result.submittedSections.includes(currentSkill) || !result.currentSkill || result.currentSkill === currentSkill) {
        throw new Error("Missing section acknowledgment");
      }
      setSelectedSection(null);
      setTransitionModal({ completedSkill: currentSkill, nextSkill: result.currentSkill as MockSkill });
      toast.success(tr("nextSectionDone"));
      if (hasPending) toast.warning(tr("saveExpired"));
    } catch (error) {
      if (error instanceof ApiError && error.code === "EXAM_DEADLINE_ACTIVE" && automatic) return;
      refreshAttempt?.();
      toast.error(isExamTimeUp(error) ? tr("saveExpired") : tr("advanceUnconfirmed"));
    } finally {
      submittingRef.current = false;
    }
  }, [activeQuestionIds, advanceMutateAsync, attempt.currentSkill, attempt.sections, refreshAttempt, savePending, tr]);

  React.useEffect(() => {
    if (!deadline) return;
    const clock = setInterval(() => setServerNow(Date.now() + serverOffset), 1000);
    let nextRetry = 0;
    const id = setInterval(() => {
      const r = deadline - Date.now() - serverOffset;
      setRemaining(r);
      if (r <= 0 && !sessionElsewhereRef.current) {
        if (Date.now() < nextRetry || submittingRef.current) return;
        nextRetry = Date.now() + 10000;
        // Full test (Multilevel and IELTS): a section's time ends → the next section; only the
        // last timed section (or a single-section attempt) hands in the exam.
        if (Date.now() + serverOffset < overallDeadline && nextSectionOnTimeout(isFullTest, attempt.currentSkill, exam?.sections.map((section) => section.skill) ?? [])) {
          void goNextSection(true);
        } else void doSubmit(true);
      }
    }, 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [deadline, doSubmit, serverOffset, overallDeadline, isFullTest, attempt.currentSkill, goNextSection, exam]);

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
  const confirmedCount = exam ? countAnswered(exam, confirmedAnswers, audioSet) : 0;
  const section: MockSection | undefined = exam?.sections[activeSection];
  const firstShownNumber = section?.groups?.[0]?.questions?.[0]?.displayNumber ?? section?.groups?.[0]?.questions?.[0]?.number ?? 1;
  const activeQuestionNumber = activeQuestion.section === (section?.id ?? null) ? activeQuestion.number : firstShownNumber;

  // Live Exam Room telemetry heartbeat
  React.useEffect(() => {
    if (!liveRoomId || !exam) return;
    const sendHeartbeat = () => {
      reportProgressMutate({
        attemptId: attempt.id,
        currentSkill: section?.skill,
        currentQuestionNumber: activeQuestionNumber,
        answeredCount: confirmedCount,
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
    confirmedCount,
    flaggedQuestions.size,
    reportProgressMutate,
  ]);

  function blockClipboard(e: React.ClipboardEvent | React.MouseEvent | React.DragEvent) {
    if (!strict) return;
    const kind = e.type === "copy" || e.type === "cut" || e.type === "paste" ? e.type : null;
    // The locker already decided (and logged) clipboard events; repeat its decision here.
    if (kind && clipboardDecision(kind, e as unknown as { target: EventTarget | null; clipboardData?: DataTransfer | null }) === "allow") return;
    e.preventDefault();
  }

  if (examQ.isError && !exam) {
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

  const contrastClasses = COLOUR_CLASS[examSettings.colours];
  // Index of the last Listening part that has a recording (all parts share one recording when a single audio is used).
  const listeningGroups = section?.skill === "listening"
    ? examContentUnits(section.groups ?? [], "listening", exam?.type !== "multilevel").map((unit) => unit.source) : [];
  const sharedListeningAudio = Boolean(audioTimestampsQ.data?.audioUrl);
  const lastListeningAudioPart = sharedListeningAudio
    ? listeningGroups.length - 1
    : listeningGroups.reduce((last, g, index) => (g?.hasAudio ? index : last), -1);
  const sectionQuestionTypes = [...new Set(sectionGroupsOf(section).flatMap((g) => (g?.questions || []).map((q) => String(q.type))))];

  const examAudioTimestamps: AudioTimestampItem[] =
    audioTimestampsQ.data?.timestamps ?? exam.audioTimestamps ?? [];
  const sharedSingleAudioUrl = audioTimestampsQ.data?.audioUrl ?? null;

  // Practice help (never in a timed exam): the Listening audioscript and answer reveal.
  const practiceHelp = attempt.mode === "practice" && attempt.status === "in_progress";
  const practiceScripts = new Map((attempt.sections ?? []).flatMap((s) => (s.groups ?? []).map((g) => [g.id, (g as { audioScript?: string }).audioScript] as const)));
  const practiceRevealed = new Set((attempt.sections ?? []).flatMap((s) => (s.groups ?? []).flatMap((g) => g.questions.filter((q) => (q as { revealed?: boolean }).revealed).map((q) => q.id))));

  // Clear answers: only the open section, only while it can still be changed (a full test has moved past
  // every earlier section, and the server refuses changes to them); recordings are never touched.
  const sectionEditable = Boolean(section) && attempt.status === "in_progress" && (!isFullTest || !attempt.currentSkill || section?.skill === attempt.currentSkill);
  const clearableIds = sectionEditable
    ? sectionGroupsOf(section).flatMap((g) => (g?.questions || []).map((q) => q.id)).filter((id) => (answers[id] ?? "") !== "")
    : [];
  const canClearSection = clearableIds.length > 0 && !submit.isPending;
  // The open part (the one holding the current question), offered as the smaller thing to clear.
  const clearGroups = sectionGroupsOf(section);
  const openPartIndex = clearGroups.findIndex((g) => (g?.questions || []).some((q) => (q.displayNumber ?? q.number) === activeQuestionNumber));
  const clearPart = sectionEditable && clearGroups.length > 1 && openPartIndex >= 0
    ? {
        name: clearGroups[openPartIndex]?.title || ts(section?.skill === "reading" ? "passageN" : "partN", { n: openPartIndex + 1 }),
        ids: (clearGroups[openPartIndex]?.questions || []).map((q) => q.id).filter((id) => (answers[id] ?? "") !== ""),
      }
    : null;

  const sectionSwitcher = (kind: "compact" | "full") => exam.sections.map((s, i) => (
    <button
      key={s.id}
      type="button"
      onClick={() => {
        flush();
        setActiveSection(i);
      }}
      aria-current={i === activeSection}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors touch-manipulation cursor-pointer",
        kind === "compact" ? "min-h-[32px] px-2.5 text-xs" : "min-h-[40px] rounded-full px-4 text-sm",
        i === activeSection
          ? "bg-brand text-brand-fg"
          : kind === "compact" ? "text-fg-muted hover:bg-surface-hover hover:text-fg" : "bg-bg-subtle text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      {t(`skills.${s.skill}`)}
    </button>
  ));

  return (
    <StrictErrorBoundary fallbackTitle="Mock Runner Render Crash">
      <ExamLocker
        active={strict}
        attemptId={attempt.id}
        onAnomaly={(event) => flagMutate(event)}
      >
      {examSession.state.status === "elsewhere" && (
        <ExamSessionGate claimedAt={examSession.state.claimedAt} onTakeOver={examSession.takeOver} />
      )}
      <AnswerQueueBanner
        queued={queuedCount}
        failing={saveState === "error" || saveState === "offline"}
        storageUnavailable={storageUnavailable}
        conflicts={conflictCount}
        lockedEdits={[...edits.current.keys()].filter((id) => !canSaveQuestion(id)).length}
        onKeepLocal={() => resolveConflicts(true)}
        onUseServer={() => resolveConflicts(false)}
        submitUnconfirmed={submitUnconfirmed}
        onRetrySubmit={() => void doSubmit(false, true)}
      />
      <div
        className={cn(
          "mx-auto max-w-[1680px] transition-colors",
          contrastClasses
        )}
        style={examSettings.textSize === "regular" ? undefined : { zoom: TEXT_ZOOM[examSettings.textSize] }}
        data-exam-text-size={examSettings.textSize}
        onCopy={blockClipboard}
        onCut={blockClipboard}
        onPaste={blockClipboard}
        onContextMenu={blockClipboard}
        onDragStart={blockClipboard}
      >
        {/* Header: one 56px row. Everything else is one click away under Info. */}
        <header
          data-runner-header
          className="sticky top-0 z-20 -mx-4 mb-2 flex h-14 items-center gap-1.5 border-b border-border bg-surface/95 px-3 backdrop-blur sm:gap-2 sm:px-4 lg:-mx-5 lg:px-5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="font-black text-brand tracking-wider text-sm sm:text-base mr-0.5 select-none shrink-0">BESTWAY</span>
            {isSingleSection && targetSkill && (
              <span className="hidden shrink-0 whitespace-nowrap rounded-chip border border-brand/30 bg-brand-subtle px-2 py-0.5 text-sm font-semibold text-brand-subtle-fg md:inline">
                {tr(attempt.mode === "practice" ? "practiceBadge" : "examBadge", { skill: t(`skills.${targetSkill}`) })}
              </span>
            )}
            <p className="min-w-0 truncate text-sm font-semibold text-fg sm:text-base" title={exam.title}>{exam.title}</p>
            {/* Sections of a multi-section attempt: compact on wide screens, under Info on smaller ones. */}
            {!isSingleSection && exam.sections.length > 1 && (
              <div className="hidden shrink-0 items-center gap-0.5 rounded-lg bg-bg-subtle p-0.5 xl:flex" role="group" aria-label={tr("sectionsLabel")}>
                {sectionSwitcher("compact")}
              </div>
            )}
          </div>
          <span className="hidden lg:inline-flex">
            <StatusChip>
              {tr("confirmedAnswerCount", { count: confirmedCount, total })}
              {bulk.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            </StatusChip>
          </span>
          <SaveStatusChip state={saveState} compact label={tr({ idle: "saveIdle", queued: "saveQueued", saving: "saveSaving", saved: "saveSaved", retrying: "saveRetrying", error: "saveError", offline: "saveOffline", conflict: "saveConflict" }[saveState])} />
          {(saveState === "error" || saveState === "offline") && <button type="button" className="hidden min-h-[40px] px-1 text-sm font-semibold text-brand underline-offset-2 hover:underline sm:inline" onClick={() => flush(true)}>{tr("saveRetry")}</button>}
          <RunnerTools
            infoOpen={infoOpen}
            onInfo={() => setInfoOpen((open) => !open)}
            notesCount={attemptNotes.length}
            notesOpen={notesDrawerOpen}
            onNotes={() => setNotesDrawerOpen((open) => !open)}
            vocab={strict ? null : vocabOn}
            onVocab={() => setVocabOn((on) => !on)}
            focus={focusMode}
            onFocus={() => setFocusMode((on) => !on)}
          >
            <ExamToolbar
              ref={toolbarRef}
              iconsClassName="hidden 2xl:flex"
              settings={examSettings}
              onChange={updateExamSettings}
              questionTypes={sectionQuestionTypes}
              timeLeft={remaining != null ? formatClock(remaining) : null}
            />
          </RunnerTools>
          {remaining != null && <Timer ms={remaining} label={t("timeLeft")} warn />}
          {isFullTest && activeSection < exam.sections.length - 1 ? (
            <Button size="sm" variant="outline" className="hidden min-h-[40px] px-3 touch-manipulation md:inline-flex" loading={advance.isPending} onClick={() => (multilevelReview && missingWork ? setReview("advance") : setShowAdvanceConfirm(true))}>
              {tr("nextSection")}
            </Button>
          ) : null}
          <Button size="sm" aria-label={t("submit")} className="min-h-11 min-w-11 px-2.5 font-semibold touch-manipulation sm:px-4 md:min-h-10" loading={submit.isPending} onClick={() => (multilevelReview && missingWork ? setReview("submit") : doSubmit(false))}>
            <Send className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden sm:inline">{t("submit")}</span>
          </Button>
        </header>

        {infoOpen && (
          <section id="runner-info" aria-label={tr("infoTitle")} className="mb-3 space-y-3 rounded-card border border-border bg-surface p-3 text-sm sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              {showQuestionPosition && <StatusChip>{tr("questionPosition", { number: activeQuestionNumber })}</StatusChip>}
              <span className="lg:hidden"><StatusChip>{tr("confirmedAnswerCount", { count: confirmedCount, total })}</StatusChip></span>
              {flaggedQuestions.size > 0 && (
                <StatusChip tone="warning">
                  <Flag className="size-3.5" aria-hidden />
                  {tr("flaggedCount", { count: flaggedQuestions.size })}
                </StatusChip>
              )}
              {(saveState === "error" || saveState === "offline") && <button type="button" className="min-h-[40px] px-2 text-sm font-semibold text-brand underline-offset-2 hover:underline sm:hidden" onClick={() => flush(true)}>{tr("saveRetry")}</button>}
            </div>
            {!isSingleSection && exam.sections.length > 1 && (
              <div className="flex flex-wrap gap-1.5 xl:hidden" role="group" aria-label={tr("sectionsLabel")}>{sectionSwitcher("full")}</div>
            )}
            <PhoneToolsRow
              toolbar={toolbarRef}
              notesCount={attemptNotes.length}
              notesOpen={notesDrawerOpen}
              onNotes={() => setNotesDrawerOpen((open) => !open)}
              vocab={strict ? null : vocabOn}
              onVocab={() => setVocabOn((on) => !on)}
              focus={focusMode}
              onFocus={() => setFocusMode((on) => !on)}
            />
            <ResponseProgress answered={answered} total={total} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-xs text-fg-muted">{tr("toolsHint")}</p>
              <Button type="button" size="sm" variant="ghost" className="min-h-[40px]" onClick={() => setShortcutsOpen(true)}>
                <Keyboard className="mr-1.5 size-4" aria-hidden />
                {tr("shortcutsButton")}
              </Button>
              <Button type="button" size="sm" variant="outline" className="min-h-[40px] text-danger" disabled={!canClearSection} onClick={() => setClearOpen(true)}>
                <Trash2 className="mr-1.5 size-4" aria-hidden />
                {tr("clearAnswers")}
              </Button>
            </div>
          </section>
        )}

        {notesDrawerOpen && (
          <ExamNotesPanel
            notes={attemptNotes}
            onClose={() => setNotesDrawerOpen(false)}
            onDelete={(note) => { if (note.storageKey) deleteAttemptNote(note.storageKey, note.id); }}
          />
        )}

        <ClearAnswersDialog
          open={clearOpen}
          sectionName={section ? section.title || t(`skills.${section.skill}`) : ""}
          count={clearableIds.length}
          part={clearPart ? { name: clearPart.name, count: clearPart.ids.length } : null}
          onCancel={() => setClearOpen(false)}
          onConfirm={(scope) => {
            setClearOpen(false);
            const ids = scope === "part" && clearPart ? clearPart.ids : clearableIds;
            for (const id of ids) setAnswer(id, "");
            toast.success(tr("clearDone", { count: ids.length }));
          }}
        />
        <VocabLookup enabled={!strict && vocabOn} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

        {partialPractice && !isSingleSection && (section?.skill === "writing" || section?.skill === "speaking") && <p className="mb-4 text-sm text-fg-muted">{t("practiceRunnerNotice")}</p>}
        {versioned && exam.type === "multilevel" && section && !isSingleSection && <div className="mb-4"><MultilevelSectionProgress current={section.skill} skills={partialPractice ? exam.sections.map((item) => item.skill) : undefined} complete={exam.sections.filter((item) => {
          const questions = (item.groups || (item as any).parts || []).flatMap((group: any) => group?.questions || []);
          return questions.length > 0 && questions.every((question) => multilevelQuestionAnswered(question, answers, audioSet));
        }).map((item) => item.skill)} /></div>}

        {section && (
          <ErrorBoundary fallbackTitle={tr("sectionLoadError", { section: section.title || t(`skills.${section.skill}`) })}>
          <div className="space-y-3">
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
              // A new section starts on its first part (its own part and question state).
              key={section.id}
              attemptId={attempt.id}
              canonicalListening={exam.type !== "multilevel"}
              skill={section.skill}
              groups={section.groups || (section as any).parts || []}
              answers={answers}
              audioSet={audioSet}
              audioDurations={audioDurations}
              simulatorMode={simulatorMode}
              flaggedQuestions={flaggedQuestions}
              onToggleFlag={toggleQuestionFlag}
              onActiveQuestionChange={(number) => {
                const sectionId = section?.id ?? null;
                // Keep the same object when nothing changed: a new one would re-render the runner, which hands the
                // stepper a new callback, which reports the question again — an endless render loop.
                setActiveQuestion((current) => (current.section === sectionId && current.number === number ? current : { section: sectionId, number }));
              }}
              renderGroupBlock={(source, reviewComplete, partIdx, taskGroups = [source], partNumber, unitKey) => {
                const render = (g: MockSection["groups"][number], taskOnly = false, taskContent?: React.ReactNode) => <GroupBlock
                  key={taskContent ? unitKey : g.id}
                  taskOnly={taskOnly}
                  taskContent={taskContent}
                  taskCount={taskGroups.reduce((count, group) => count + group.questions.length, 0)}
                  partNumber={partNumber}
                  group={!versioned && exam.type === 'multilevel' ? { ...g, questions: g.questions.map((q) => ({ ...q, guidance: undefined })) } : g}
                  skill={section.skill}
                  strict={strict && section.skill === "listening"}
                  timed={strict}
                  attemptId={attempt.id}
                  answers={answers}
                  audioSet={audioSet}
                  audioDurations={audioDurations}
                  onAnswer={setAnswer}
                  // The 2-minute check runs once, after the last part's recording, never after earlier parts.
                  onReviewComplete={section.skill === "listening" && partIdx === lastListeningAudioPart ? reviewComplete ?? onListeningReviewComplete : undefined}
                  reviewAtEnd={section.skill !== "listening" || partIdx === lastListeningAudioPart}
                  simulatorMode={simulatorMode}
                  flaggedQuestions={flaggedQuestions}
                  onToggleFlag={toggleQuestionFlag}
                  partIndex={partIdx}
                  audioTimestamps={examAudioTimestamps}
                  sharedSingleAudioUrl={taskOnly ? null : sharedSingleAudioUrl}
                  // Timed IELTS: each part's start is kept on the server, so a reload resumes the recording.
                  listeningSchedule={attempt.listeningSchedule?.[g.id] ?? null}
                  mediaAlreadyStarted={strict && (attempt.mediaStarted ?? []).includes(g.id)}
                  startListening={strict && section.skill === "listening" && !versioned && g.hasAudio
                    ? () => api.post<ListeningSchedule>(`/mock/attempts/${attempt.id}/listening/${g.id}/start`)
                    : undefined}
                  serverOffsetMs={openingOffset}
                  practice={practiceHelp ? { script: practiceScripts.get(g.id), revealed: practiceRevealed } : null}
                />;
                if (section.skill === "reading") {
                  return render({ ...source, questions: [], contentHtml: null, instructions: null }, false,
                    taskGroups.map((group) => render(group.id === source.id ? { ...group, title: null, imageUrl: null } : group, true)));
                }
                if (section.skill === "listening" && taskGroups.length > 1) {
                  return <div key={unitKey} className="space-y-3">
                    {render({ ...source, title: null, questions: [], contentHtml: null, instructions: null, imageUrl: null })}
                    {taskGroups.map((group) => <div key={group.id}>{render(group, true)}</div>)}
                  </div>;
                }
                return render(source);
              }}
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
              focus={focusMode}
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
          // Nothing left to record (e.g. reopened only to hand in): no microphone test is needed.
          open={section?.skill === "speaking" && micCheckLoaded && !micChecked
            && section.groups.some((group) => group.questions.some((question) => question.type === "speaking_task" && !audioSet.has(question.id)))}
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
          flaggedCount={flaggedQuestions.size}
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
export function SaveStatusChip({ state, label, compact = false }: { state: SaveState; label: string; compact?: boolean }) {
  const failed = state === "error" || state === "offline" || state === "conflict";
  const working = state === "saving" || state === "retrying";
  return (
    <span role="status" aria-live="polite" title={label}>
      <StatusChip tone={failed ? "danger" : state === "saved" ? "success" : "neutral"}>
        {working ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : failed ? (
          <AlertTriangle className="size-3.5" aria-hidden />
        ) : state === "saved" ? (
          <CheckCircle2 className="size-3.5" aria-hidden />
        ) : null}
        {/* Compact (header): the icon shows the state and the label is read out; a failure is always written out. */}
        <span className={compact && state === "saved" ? "max-sm:sr-only" : undefined}>{label}</span>
      </StatusChip>
    </span>
  );
}

function formatClock(ms: number) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h > 0 ? `${pad(h)}:` : ""}${pad(m)}:${pad(total % 60)}`;
}

/** Always visible. Flashes after 10:00 and 5:00 in Reading/Writing; danger colour in the last minute. */
function Timer({ ms, label, warn }: { ms: number; label: string; warn: boolean }) {
  const t = useTranslations("mock.examTools");
  const alert = timerAlert(ms, warn);
  const tone = timerTone(ms);
  const notice = alert === "five" ? t("timeWarning", { minutes: 5 }) : alert === "one" ? t("timeWarningOne") : "";
  return (
    <span className="relative inline-flex">
      <span
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-control border px-2.5 text-base font-semibold tabular-nums transition-colors duration-base sm:px-3",
          tone === "danger" ? "border-danger-border bg-danger-bg text-danger" : tone === "warning" ? "border-warning-border bg-warning-bg text-warning" : "border-border bg-surface text-fg",
        )}
        role="timer"
        aria-label={`${label}: ${formatClock(ms)}`}
        data-timer-alert={alert}
        data-timer-tone={tone}
      >
        <Clock className="size-4" aria-hidden />
        {formatClock(ms)}
      </span>
      {/* A calm notice under the clock for ten seconds at 5:00 and 1:00; screen readers hear it once. */}
      <span
        aria-live="assertive"
        data-timer-notice
        className={cn(
          "pointer-events-none absolute right-0 top-full z-30 mt-2 whitespace-nowrap rounded-control border px-3 py-1.5 text-sm font-medium shadow-e2",
          tone === "danger" ? "border-danger-border bg-surface text-danger" : "border-warning-border bg-surface text-warning",
          notice ? "anim-fade" : "sr-only",
        )}
      >
        {notice}
      </span>
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
  const tg = useTranslations("mock.runnerUx");
  const safeGroups = groups || [];
  const group = safeGroups[activeTask] ?? safeGroups[0];
  const sequence = skill === "speaking" && timed;
  // Timed Speaking: an uploaded answer opens the next question (and its part) automatically.
  const groupsRef = React.useRef(safeGroups);
  React.useEffect(() => { groupsRef.current = safeGroups; });
  React.useEffect(() => {
    if (!sequence) return;
    const onUploaded = (event: Event) => {
      const detail = (event as CustomEvent<{ attemptId: string; questionId: string }>).detail;
      if (detail?.attemptId !== attemptId) return;
      const next = nextSpeakingTarget(groupsRef.current, detail.questionId);
      if (!next) return;
      setActiveTask(next.groupIndex);
      requestSpeakingAutoStart(attemptId, next.questionId);
    };
    window.addEventListener("multilevel:recording-uploaded", onUploaded);
    return () => window.removeEventListener("multilevel:recording-uploaded", onUploaded);
  }, [sequence, attemptId, setActiveTask]);
  const selectTask = (index: number) => { if (canSelectSpeakingPart(sequence, activeTask, index)) setActiveTask(index); };
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
    <MultilevelTaskProgress skill={skill} current={activeTask} total={safeGroups.length} labels={labels} onSelect={selectTask} practice={practice} completed={completed} rawMaximum={practice ? safeGroups.reduce((sum, item) => sum + (item.questions[0]?.guidance?.rawMax ?? item.maxScore ?? 0), 0) : undefined} />
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
      <Button type="button" variant="outline" className="min-h-[44px] min-w-[100px] px-4 touch-manipulation" disabled={activeTask === 0 || sequence} onClick={() => selectTask(activeTask - 1)}>{tg("previousTask")}</Button>
      <Button type="button" variant="outline" className="min-h-[44px] min-w-[100px] px-4 touch-manipulation" disabled={activeTask === safeGroups.length - 1} onClick={() => setActiveTask(activeTask + 1)}>{tg("nextTask")}</Button>
    </div>
  </div>;
}

function GroupBlock({
  group,
  taskOnly = false,
  taskContent,
  taskCount,
  partNumber,
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
  flaggedQuestions,
  onToggleFlag,
  partIndex = 0,
  reviewAtEnd = true,
  audioTimestamps = [],
  sharedSingleAudioUrl,
  listeningSchedule = null,
  mediaAlreadyStarted = false,
  startListening,
  serverOffsetMs = 0,
  practice = null,
}: {
  group: MockSection["groups"][number];
  taskOnly?: boolean;
  taskContent?: React.ReactNode;
  taskCount?: number;
  partNumber?: number;
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
  reviewAtEnd?: boolean;
  audioTimestamps?: AudioTimestampItem[];
  sharedSingleAudioUrl?: string | null;
  listeningSchedule?: ListeningSchedule | null;
  mediaAlreadyStarted?: boolean;
  startListening?: () => Promise<ListeningSchedule>;
  serverOffsetMs?: number;
  /** Practice only: the audioscript of this Listening part and the revealed answers. */
  practice?: { script?: string | null; revealed: Set<string> } | null;
}) {
  const tg = useTranslations("mock.runnerUx");
  const [readingMobileTab, setReadingMobileTab] = React.useState<"passage" | "questions">("passage");
  const hasPassage = !taskOnly && !!(group.passageText || (skill === "reading" && group.imageUrl)) && !(skill === "writing" && sharedWritingStimulus);
  const hasGappedContent = hasGappedDocument(group.contentHtml);
  const matchingBank = sharedMatchingOptions(group.questions);
  const gapNumbers = React.useMemo(() => new Set(gapNumbersIn(sanitizeGappedContent(group.contentHtml ?? ""))), [group.contentHtml]);

  // Resolve single-audio timestamp boundaries for this Listening part
  const stimTs = group.stimulusRef as { startSec?: number; endSec?: number | null } | null | undefined;
  const matchedTs = audioTimestamps.find((ts) => ts.partNumber === (partNumber ?? partIndex + 1));
  const startSec = group.startSec ?? stimTs?.startSec ?? matchedTs?.startSec;
  const endSec = group.endSec ?? stimTs?.endSec ?? matchedTs?.endSec ?? null;

  const hasListeningAudio = !taskOnly && Boolean(group.hasAudio || (skill === "listening" && sharedSingleAudioUrl));
  const audioSrc = group.hasAudio
    ? media(`/mock/groups/${group.id}/audio${strict ? `?attemptId=${attemptId}` : ""}`)
    : sharedSingleAudioUrl
    ? sharedSingleAudioUrl.startsWith("/api/")
      ? sharedSingleAudioUrl
      : media(sharedSingleAudioUrl)
    : "";

  // Wide screens: passage | divider | questions, each column scrolling on its own.
  // Writing: the task (picture, instructions, text, prompt) beside the answer. One split only — the passage lives in
  // the task column, so there is never a split inside a split.
  const isWritingSplit = skill === "writing" && !hasGappedContent;
  const isPassageSplit = hasPassage && !isWritingSplit;
  // Passage / Questions tabs on phones are for Reading; Writing stacks the task above the answer.
  const tabbed = isPassageSplit && skill === "reading";
  const [readingSplit, setReadingSplit] = useReadingSplit();
  const [writingSplit, setWritingSplit] = useWritingSplit();
  const splitRef = React.useRef<HTMLDivElement>(null);
  const isMapSplit = Boolean(skill === "listening" && group.imageUrl);
  React.useEffect(() => {
    const element = splitRef.current;
    if (!tabbed || !element) return;
    const show = (event: Event) => {
      if (readingMobileTab === "passage" && window.matchMedia("(max-width: 1023px)").matches) {
        event.preventDefault();
        setReadingMobileTab("questions");
      }
    };
    element.addEventListener("bw-exam-show-question", show);
    return () => element.removeEventListener("bw-exam-show-question", show);
  }, [tabbed, readingMobileTab]);

  return (
    <Card className="p-3 sm:p-4">
      {group.title && !taskContent && <h3 className="font-semibold text-fg">{group.title}</h3>}
      {hasListeningAudio && skill === "listening" ? (
        // The recording is content (not chrome): it stays in view under the header while the questions scroll.
        <div data-layout-content className={cn("z-10 -mx-3 mb-3 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur-xl sm:-mx-4 sm:px-4 [@media(min-height:720px)]:sticky [@media(min-height:720px)]:top-14", group.title ? "mt-2" : "-mt-3 rounded-t-card sm:-mt-4")}>
          {group.questions[0]?.guidance && strict ? <MultilevelListening
            prepare={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/prepare`)}
            play={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/listening/${group.id}/play`)}
            load={async () => { const res = await fetch(audioSrc); if (!res.ok) throw new Error('Audio loading failed'); return res.blob(); }}
            alreadyStarted={mediaAlreadyStarted}
          /> : <ListeningAudio
            src={audioSrc}
            strict={strict}
            onReviewComplete={strict ? onReviewComplete : undefined}
            reviewAtEnd={reviewAtEnd}
            startSec={startSec}
            endSec={endSec}
            partLabel={group.title || tg("partN", { n: partIndex + 1 })}
            timestamps={audioTimestamps}
            schedule={listeningSchedule}
            startSchedule={group.hasAudio ? startListening : undefined}
            serverOffsetMs={serverOffsetMs}
          />}
        </div>
      ) : (
        !taskOnly && group.hasAudio && (
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
      {skill === "listening" && !taskOnly && !hasListeningAudio && <p role="status" className="text-sm text-fg-muted">{tg("partAudioUnavailable")}</p>}
      {practice && skill === "listening" && <div className="mt-2"><AudioScriptToggle script={practice.script} /></div>}
      {group.imageUrl && !(skill === "reading" && taskContent) && !isMapSplit && !isWritingSplit && (
        <div className="mt-3">
          <GroupImage groupId={group.id} alt={group.title ? tg("pictureFor", { title: group.title }) : tg("pictureForPart")} />
        </div>
      )}
      {group.instructions && !isWritingSplit && (
        <div className="mt-3 text-sm font-medium text-fg-muted">
          <CbtAnnotatedText
            text={group.instructions}
            storageKey={`${attemptId}.${group.id}.instructions`}
          />
        </div>
      )}
      {skill === "speaking" && group.questions[0]?.guidance && (
        <section className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-brand/20 bg-brand-subtle p-3">
          <div>
            {/* The part name is already the group heading when the two agree. */}
            {multilevelTaskName(group.questions[0].guidance, tg("speakingPart")) !== group.title && (
              <p className="font-semibold text-fg">{multilevelTaskName(group.questions[0].guidance, tg("speakingPart"))}</p>
            )}
            <p className="text-sm text-fg-muted">{tg("responsesCount", { count: group.questions.length })}</p>
            {group.questions.length > 1 && <p className="mt-1 text-sm text-fg-muted">{tg("responseTiming")}: {group.questions.map((question) => question.guidance?.responseSeconds ? `${question.guidance.responseSeconds}s` : null).filter(Boolean).join(" · ")}</p>}
          </div>
          <MultilevelTaskMeta question={group.questions[0]} />
        </section>
      )}
      {skill === "writing" && sharedWritingStimulus && (
        <section className="mt-3 rounded-control border border-brand/20 bg-brand-subtle p-4" aria-label={tg("sharedSituation")}>
          <p className="text-sm font-semibold text-brand-subtle-fg">{tg("sharedSituation")}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-fg">{sharedWritingStimulus}</p>
        </section>
      )}

      {/* Mobile Tab Switcher for Reading when passage exists */}
      {tabbed && (
        <div className="mt-3 flex rounded-control border border-border bg-bg-subtle p-1 lg:hidden" role="group" aria-label={tg("passageOrQuestions")}>
          <button
            type="button"
            aria-pressed={readingMobileTab === "passage"}
            onClick={() => setReadingMobileTab("passage")}
            className={cn(
              "min-h-10 flex-1 rounded-field text-sm font-semibold transition-colors duration-fast touch-manipulation",
              readingMobileTab === "passage"
                ? "bg-surface text-fg shadow-e1"
                : "text-fg-muted hover:text-fg"
            )}
          >
            {tg("passageTab")}
          </button>
          <button
            type="button"
            aria-pressed={readingMobileTab === "questions"}
            onClick={() => setReadingMobileTab("questions")}
            className={cn(
              "min-h-10 flex-1 rounded-field text-sm font-semibold transition-colors duration-fast touch-manipulation",
              readingMobileTab === "questions"
                ? "bg-surface text-fg shadow-e1"
                : "text-fg-muted hover:text-fg"
            )}
          >
            {tg("questionsTab", { count: taskCount ?? group.questions.length })}
          </button>
        </div>
      )}

      <div
        ref={splitRef}
        className={cn(
          "mt-3",
          isPassageSplit || isWritingSplit
            ? "lg:grid lg:grid-cols-[minmax(0,var(--reading-passage))_auto_minmax(0,var(--reading-questions))] lg:gap-3 lg:items-start"
            : isMapSplit && !hasGappedContent && "lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start",
        )}
        style={isPassageSplit
          ? ({ "--reading-passage": `${readingSplit}fr`, "--reading-questions": `${100 - readingSplit}fr` } as React.CSSProperties)
          : isWritingSplit
            ? ({ "--reading-passage": `${writingSplit}fr`, "--reading-questions": `${100 - writingSplit}fr` } as React.CSSProperties)
            : undefined}
      >
        {isMapSplit && (
          // Sticky only beside the questions on wide screens; on phones a sticky
          // map would cover the questions it belongs to.
          <div className="mb-3 rounded-xl border border-border bg-bg-subtle/50 p-3 shadow-inner flex flex-col items-center justify-center lg:mb-0 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
            <p className="text-xs font-semibold text-fg-muted mb-2 uppercase tracking-wider">
              {group.title || tg("map")}
            </p>
            <GroupImage groupId={group.id} alt={group.title ? tg("mapFor", { title: group.title }) : tg("mapForPart")} />
          </div>
        )}
        {isWritingSplit && (
          <div
            data-testid="writing-task-panel"
            className={cn("mb-4 space-y-3 rounded-card border border-border bg-surface p-4 sm:p-5 lg:sticky lg:top-16 lg:mb-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-none lg:border-0 lg:bg-transparent lg:py-1 lg:pl-1 lg:pr-4", !(group.imageUrl || group.instructions || hasPassage) && "hidden lg:block")}
            // The task scrolls on its own beside the answer: keyboard users can focus and scroll it.
            tabIndex={0}
            role="region"
            aria-label={tg("writingTaskRegion")}
          >
            {group.imageUrl && <GroupImage groupId={group.id} alt={group.title ? tg("pictureFor", { title: group.title }) : tg("pictureForPart")} />}
            {group.instructions && (
              <div className="text-sm font-medium text-fg-muted">
                <CbtAnnotatedText text={group.instructions} storageKey={`${attemptId}.${group.id}.instructions`} />
              </div>
            )}
            {hasPassage && (
              <div className="whitespace-pre-line text-base leading-relaxed text-fg sm:text-[17px] sm:leading-[1.75]" {...{ [VOCAB_TEXT_ATTRIBUTE]: "" }}>
                <CbtAnnotatedText text={group.passageText ?? ""} storageKey={`${attemptId}.${group.id}.passage`} />
              </div>
            )}
            {/* Wide screens: the prompt sits with the task (phones keep it with the answer, below). */}
            <div className="hidden space-y-3 lg:block">
              {(group?.questions || []).map((q) => (
                <div key={q.id} className="whitespace-pre-line text-base leading-relaxed text-fg sm:text-[17px] sm:leading-[1.75]" {...{ [VOCAB_TEXT_ATTRIBUTE]: "" }}>
                  {q.prompt}
                </div>
              ))}
            </div>
          </div>
        )}
        {isWritingSplit && <ReadingSplitDivider variant="writing" value={writingSplit} onChange={setWritingSplit} containerRef={splitRef} />}
        {isPassageSplit && (
          <div
            className={cn(
              "whitespace-pre-line rounded-card border border-border bg-surface p-5 text-base leading-relaxed text-fg max-w-[70ch] sm:text-[17px] sm:leading-[1.75] lg:max-w-none lg:rounded-none lg:border-0 lg:bg-transparent lg:py-1 lg:pl-1 lg:pr-4",
              "lg:block lg:sticky lg:top-16 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain",
              readingMobileTab === "passage" ? "block mb-4 max-h-[70vh] overflow-y-auto" : "hidden"
            )}
            // The passage scrolls on its own: keyboard users can focus and scroll it.
            tabIndex={0}
            {...{ [VOCAB_TEXT_ATTRIBUTE]: "" }}
            role="region"
            aria-label={tg("passageRegion")}
          >
            {group.title && (
              <h2 className="mb-3 text-lg sm:text-xl font-bold tracking-tight text-fg border-b border-border/60 pb-2">
                {group.title}
              </h2>
            )}
            {taskContent && group.imageUrl && <GroupImage groupId={group.id} alt={group.title ?? tg("pictureForPart")} />}
            <div className="font-serif leading-relaxed text-fg/95">
              <CbtAnnotatedText
                text={group.passageText ?? ""}
                storageKey={`${attemptId}.${group.id}.passage`}
              />
            </div>
            <div className="mt-4 pt-3 border-t border-border/60 lg:hidden text-center">
              <Button
                type="button"
                size="sm"
                className="w-full bg-brand text-bg font-semibold touch-manipulation"
                aria-pressed={readingMobileTab === "questions"}
            onClick={() => setReadingMobileTab("questions")}
              >
                {tg("goToQuestions")} →
              </Button>
            </div>
          </div>
        )}
        {isPassageSplit && <ReadingSplitDivider value={readingSplit} onChange={setReadingSplit} containerRef={splitRef} />}
        {taskContent ? <div data-testid="reading-task-groups" className={cn(
          "min-w-0 space-y-3 lg:sticky lg:top-16 lg:block lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain",
          tabbed && readingMobileTab === "passage" && "hidden",
        )}>{taskContent}</div> : <div className="min-w-0 space-y-4">
        {hasGappedContent && (
          <div className="overflow-x-auto rounded-field border border-border bg-surface p-3 sm:p-4">
            {practice && (skill === "listening" || skill === "reading") && (
              <details className="mb-3 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-fg-muted">{tg("practiceShowAnswers")}</summary>
                <ul className="mt-2 space-y-1">
                  {group.questions.map((q) => (
                    <li key={q.id} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold tabular-nums text-fg">{(q as { displayNumber?: number }).displayNumber ?? q.number}</span>
                      <RevealAnswer attemptId={attemptId} questionId={q.id} initiallyRevealed={practice.revealed.has(q.id)} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <GappedContent
              contentHtml={group.contentHtml!}
              questions={group.questions}
              renderGap={({ number, question }) =>
                question ? (
                  <span id={`q-${question.id}`} className="mx-1 inline-flex max-w-full items-center gap-1 align-middle">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-fg tabular-nums">
                      {(question as { displayNumber?: number }).displayNumber ?? number}
                    </span>
                    <Input
                      value={answers[question.id] ?? ""}
                      onChange={(event) => onAnswer(question.id, event.target.value)}
                      aria-label={tg("answerFor", { number: (question as { displayNumber?: number }).displayNumber ?? number })}
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
        )}
          <div
            className={cn(
              "space-y-4",
              "lg:block",
              isPassageSplit && "lg:sticky lg:top-16 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1",
              isMapSplit && "lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pl-2 lg:pr-1",
              tabbed ? (readingMobileTab === "questions" ? "block" : "hidden") : "block"
            )}
          >
            {tabbed && (
              <div className="mb-2 flex items-center justify-between pb-2 border-b border-border/60 lg:hidden">
                <span className="text-xs font-medium text-fg-muted">{tg("questionCount", { count: (group?.questions || []).length })}</span>
                <button
                  type="button"
                  aria-pressed={readingMobileTab === "passage"}
            onClick={() => setReadingMobileTab("passage")}
                  className="text-xs font-semibold text-brand underline underline-offset-4 touch-manipulation"
                >
                  ← {tg("backToPassage")}
                </button>
              </div>
            )}
            <MatchingOptionBank options={matchingBank} />
            {group.questions.filter((q) => !gapNumbers.has(q.number)).map((q) => (
              <div key={q.id} id={`q-${q.id}`} className="scroll-mt-28" {...(isWritingSplit ? { "data-testid": "writing-answer-panel" } : {})}>
                <QuestionInput
                  key={q.id}
                  question={q}
                  groupTitle={group.title ?? undefined}
                  attemptId={attemptId}
                  value={answers[q.id] ?? ""}
                  hasAudio={audioSet.has(q.id)}
                  audioDurationMs={audioDurations?.[q.id]}
                  timed={timed}
                  sharedBank={matchingBank.length > 0}
                  unavailableOptions={group.optionsReusable === false ? usedMatchingOptions(group.questions, answers, q.id) : []}
                  onChange={(v) => onAnswer(q.id, v)}
                  multilevelSkill={skill}
                  isFlagged={flaggedQuestions?.has(q.id)}
                  onToggleFlag={onToggleFlag ? () => onToggleFlag(q.id) : undefined}
                  promptInTaskPanel={isWritingSplit}
                />
                {practice && (skill === "listening" || skill === "reading") && (
                  <RevealAnswer attemptId={attemptId} questionId={q.id} initiallyRevealed={practice.revealed.has(q.id)} />
                )}
              </div>
            ))}
          </div>
        </div>}
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
  promptInTaskPanel = false,
}: {
  promptInTaskPanel?: boolean;
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
          <p className={cn("whitespace-pre-line text-sm text-fg", promptInTaskPanel && "lg:hidden")}>{q.prompt}</p>
        </div>
      ) : header}

      {/* Writing input mode switcher: typing vs handwritten paper upload */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-control border border-border bg-bg-subtle p-1" role="group" aria-label={tx("writingModeLabel")}>
          <button
            type="button"
            aria-pressed={writingMode === "type"}
            onClick={() => setWritingMode("type")}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-field px-3 text-sm font-medium transition-colors duration-fast",
              writingMode === "type"
                ? "bg-surface text-fg shadow-e1"
                : "text-fg-muted hover:text-fg"
            )}
          >
            <Keyboard className="size-3.5" aria-hidden /> {tx("writingModeType")}
          </button>
          <button
            type="button"
            aria-pressed={writingMode === "image"}
            onClick={() => setWritingMode("image")}
            className={cn(
              "flex min-h-9 items-center gap-1.5 rounded-field px-3 text-sm font-medium transition-colors duration-fast",
              writingMode === "image"
                ? "bg-surface text-fg shadow-e1"
                : "text-fg-muted hover:text-fg"
            )}
          >
            <Camera className="size-3.5" aria-hidden /> {tx("writingModeOcr")}
          </button>
        </div>
        {value.trim() && (
          <span className="flex items-center gap-1 text-sm font-medium text-brand-subtle-fg">
            <CheckCircle2 className="size-3" aria-hidden /> {tx("writingDraftKept")}
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
                <span className="tabular-nums">{tx("wordCount", { count: countWords(value) })}</span>
              </div>
              <Textarea
                value={value}
                onChange={(e) => handleWritingChange(e.target.value)}
                className="min-h-36 resize-y font-sans text-base leading-relaxed"
                placeholder={tx("ocrPlaceholder")}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                {...{ [WRITING_AREA_ATTRIBUTE]: "" }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <Textarea
            value={value}
            onChange={(e) => handleWritingChange(e.target.value)}
            className="min-h-72 resize-y font-sans text-base leading-relaxed touch-manipulation focus-visible:border-brand sm:text-[17px] lg:min-h-[max(18rem,calc(100dvh-26rem))]"
            aria-label={tx("writingResponseLabel", { number: q.displayNumber ?? q.number })}
            placeholder={tx("writingPlaceholder")}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            {...{ [WRITING_AREA_ATTRIBUTE]: "" }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <WritingResponseGuide value={value} minimum={minWords} maximum={q.guidance?.wordMax} taskKey={`${attemptId}:${q.id}`} suggestedMinutes={suggestedWritingMinutes(q.type)} />
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
  sharedBank,
  multilevelSkill,
  groupTitle,
  isFlagged,
  onToggleFlag,
  promptInTaskPanel = false,
}: {
  /** Writing split view: on wide screens the prompt is shown in the task column, not again above the answer. */
  promptInTaskPanel?: boolean;
  question: MockQuestion;
  attemptId: string;
  value: string;
  hasAudio: boolean;
  audioDurationMs?: number;
  timed: boolean;
  onChange: (v: string) => void;
  unavailableOptions?: string[];
  sharedBank?: boolean;
  multilevelSkill?: MockSkill;
  groupTitle?: string;
  isFlagged?: boolean;
  onToggleFlag?: () => void;
}) {
  const tx = useTranslations("mock.runnerUx");

  // Flag sits beside the question number: one tap target (44 px on phones), state in aria-pressed.
  const flagButton = onToggleFlag ? (
    <button
      type="button"
      onClick={onToggleFlag}
      aria-pressed={!!isFlagged}
      aria-label={isFlagged ? tx("unflagTitle") : tx("flagActionTitle")}
      title={isFlagged ? tx("unflagTitle") : tx("flagActionTitle")}
      data-question-flag
      className={cn(
        "-my-1.5 -mr-1.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-sm font-medium transition-colors duration-fast md:min-h-9 md:min-w-9",
        isFlagged ? "bg-warning-bg text-warning" : "text-fg-subtle hover:bg-surface-hover hover:text-fg",
      )}
    >
      <Flag className={cn("size-4", isFlagged && "fill-current")} aria-hidden />
      <span className="hidden lg:inline">{isFlagged ? tx("flaggedShort") : tx("flagAction")}</span>
    </button>
  ) : null;

  const header = (
    <div className="flex items-start gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-field border border-border-strong bg-bg-subtle text-sm font-bold text-fg tabular-nums">
        {q.displayNumber ?? q.number}
      </span>
      <p className={cn("min-w-0 flex-1 whitespace-pre-line pt-0.5 text-base leading-relaxed text-fg", promptInTaskPanel && "lg:hidden")}>{q.prompt}</p>
      {promptInTaskPanel && <span className="hidden flex-1 lg:block" />}
      {flagButton}
    </div>
  );

  if (q.type === "speaking_task") {
    return (
      <div className="space-y-2">
        {header}
        {q.guidance ? <MultilevelRecorder attemptId={attemptId} questionId={q.id} timed={timed} initialHasAudio={hasAudio} initialAudioDurationMs={audioDurationMs} responseSeconds={q.guidance.responseSeconds} prompt={q.prompt}
          startPhase={() => api.post<MediaPhase>(`/mock/attempts/${attemptId}/speaking/${q.id}/start`)}
          upload={async (blob) => { const form = new FormData(); form.append('audio', blob, recordingFileName(blob)); return api.post(`/mock/attempts/${attemptId}/speaking/${q.id}`, form); }}
        /> : <SpeakingRecorder attemptId={attemptId} questionId={q.id} initialHasAudio={hasAudio} prompt={q.prompt} />}
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
        promptInTaskPanel={promptInTaskPanel}
      />
    );
  }

  return (
    <div className="space-y-2">
      <ObjectiveQuestionInput
        question={q}
        value={value}
        onChange={onChange}
        unavailableOptions={unavailableOptions}
        sharedBank={sharedBank}
        headerAction={flagButton}
        // Listening question text can be highlighted and annotated like a Reading passage (kept with the attempt).
        renderPrompt={multilevelSkill === "listening" ? (text) => <CbtAnnotatedText text={text} storageKey={`${attemptId}.${q.id}.prompt`} /> : undefined}
      />
    </div>
  );
}

