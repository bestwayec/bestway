"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ExamGate } from "@/lib/listening-audio";
import { HISTORY_PAGE_SIZE, loadAttemptHistory } from "@/lib/attempt-history";
import { useStudentProgramScope } from './use-exam-programs';
import type { AnswerEdit, AnswerSaveResult } from "@/lib/answer-queue";
import type {
  CreateMockExamInput,
  CreateMockSectionInput,
  MockAttemptDetail,
  MockAttemptStatus,
  MockAttemptSummary,
  MockExamDetail,
  MockExamListItem,
  MockExamType,
  MockGroup,
  MockGroupInput,
  MockPurchaseItem,
  MockQuestionInput,
  PurchaseStatus,
  StartMockResult,
  UpdateMockExamInput,
} from "@/lib/types";

/* ── Exams ─────────────────────────────────────────────────────────────── */

export function useMockExams(type?: MockExamType, practiceLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1') {
  const scope = useStudentProgramScope();
  return useQuery({
    queryKey: ["mock-exams", scope.owner, scope.program ?? 'all', type ?? "all", practiceLevel ?? 'all'],
    queryFn: () => api.get<MockExamListItem[]>("/mock/exams", { type, program: scope.program, practiceLevel }),
    enabled: scope.ready,
  });
}

export function useMockExam(id: string) {
  const scope = useStudentProgramScope();
  return useQuery({
    queryKey: ["mock-exam", scope.owner, scope.program ?? 'all', id],
    queryFn: () => api.get<MockExamDetail>(`/mock/exams/${id}`),
    enabled: !!id && scope.ready,
  });
}

export function useCdExamSession(examId: string, enabled = true) {
  return useQuery({
    queryKey: ["cd-exam-session", examId],
    queryFn: () => api.get<any>(`/api/v1/exams/${encodeURIComponent(examId)}/cd-session/`),
    enabled: !!examId && enabled,
    staleTime: 60_000,
  });
}

export function useCreateMockExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMockExamInput) => api.post<MockExamDetail>("/mock/exams", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exams"] }),
  });
}

export function useUpdateMockExam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMockExamInput) => api.patch<MockExamDetail>(`/mock/exams/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
    },
  });
}

export function useUpdateMockExamAny() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMockExamInput }) =>
      api.patch<MockExamDetail>(`/mock/exams/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
    },
  });
}

export function useDeleteMockExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/mock/exams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exams"] }),
  });
}

/* ── Access / purchase ─────────────────────────────────────────────────── */

export function usePurchaseMock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (examId: string) =>
      api.post<{ status: PurchaseStatus; amount: number }>(`/mock/exams/${examId}/purchase`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exams"] }),
  });
}

export function useMockPurchases(status?: PurchaseStatus) {
  return useQuery({
    queryKey: ["mock-purchases", status ?? "all"],
    queryFn: () => api.get<MockPurchaseItem[]>("/mock/purchases", { status }),
  });
}

export function useConfirmMockPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { examId: string; userId: string }) =>
      api.post(`/mock/exams/${v.examId}/confirm-purchase`, { userId: v.userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-purchases"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
    },
  });
}

/* ── Attempts (student) ────────────────────────────────────────────────── */

export function useStartMock() {
  return useMutation({
    mutationFn: (v: {
      examId: string;
      assignmentId?: string;
      mode?: "practice" | "timed";
      flow?: "full_test" | "single_skill" | "partial_practice";
      skills?: import("@/lib/types").MockPracticeSkill[];
      retake?: boolean;
      force?: boolean;
      /** Practice only: parts of the one section, and the clock (none, section time, the parts' share). */
      groupIds?: string[];
      timer?: "none" | "section" | "part";
    }) =>
      api.post<StartMockResult>(`/mock/exams/${v.examId}/start`, {
        mode: v.mode ?? "practice",
        ...(v.assignmentId ? { assignmentId: v.assignmentId } : {}),
        ...(v.flow ? { flow: v.flow } : {}),
        ...(v.skills ? { skills: v.skills } : {}),
        ...(v.retake ? { retake: true } : {}),
        ...(v.force ? { force: true } : {}),
        ...(v.groupIds?.length ? { groupIds: v.groupIds } : {}),
        ...(v.timer ? { timer: v.timer } : {}),
      }),
  });
}

