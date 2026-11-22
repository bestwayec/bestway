"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/* ------------------------------------------------------------------ types (mirror teacher_workspace.py) */

export type HomeworkKind = "quiz" | "vocabulary" | "exam" | "lesson";
export type HomeworkStatus = "not_started" | "in_progress" | "submitted" | "awaiting_review" | "graded" | "overdue";
export type MarkState = "present" | "absent" | "late";

export interface WorkspaceGroup {
  id: string;
  name: string;
  studentCount: number;
  scheduledToday: boolean;
  todaySlots: { startTime: string | null; endTime: string | null }[];
  attendance: { present: number; late: number; absent: number; marked: number };
}

export interface UpcomingItem {
  kind: HomeworkKind;
  id: string;
  title: string;
  groupId: string;
  groupName: string;
  deadline: string;
}

export interface WorkspaceOverview {
  date: string;
  groups: WorkspaceGroup[];
  todayGroups: number;
  today: { present: number; late: number; absent: number };
  activeHomework: number;
  awaitingReview: number;
  upcoming: UpcomingItem[];
}

export interface AttendanceSheet {
  groupId: string;
  groupName: string;
  date: string;
  scheduled: boolean;
  slots: { startTime: string | null; endTime: string | null }[];
  students: { studentId: string; name: string; active: boolean; state: MarkState | null }[];
  marked: number;
  total: number;
  counts: Record<MarkState, number>;
  excusedSupported: boolean;
  revision: string;
  archived: boolean;
}

export interface AttendanceSaveResult {
  updated: number;
  summary: Record<MarkState, number>;
  marked: number;
  total: number;
  revision: string;
  date: string;
}

export interface HomeworkOptions {
  group: { id: string; name: string; studentCount: number };
  quizzes: { id: string; title: string; category: string; questionCount: number; status: string; timeLimitMinutes: number | null; maxAttempts: number }[];
  vocabularySets: { id: string; title: string; wordCount: number }[];
  exams: { id: string; title: string; type: string }[];
  lessons: { id: string; title: string }[];
}

export interface HomeworkDraft {
  type: HomeworkKind;
  title?: string;
  deadline: string;
  quizId?: string;
  newQuiz?: { questionsText: string; answerKey: string; category: "grammar" | "vocabulary" | "mixed" };
  timeLimitMinutes?: number | null;
  maxAttempts?: number;
  vocabularySetId?: string;
  examId?: string;
  lessonId?: string;
  minPassPercent?: number;
}

export interface HomeworkPreview {
  type: HomeworkKind;
  title: string;
  deadline: string;
  groupId: string;
  groupName: string;
  studentCount: number;
  questionCount?: number;
  timeLimitMinutes?: number | null;
  maxAttempts?: number;
  minPassPercent?: number;
  lessonTitle?: string | null;
}

export interface AssignResult {
  created: boolean;
  kind: HomeworkKind;
  id: string;
  title: string;
  groupId: string;
}

export interface ResultRow {
  studentId: string;
  name: string;
  removed: boolean;
  status: HomeworkStatus;
  percent: number | null;
  correct?: number | null;
  total?: number | null;
  passed?: boolean;
  submittedAt: string | null;
  attemptId?: string | null;
  submissionId?: string | null;
  canGrade: boolean;
}

export interface HomeworkResults {
  assignment: {
    kind: HomeworkKind;
    id: string;
    title: string;
    groupId: string;
    groupName: string;
    deadline: string;
    questionCount?: number;
    minPassPercent?: number;
    closed: boolean;
    createdAt: string;
  };
  counts: { assigned: number; submitted: number; pending: number; overdue: number; awaitingReview: number; graded: number };
  averagePercent: number | null;
  students: ResultRow[];
  refreshedAt: string;
}

export type GroupHomeworkItem = Pick<HomeworkResults, "assignment" | "counts" | "averagePercent">;

export interface StudentHomeworkItem {
  kind: HomeworkKind;
  id: string;
  title: string;
  type: string;
  groupName: string;
  teacherName: string;
  deadline: string;
  status: HomeworkStatus;
  percent: number | null;
  passed?: boolean;
  questionCount?: number;
  timeLimitMinutes?: number | null;
  attemptsLeft?: number;
  canStart: boolean;
  canSubmit?: boolean;
  examId?: string | null;
  href: string | null;
  activeAttemptId?: string | null;
  lastAttemptId?: string | null;
}

/* ------------------------------------------------------------------ quiz runner (shared ClassQuiz HTTP API) */

export interface QuizQuestion {
  id: string;
  type: "mcq" | "tf" | "text";
  prompt: string;
  options: string[];
  points: number;
}

export interface QuizAttempt {
  attemptId: string;
  assignmentId: string;
  status: "in_progress" | "submitted";
  resumed: boolean;
  title: string;
  questionCount: number;
  questions: QuizQuestion[];
  savedAnswers: Record<string, string>;
  nextIndex: number | null;
  deadlineAt: string;
  serverTime: string;
  secondsLeft: number;
  attemptNo: number;
}