function useMyAttemptHistoryQuery(status?: MockAttemptStatus, acrossPrograms = false) {
  const scope = useStudentProgramScope();
  const program = acrossPrograms ? undefined : scope.program;
  return {
    scope,
    options: {
      queryKey: ["mock-attempts-mine", scope.owner, acrossPrograms ? "all-programs" : program, status ?? "all"],
      queryFn: () =>
        loadAttemptHistory(async (cursor) =>
          api.getPaged<MockAttemptSummary[]>("/mock/attempts/mine", {
            status,
            program,
            limit: HISTORY_PAGE_SIZE,
            cursor,
          }),
        ),
      enabled: scope.student && scope.ready,
    },
  };
}

/** The student's whole authorised exam history (newest first), loaded through the cursor API. */
export function useMyMockAttempts(status?: MockAttemptStatus, acrossPrograms = false) {
  const { options } = useMyAttemptHistoryQuery(status, acrossPrograms);
  return useQuery({ ...options, select: (history) => history.items });
}

/** Same data with its completeness: trends and "latest result" must say when only part of the history is shown. */
export function useMyMockAttemptHistory(status?: MockAttemptStatus) {
  const { options } = useMyAttemptHistoryQuery(status);
  return useQuery(options);
}

export function useMockAttempts(status?: MockAttemptStatus, program?: 'IELTS' | 'MULTILEVEL') {
  return useQuery({
    queryKey: ["mock-attempts", status ?? "all", program ?? 'all'],
    queryFn: () => api.get<MockAttemptSummary[]>("/mock/attempts", { status, program }),
  });
}

export function useMockAttempt(attemptId: string) {
  return useQuery({
    queryKey: ["mock-attempt", attemptId],
    queryFn: () => api.get<MockAttemptDetail>(`/mock/attempts/${attemptId}`),
    enabled: !!attemptId,
    refetchInterval: (query) => (query.state.data?.status === "grading" ? 3000 : false),
  });
}

/** Bitta yoki bir nechta javobni saqlash (upsert) */
export function useSaveMockAnswer(attemptId: string) {
  return useMutation({
    mutationFn: (v: { questionId: string; response: string }) =>
      api.post(`/mock/attempts/${attemptId}/answer`, v),
  });
}

export function useBulkMockAnswers(attemptId: string) {
  return useMutation({
    mutationFn: (answers: AnswerEdit[]) =>
      api.post<AnswerSaveResult>(`/mock/attempts/${attemptId}/answers`, { answers }),
  });
}

export function useFlagMockCheat(attemptId: string) {
  return useMutation({
    mutationFn: (event: string) => api.post(`/mock/attempts/${attemptId}/anomaly`, { event }),
  });
}

export function useSaveMockAnnotations(attemptId: string) {
  return useMutation({
    mutationFn: (annotations: unknown[]) =>
      api.put(`/mock/attempts/${attemptId}/annotations`, { annotations }),
  });
}

export function useSubmitMock(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: { confirm?: boolean; confirmed?: boolean; force?: boolean; skills?: string[]; requireExpired?: boolean }) =>
      api.post<{ status: MockAttemptStatus }>(
        `/mock/attempts/${attemptId}/submit`,
        payload ?? { confirm: true },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] });
      qc.invalidateQueries({ queryKey: ["mock-attempts-mine"] });
    },
  });
}

/** Full-test: joriy bo'limni yakunlab keyingisiga o'tish (L→R→W) */
export function useAdvanceMockSection(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { expectedSkill: string; requireExpired?: boolean }) =>
      api.post<{
        saved: boolean;
        currentSkill: string | null;
        submittedSections: string[];
        serverTime: string;
      }>(`/mock/attempts/${attemptId}/advance`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] });
    },
  });
}

/** Speaking audio javobini yuklash (multipart) */
export function useUploadMockSpeaking(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { questionId: string; form: FormData }) =>
      api.post<{ saved: boolean; audioUrl: string; audioDurationMs?: number }>(
        `/mock/attempts/${attemptId}/speaking/${v.questionId}`,
        v.form,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] }),
  });
}

/** Writing qo'lyozma/rasm javobini OCR orqali matnga aylantirish va saqlash (multipart) */
export interface WritingOcrResponse {
  saved?: boolean;
  ocrText: string;
  imageUrls?: string[];
  pages?: Array<{ page: number; imageUrl?: string; text?: string }>;
  wordCount?: number;
}

export function useUploadMockWritingOcr(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { questionId: string; form: FormData }) =>
      api.post<WritingOcrResponse>(
        `/api/v1/mock/attempts/${attemptId}/writing/${v.questionId}/ocr`,
        v.form,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] }),
  });
}

/* ── Grading (staff) ───────────────────────────────────────────────────── */

export function useGradeMock(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { questionId: string; score?: number; feedback?: string; rubricScores?: Record<string, number> }) =>
      api.post<{ saved: boolean; status: MockAttemptStatus }>(
        `/mock/attempts/${attemptId}/grade`,
        v,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] });
      qc.invalidateQueries({ queryKey: ["mock-attempts"] });
      qc.invalidateQueries({ queryKey: ["attempt-assessments", attemptId] });
      qc.invalidateQueries({ queryKey: ["mock-attempts-mine"] });
      qc.invalidateQueries({ queryKey: ["group-ai-ranking"] });
    },
  });
}

/* ── Staff attempt control ───────────────────────────────────────────── */

export function useForceSubmitMock(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/mock/attempts/${attemptId}/force-submit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] }),
  });
}

export function useExtendMockDeadline(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number) => api.post(`/mock/attempts/${attemptId}/extend`, { minutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] }),
  });
}

export function useReopenMock(attemptId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/mock/attempts/${attemptId}/reopen`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-attempt", attemptId] }),
  });
}

export function useDeleteMockAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) => api.delete(`/mock/attempts/${attemptId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-attempts"] });
      qc.invalidateQueries({ queryKey: ["mock-attempts-mine"] });
    },
  });
}

/* ── Authoring: sections / groups / questions / media ──────────────────── */