export interface QuizResult {
  attemptId: string;
  status: "submitted";
  title: string;
  correct: number;
  total: number;
  percent: number;
  durationSeconds: number;
  autoSubmitted: boolean;
  keysVisible: boolean;
  isIeltsBand: false;
  review?: { questionId: string; prompt: string; yourAnswer: string; correctAnswer: string | null; isCorrect: boolean; answered: boolean; explanation: string; index: number }[];
}

/* ------------------------------------------------------------------ hooks */

const BASE = "/teacher/workspace";

export function useWorkspaceOverview() {
  return useQuery({ queryKey: ["tw", "overview"], queryFn: () => api.get<WorkspaceOverview>(`${BASE}/overview`), refetchInterval: 60_000 });
}

export function useAttendanceSheet(groupId?: string, date?: string) {
  return useQuery({
    queryKey: ["tw", "attendance", groupId, date],
    queryFn: () => api.get<AttendanceSheet>(`${BASE}/groups/${groupId}/attendance`, date ? { date } : undefined),
    enabled: !!groupId,
    refetchOnWindowFocus: false, // never replace marks the teacher is editing
  });
}

export function useAttendanceHistory(groupId?: string) {
  return useQuery({
    queryKey: ["tw", "attendance-history", groupId],
    queryFn: () => api.get<{ date: string; present: number; absent: number; late: number }[]>(`${BASE}/groups/${groupId}/attendance/history`),
    enabled: !!groupId,
  });
}

export function useSaveAttendance(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; revision: string; records: { studentId: string; state: MarkState }[] }) =>
      api.put<AttendanceSaveResult>(`${BASE}/groups/${groupId}/attendance`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tw", "overview"] });
      void qc.invalidateQueries({ queryKey: ["tw", "attendance-history", groupId] });
      void qc.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useHomeworkOptions(groupId?: string) {
  return useQuery({
    queryKey: ["tw", "options", groupId],
    queryFn: () => api.get<HomeworkOptions>(`${BASE}/groups/${groupId}/homework/options`),
    enabled: !!groupId,
  });
}

export function usePreviewHomework(groupId: string) {
  return useMutation({ mutationFn: (draft: HomeworkDraft) => api.post<HomeworkPreview>(`${BASE}/groups/${groupId}/homework/preview`, draft) });
}

export function useAssignHomework(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: HomeworkDraft) => api.post<AssignResult>(`${BASE}/groups/${groupId}/homework`, draft),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tw"] });
    },
  });
}

export function useGroupHomework(groupId?: string) {
  return useQuery({
    queryKey: ["tw", "group-homework", groupId],
    queryFn: () => api.get<GroupHomeworkItem[]>(`${BASE}/groups/${groupId}/homework`),
    enabled: !!groupId,
    refetchInterval: 30_000,
  });
}

export function useHomeworkResults(kind?: HomeworkKind, id?: string) {
  return useQuery({
    queryKey: ["tw", "results", kind, id],
    queryFn: () => api.get<HomeworkResults>(`${BASE}/homework/${kind}/${id}/results`),
    enabled: !!kind && !!id,
    refetchInterval: 15_000, // live progress without a full page reload
  });
}

export function useRemindPending(kind: HomeworkKind, id: string) {
  return useMutation({
    mutationFn: () => api.post<{ queued: number; pending: number; linked: number }>(`${BASE}/homework/${kind}/${id}/remind`),
  });
}

export function useGradeSubmission(assignmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { student_id: string; score_percent: number }) => api.post(`/teacher/assignments/${assignmentId}/grade`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tw", "results"] }),
  });
}

export function useStudentHomework() {
  return useQuery({ queryKey: ["student", "homework"], queryFn: () => api.get<StudentHomeworkItem[]>("/student/homework"), refetchInterval: 60_000 });
}

/* ------------------------------------------------------------------ helpers */

/** Local `YYYY-MM-DD` (the teacher's calendar day, not UTC). */
export function localDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Default deadline: the day after tomorrow at 20:00 local time, as an ISO string with offset. */
export function defaultDeadline(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 2);
  d.setHours(20, 0, 0, 0);
  return toLocalInput(d);
}

/** `<input type="datetime-local">` value for a Date. */
export function toLocalInput(d: Date): string {
  return `${localDay(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** datetime-local value -> ISO 8601 with the browser's UTC offset (the server requires an aware timestamp). */
export function localInputToIso(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${value.length === 16 ? `${value}:00` : value}${sign}${hh}:${mm}`;
}

export function attendanceSummary(marks: Record<string, MarkState | null | undefined>): Record<MarkState, number> {
  const out: Record<MarkState, number> = { present: 0, absent: 0, late: 0 };
  for (const state of Object.values(marks)) if (state) out[state] += 1;
  return out;
}

/** Which students changed compared with the saved sheet (only these need saving; unmarked stay unmarked). */
export function changedRecords(saved: AttendanceSheet["students"], marks: Record<string, MarkState | null | undefined>) {
  return saved
    .filter((s) => marks[s.studentId] && marks[s.studentId] !== s.state)
    .map((s) => ({ studentId: s.studentId, state: marks[s.studentId] as MarkState }));
}

/** `23.11.2026 20:00` — numeric on purpose: ICU's Uzbek short months render as "M11" in Chromium. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