export function useCreateMockSection(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMockSectionInput) => api.post(`/mock/exams/${examId}/sections`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

export function useUpdateMockSection(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sectionId: string; input: Partial<CreateMockSectionInput> }) =>
      api.patch(`/mock/sections/${v.sectionId}`, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

export function useDeleteMockSection(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: string) => api.delete(`/mock/sections/${sectionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

export function useCreateMockGroup(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sectionId: string; input?: MockGroupInput | { copyFromGroupId: string } }) =>
      api.post(`/mock/sections/${v.sectionId}/groups`, v.input ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

export function useUpdateMockGroup(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groupId: string; input: MockGroupInput | { groupPlacement: { siblingId: string; before: boolean } } }) =>
      api.patch(`/mock/groups/${v.groupId}`, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

/** One transaction and one cache refresh for all material and question edits. */
export function useSaveMockGroupContent(examId: string) {
  const qc = useQueryClient();
  const scope = useStudentProgramScope();
  return useMutation({
    mutationFn: (v: {
      groupId: string;
      input: MockGroupInput;
      questions: (MockQuestionInput & { id?: string })[];
      deletedQuestionIds: string[];
      expectedContentVersion?: number;
    }) => {
      // Optimistic concurrency: send the loaded contentVersion so a stale tab
      // fails with a visible conflict instead of silently overwriting.
      const cached = qc.getQueryData<{ contentVersion?: number }>(["mock-exam", scope.owner, scope.program ?? 'all', examId]);
      const version = v.expectedContentVersion ?? cached?.contentVersion;
      return api.put<{
        saved: number;
        questions: { id: string; number: number }[];
        group: MockGroup;
        version: number;
      }>(
        `/mock/groups/${v.groupId}/content`,
        {
          ...v.input,
          questions: v.questions,
          deletedQuestionIds: v.deletedQuestionIds,
          ...(typeof version === "number" ? { expectedContentVersion: version } : {}),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
    },
  });
}

export function useDeleteMockGroup(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.delete(`/mock/groups/${groupId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

/** Blokka savol(lar) qo'shish */
export function useAddMockQuestions(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groupId: string; questions: MockQuestionInput[] }) =>
      api.post(`/mock/groups/${v.groupId}/questions`, { questions: v.questions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

/** Yopishtirilgan matn + javob kaliti → savollar import */
export function useImportMockQuestions(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groupId: string; text: string; answers?: Record<string, string>; points?: number }) =>
      api.post<{
        added: number;
        questions?: Array<{
          id: string;
          number: number;
          type: string;
          prompt: string;
          options?: string[] | null;
          correctAnswers?: string[] | null;
          acceptedVariants?: string[] | null;
          points?: number;
          wordLimit?: number | null;
        }>;
      }>(`/mock/groups/${v.groupId}/questions/import`, {
        text: v.text,
        answers: v.answers,
        points: v.points,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

export function useUpdateMockQuestion(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { questionId: string; input: Partial<MockQuestionInput> }) =>
      api.patch(`/mock/questions/${v.questionId}`, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

export function useDeleteMockQuestion(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionId: string) => api.delete(`/mock/questions/${questionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

/** Blokka audio/rasm yuklash (multipart) */
export function useSetMockGroupMedia(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groupId: string; form: FormData }) =>
      api.post<{ id: string; hasAudio: boolean; audioUrl: string | null; imageUrl: string | null; version: number }>(`/mock/groups/${v.groupId}/media`, v.form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exam"] }),
  });
}

/* ── Clone / readiness / preview (staff) ─────────────────────────────── */

export interface MockReadinessItem {
  key: string;
  ok: boolean;
  detail: string;
}

export interface MultilevelRepairInspection {
  exam: { id: string; title: string; isPublished: boolean; contentVersion: number; specificationVersion: string | null };
  attempts: { attemptCount: number; activeAttemptCount: number; completedAttemptCount: number; submissionCount: number; resultCount: number };
  readiness: { ready: boolean; exactIssues: string[]; writingProblems: string[]; speakingProblems: string[] };
  writing: Array<{ task: string; role: string; exists: boolean; maxScore: number | null; expectedMaxScore: number | undefined; stimulusRef: string | null; promptPresent: boolean }>;
  writingSharesStimulusRef: boolean;
  speaking: Array<{ part: string; exists: boolean; responseCount: number; expectedResponseCount: number; maxScore: number | null; expectedMaxScore: number | undefined; imageAssetCount: number; requiresTwoPictureAsset: boolean }>;
  safeRepairAllowed: boolean;
  specificationVersion: string | null;
  currentVersion: boolean;
  historyExists: boolean;
  requiresUnpublish: boolean;
  proposedChanges: Array<{ field: string; from: unknown; to: unknown }>;
  manualAuthoringRequired: string[];
  recommendedAction: "CREATE_CORRECTED_COPY" | "REPAIR_DRAFT_THEN_REVIEW";
}

export function useCloneMockExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (examId: string) => api.post<{ id: string }>(`/mock/exams/${examId}/clone`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exams"] }),
  });
}

export function useMockReadiness(examId: string) {
  return useQuery({
    queryKey: ["mock-readiness", examId],
    queryFn: () =>
      api.get<{ examId: string; ready: boolean; items: MockReadinessItem[]; practiceReady?: boolean; practiceSkills?: import("@/lib/types").MockPracticeSkill[]; practiceQuestionCount?: number }>(
        `/mock/exams/${examId}/readiness`,
      ),
    enabled: !!examId,
  });
}

/** Admin-only, read-only gate; never runs until an administrator opens it. */
export function useMultilevelRepairInspection(examId: string, enabled = false) {
  return useQuery({
    queryKey: ["multilevel-repair-inspection", examId],
    queryFn: () => api.get<MultilevelRepairInspection>(`/mock/exams/${examId}/multilevel-repair-inspection`),
    enabled: !!examId && enabled,
    retry: false,
  });
}

export function useApplyMultilevelSafeRepair(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>(`/mock/exams/${examId}/apply-multilevel-safe-repair`, { confirm: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam", examId] });
      qc.invalidateQueries({ queryKey: ["mock-readiness", examId] });
      qc.invalidateQueries({ queryKey: ["multilevel-repair-inspection", examId] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
    },
  });
}

export function useCloneCorrectedMultilevel(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ id: string; status: string; sourcePreserved: boolean }>(`/mock/exams/${examId}/clone-corrected-multilevel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exams"] }),
  });
}

export function useMockPreview(examId: string, enabled = false) {
  return useQuery({
    queryKey: ["mock-preview", examId],
    queryFn: () => api.get(`/mock/exams/${examId}/preview`),
    enabled: !!examId && enabled,
  });
}

/* ── AI JSON import (staff; session stays in the HttpOnly cookie) ────────── */

export interface ValidateImportInput {
  package: unknown;
  mediaBindings?: Record<string, string>;
}

export interface CommitImportInput extends ValidateImportInput {
  validatedChecksum: string;
  targetExamId?: string;
  /** Replace the target draft's sections of the same skills instead of appending (unused drafts only). */
  replaceExisting?: boolean;
}

export type ExportSkill = "listening" | "reading" | "writing" | "speaking";

/**
 * Schema-1.0 package of an exam (GET /mock/exams/:id/export). Staff only: the
 * package contains answer keys, so the server allows the owner teacher or an
 * admin. Media files are referenced, never inlined.
 */
export function exportExamPackage(examId: string, skill?: ExportSkill) {
  return api.get<Record<string, unknown>>(`/mock/exams/${encodeURIComponent(examId)}/export`, skill ? { skill } : undefined);
}

export function useExportExam() {
  return useMutation({
    mutationFn: (v: { examId: string; skill?: ExportSkill }) => exportExamPackage(v.examId, v.skill),
  });
}

/** GET /mock/exams/:id/template — reusable package without answer keys (staff, owner/admin). */
export function exportExamTemplate(examId: string, opts: { skill?: ExportSkill; groupId?: string } = {}) {
  return api.get<Record<string, unknown>>(`/mock/exams/${encodeURIComponent(examId)}/template`, {
    ...(opts.skill ? { skill: opts.skill } : {}),
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
  });
}

export interface ExamLifecyclePayload {
  id: string;
  lifecycle: import("@/lib/types").ExamLifecycle;
  isPublished: boolean;
  validatedAt: string | null;
  validatedVersion: number | null;
  contentVersion: number;
  archivedAt: string | null;
}

/** POST /mock/exams/:id/{validate|archive|restore}; refreshes lists and the open exam. */
export function useExamLifecycle(action: "validate" | "archive" | "restore") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (examId: string) =>
      api.post<ExamLifecyclePayload>(`/mock/exams/${encodeURIComponent(examId)}/${action}`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mock-exams"] });
      void qc.invalidateQueries({ queryKey: ["mock-exam"] });
      void qc.invalidateQueries({ queryKey: ["mock-readiness"] });
    },
  });
}

export interface BankGroupQuestion {
  number: number;
  type: string;
  prompt: string;
  options: string[];
  cefrLevel: string | null;
  skillTags: string[];
}

export interface BankGroup {
  groupId: string;
  title: string | null;
  instructions: string | null;
  skill: import("@/lib/types").MockSkill;
  partNumber: number | null;
  examId: string;
  examTitle: string;
  examType: import("@/lib/types").MockExamType;
  hasAudio: boolean;
  hasImage: boolean;
  passageExcerpt: string;
  questionCount: number;
  questions: BankGroupQuestion[];
}

export interface BankQuery {
  search?: string;
  examType?: string;
  section?: string;
  type?: string;
  tag?: string;
  cefrLevel?: string;
  excludeExamId?: string;
}

/** GET /mock/question-bank/groups — reusable groups (own exams; admins all). Never answer keys. */
export function useQuestionBank(query: BankQuery, enabled = true) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>;
  return useQuery({
    queryKey: ["question-bank", clean],
    queryFn: () => api.get<{ items: BankGroup[]; count: number }>("/mock/question-bank/groups", clean),
    enabled,
    staleTime: 30_000,
  });
}

/** POST /mock/exams/:id/bank-insert — copies whole groups into the draft (renumbered). */
export function useBankInsert(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupIds: string[]) =>
      api.post<{ examId: string; inserted: Array<{ sourceGroupId: string; groupId: string; skill: string; numbers: number[]; partNumberDropped: boolean }>; version: number }>(
        `/mock/exams/${encodeURIComponent(examId)}/bank-insert`,
        { groupIds },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mock-exam"] });
      void qc.invalidateQueries({ queryKey: ["mock-exams"] });
      void qc.invalidateQueries({ queryKey: ["mock-readiness"] });
    },
  });
}

export function useValidateExamImport() {
  return useMutation({
    mutationFn: (v: ValidateImportInput) =>
      api.post<import("@/lib/types").MockImportReport>("/mock/exam-imports/validate", {
        package: v.package,
        ...(v.mediaBindings ? { mediaBindings: v.mediaBindings } : {}),
      }),
  });
}

export function useStageImportMedia() {
  return useMutation({
    mutationFn: (form: FormData) =>
      api.post<import("@/lib/types").MockStagedUpload>("/mock/exam-imports/media", form),
  });
}

export function useCommitExamImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CommitImportInput) =>
      api.post<import("@/lib/types").MockImportCommit>("/mock/exam-imports", {
        package: v.package,
        ...(v.mediaBindings ? { mediaBindings: v.mediaBindings } : {}),
        validatedChecksum: v.validatedChecksum,
        ...(v.targetExamId ? { targetExamId: v.targetExamId } : {}),
        ...(v.targetExamId && v.replaceExisting ? { replaceExisting: true } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mock-exams"] }),
  });
}

export function useImportStatus(packageId: string, revision: number, enabled = false) {
  return useQuery({
    queryKey: ["mock-import-status", packageId, revision],
    queryFn: () =>
      api.get<import("@/lib/types").MockImportCommit>(
        `/mock/exam-imports/by-package/${encodeURIComponent(packageId)}/revisions/${revision}`,
      ),
    enabled: !!packageId && !!revision && enabled,
    retry: false,
  });
}

/** Exam Builder provenance: package identity + open issues + source maps. */
export function useExamImportProvenance(examId: string, enabled = false) {
  return useQuery({
    queryKey: ["mock-import-provenance", examId],
    queryFn: () =>
      api.get<import("@/lib/types").MockExamImportProvenance>(
        `/mock/exam-imports/by-exam/${examId}`,
      ),
    enabled: !!examId && enabled,
    retry: false,
  });
}

export function useResolveImportIssue(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) =>
      api.post(`/mock/exam-imports/issues/${issueId}/resolve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-import-provenance", examId] });
      qc.invalidateQueries({ queryKey: ["mock-readiness", examId] });
    },
  });
}

/* ── Smart Bulk Import, Excel Import & Single Audio Timestamps ──────────── */

export function useSmartParseQuestions() {
  return useMutation({
    mutationFn: (body: FormData | {
      text?: string;
      defaultSkill?: import("@/lib/types").MockSkill;
      examType?: string;
    }) => api.post<import("@/lib/types").SmartParseResult>("/mock/smart-parse", body),
  });
}

export function useExamBulkImport(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      skill: import("@/lib/types").MockSkill;
      text?: string;
      questions?: unknown[];
      answers?: Record<string, string>;
      passages?: unknown[];
      parts?: unknown[];
      passageText?: string;
      instructions?: string;
      replaceExisting?: boolean;
    }) =>
      api.post<{ added: number; questions?: unknown[] }>(
        `/mock/exams/${examId}/bulk-import`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
      qc.invalidateQueries({ queryKey: ["mock-readiness", examId] });
    },
  });
}

export function useGroupBulkImport(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      groupId: string;
      text?: string;
      questions?: unknown[];
      answers?: Record<string, string>;
      passages?: unknown[];
      parts?: unknown[];
      passageText?: string;
      instructions?: string;
      replaceExisting?: boolean;
    }) => {
      const { groupId, ...body } = v;
      return api.post<{ added: number; questions?: unknown[] }>(
        `/mock/groups/${groupId}/bulk-import`,
        body,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
      qc.invalidateQueries({ queryKey: ["mock-readiness", examId] });
    },
  });
}

export function useImportExamExcel(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      api.post<{ added: number; questions?: unknown[] }>(
        `/mock/exams/${examId}/import-excel`,
        form,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
      qc.invalidateQueries({ queryKey: ["mock-exams"] });
      qc.invalidateQueries({ queryKey: ["mock-readiness", examId] });
    },
  });
}

export function useAudioTimestamps(examId: string, enabled = true) {
  return useQuery({
    queryKey: ["mock-audio-timestamps", examId],
    queryFn: () =>
      api.get<import("@/lib/types").AudioTimestampsResponse>(
        `/mock/exams/${examId}/audio-timestamps`,
      ),
    enabled: !!examId && enabled,
    retry: false,
  });
}

export function useSaveAudioTimestamps(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      payload:
        | FormData
        | {
            audioKey?: string;
            audioUrl?: string;
            durationSec?: number;
            timestamps: import("@/lib/types").AudioTimestampItem[];
          },
    ) =>
      api.post<import("@/lib/types").AudioTimestampsResponse>(
        `/mock/exams/${examId}/audio-timestamps`,
        payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-audio-timestamps", examId] });
      qc.invalidateQueries({ queryKey: ["mock-exam"] });
    },
  });
}

/* ── Score Prediction Engine (IELTS 0–9.0 & Multi-Level 0–75 CEFR) ─────── */

export function useMyScorePrediction(enabled = true) {
  return useQuery({
    queryKey: ["score-prediction", "me"],
    queryFn: () => api.get<import("@/lib/types").ScorePredictionResponse>("/mock/prediction/me"),
    enabled,
    retry: false,
  });
}

export function useStudentScorePrediction(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: ["score-prediction", studentId ?? "me"],
    queryFn: () =>
      studentId
        ? api.get<import("@/lib/types").ScorePredictionResponse>(`/students/${studentId}/prediction`)
        : api.get<import("@/lib/types").ScorePredictionResponse>("/mock/prediction/me"),
    enabled,
    retry: false,
  });
}

export function useUpdatePredictionTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      targetIeltsBand?: number;
      targetMultilevelScore?: number;
      targetCefr?: string;
    }) => api.patch<import("@/lib/types").ScorePredictionResponse>("/mock/prediction/me", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["score-prediction"] });
    },
  });
}

/* ── Live Exam Rooms (PIN Mode & Teacher Live Monitor) ─────────────────── */

export function useLiveExamRooms(groupId?: string) {
  return useQuery({
    queryKey: ["mock-live-rooms", groupId ?? "all"],
    queryFn: () =>
      api.get<import("@/lib/types").LiveExamRoom[]>("/mock/live-rooms", groupId ? { groupId } : undefined),
    retry: false,
  });
}

export function useCreateLiveExamRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      examId: string;
      groupId?: string;
      simulatorMode: import("@/lib/types").ExamSimulatorMode;
      title?: string;
      durationMinutes?: number;
    }) => api.post<import("@/lib/types").LiveExamRoom>("/mock/live-rooms", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mock-live-rooms"] });
    },
  });
}

export function useJoinLiveExamRoom() {
  return useMutation({
    mutationFn: (body: { pin: string }) =>
      api.post<import("@/lib/types").LiveRoomJoinResult>("/mock/live-rooms/join", body),
  });
}

export function useLiveExamRoomMonitor(roomId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["mock-live-room-monitor", roomId],
    queryFn: () =>
      api.get<import("@/lib/types").LiveRoomMonitorResponse>(
        `/mock/live-rooms/${roomId}/monitor`,
      ),
    enabled: !!roomId && enabled,
    refetchInterval: 4000,
    retry: false,
  });
}

export function useReportLiveRoomProgress(roomId: string | null) {
  return useMutation({
    mutationFn: (body: {
      attemptId?: string;
      currentSkill?: string;
      currentQuestionNumber?: number;
      answeredCount?: number;
      flaggedCount?: number;
      status?: string;
    }) => {
      if (!roomId) return Promise.resolve(null);
      return api.post(`/mock/live-rooms/${roomId}/progress`, body);
    },
  });
}

export function useCloseLiveExamRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => api.post(`/mock/live-rooms/${roomId}/close`),
    onSuccess: (_data, roomId) => {
      qc.invalidateQueries({ queryKey: ["mock-live-rooms"] });
      qc.invalidateQueries({ queryKey: ["mock-live-room-monitor", roomId] });
    },
  });
}



/* ── Adaptive Study Plan & Mistake Vault Hooks ───────────────────────── */

export function useStudentStudyPlan(targetMonths?: number, targetExamDate?: string) {
  return useQuery({
    queryKey: ["student-study-plan", targetMonths, targetExamDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (targetMonths) params.set("target_months", String(targetMonths));
      if (targetExamDate) params.set("target_exam_date", targetExamDate);
      const queryStr = params.toString() ? `?${params.toString()}` : "";
      return api.get<import("@/lib/types").AdaptiveStudyPlanResponse>(`/students/study-plan${queryStr}`);
    },
    retry: false,
  });
}

export function useUpdateStudyPlanTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { targetMonths?: number; targetExamDate?: string }) =>
      api.post<import("@/lib/types").AdaptiveStudyPlanResponse>("/students/study-plan/target", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["student-study-plan"] });
    },
  });
}

export function useMistakeVault() {
  return useQuery({
    queryKey: ["student-mistake-vault"],
    queryFn: () => api.get<import("@/lib/types").MistakeVaultResponse>("/students/mistake-vault"),
    retry: false,
  });
}

export function useTargetedPractice(categoryId?: string, enabled = true) {
  return useQuery({
    queryKey: ["targeted-practice", categoryId],
    queryFn: () => {
      const param = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : "";
      return api.get<import("@/lib/types").TargetedPracticeResponse>(`/students/mistake-vault/practice${param}`);
    },
    enabled: !!categoryId && enabled,
    retry: false,
  });
}

/* ── Teacher Hub Group Analytics & Attendance Hooks ──────────────────── */

export function useGroupAnalytics(groupId?: string, enabled = true, filters: Record<string, string> = {}) {
  return useQuery({
    queryKey: ["group-exam-analytics", groupId, filters],
    queryFn: () => api.get<import("@/lib/types").GroupAnalyticsResponse>(`/groups/${groupId}/analytics`, filters),
    enabled: !!groupId && enabled,
    retry: false,
  });
}

export function useGroupAttendanceSummary(groupId?: string, date?: string, enabled = true) {
  return useQuery({
    queryKey: ["group-attendance-summary", groupId, date],
    queryFn: () => {
      const param = date ? `?date=${encodeURIComponent(date)}` : "";
      return api.get<import("@/lib/types").GroupAttendanceSummaryResponse>(`/attendance/group-summary/${groupId}${param}`);
    },
    enabled: !!groupId && enabled,
    retry: false,
  });
}

/* ---------- Listening audio gate (supplied-material mocks) ---------- */
export function useExamGate(examId: string) {
  return useQuery({
    queryKey: ["mock-gate", examId],
    queryFn: () => api.get<ExamGate>(`/mock/exams/${examId}/listening-audio`),
    enabled: !!examId,
    retry: false,
  });
}

function invalidateGate(qc: ReturnType<typeof useQueryClient>, examId: string) {
  qc.invalidateQueries({ queryKey: ["mock-gate", examId] });
  qc.invalidateQueries({ queryKey: ["mock-readiness", examId] });
  qc.invalidateQueries({ queryKey: ["mock-exam"] });
}

export function useUploadListeningAudio(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groupId: string; file: File }) => {
      const form = new FormData();
      form.append("audio", v.file);
      return api.post<{ status: string; revision: number; replaced: boolean; warnings: string[] }>(`/mock/groups/${v.groupId}/listening-audio`, form);
    },
    onSuccess: () => invalidateGate(qc, examId),
  });
}

export function useVerifyListeningAudio(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { groupId: string; heardQuestions: number[]; note: string }) =>
      api.post(`/mock/groups/${v.groupId}/listening-audio/verify`, {
        attestation: true, listenedFully: true, heardQuestions: v.heardQuestions, note: v.note,
      }),
    onSuccess: () => invalidateGate(qc, examId),
  });
}

export function useSetContentRights(examId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { status: "verified" | "unverified"; evidence: string }) =>
      api.post(`/mock/exams/${examId}/content-rights`, { status: v.status, attestation: v.status === "verified", evidence: v.evidence }),
    onSuccess: () => invalidateGate(qc, examId),
  });
}
