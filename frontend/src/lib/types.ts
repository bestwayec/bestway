/**
 * Backend bilan umumiy tiplar.
 * Manba: api-contract.md + backend controller va service fayllari
 * Bu yerdagi nomlar backenddagi javob maydonlariga bir milimetr aniqlikda mos.
 */

export type Role = "super_admin" | "admin" | "teacher" | "student" | "parent";
export type AttendanceState = "present" | "absent" | "late" | "empty" | "blank";
/**
 * To'lov holati. `empty` — client-only: DB da Payment yozuvi yo'q
 * (holat hali qayd etilmagan). `unpaid` dan farqi: unpaid — admin
 * "to'lamadi" deb aniq belgilagan; empty — hali hech narsa belgilanmagan.
 * Backend PUT /payments/bulk da `state: "empty"` yozuvni o'chiradi.
 */
export type PaymentState = "paid" | "unpaid" | "partial" | "empty";
export type PaymentMethod = "manual";
export type TestType = "ielts" | "multilevel";
export type TestSection = "listening" | "reading" | "writing" | "speaking";
export type QuestionType = "multiple_choice" | "short_answer" | "essay" | "speaking_prompt";
export type AttemptStatus = "in_progress" | "grading" | "completed";
export type NotificationType =
  | "points"
  | "payment_reminder"
  | "test_result"
  | "attendance"
  | "announcement"
  | "game";
export type PurchaseStatus = "pending_confirmation" | "purchased";

/* ── Javob konverti (backend/src/common/transform.interceptor.ts) ────────── */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResponse<T> =
  | { success: true; data: T; meta?: PageMeta }
  | { success: false; error: ApiError };

/* ── Auth ────────────────────────────────────────────────────────────────── */

export interface PublicUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  createdAt: string;
}

export interface StudentSelfProfile {
  availablePrograms?: ('IELTS' | 'MULTILEVEL')[];
  activeProgram?: 'IELTS' | 'MULTILEVEL' | null;
  isApproved: boolean;
  groupId: string | null;
  groupName: string | null;
  currentPoints: number;
  linkCode: string;
}

export interface ChildSummary {
  studentId: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  isApproved: boolean;
  currentPoints: number;
}

export interface ParentSelfProfile {
  children: ChildSummary[];
}

export interface TeacherGroupSummary {
  id: string;
  name: string;
  studentsCount: number;
}

export interface TeacherSelfProfile {
  groups: TeacherGroupSummary[];
}

/** GET /auth/me */
export interface Me {
  user: PublicUser;
  profile: StudentSelfProfile | ParentSelfProfile | TeacherSelfProfile | null;
  unreadNotifications: number;
  telegramLinked: boolean;
}

export interface AuthTokens {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/* ── Users / Groups ──────────────────────────────────────────────────────── */

export interface UserListItem {
  id: string;
  name: string;
  phone: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  student: {
    isApproved: boolean;
    groupId: string | null;
    groupName: string | null;
    currentPoints: number;
    linkCode?: string;
  } | null;
}

export type WeekDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface ScheduleItem {
  day: WeekDay;
  startTime: string;
  endTime: string;
}

export interface GroupListItem {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  schedule: ScheduleItem[] | null;
  studentsCount: number;
  createdAt: string;
}

export interface GroupStudent {
  studentId: string;
  name: string;
  phone: string;
  isActive: boolean;
  isApproved: boolean;
  currentPoints: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  schedule: ScheduleItem[] | null;
  createdAt: string;
  students: GroupStudent[];
}

/* ── Attendance ──────────────────────────────────────────────────────────── */

/** GET /attendance — date: "YYYY-MM-DD" */
export interface AttendanceRow {
  studentId: string;
  date: string;
  state: AttendanceState;
}

/** PUT /attendance/bulk */
export interface AttendanceBulkBody {
  groupId: string;
  date: string;
  records: { studentId: string; state: AttendanceState }[];
}

/** GET /attendance/stats */
export interface AttendanceStatRow {
  studentId: string;
  name: string;
  present: number;
  absent: number;
  late: number;
}

/* ── Payments ────────────────────────────────────────────────────────────── */

export interface PaymentRow {
  studentId: string;
  studentName: string;
  month: number;
  year: number;
  state: PaymentState;
  amount: number;
  method: PaymentMethod;
  note: string | null;
}

/** PUT /payments/bulk */
export interface PaymentBulkBody {
  year: number;
  records: {
    studentId: string;
    month: number;
    state: PaymentState;
    amount?: number;
    note?: string;
  }[];
}

export interface DebtorRow {
  studentId: string;
  name: string;
  phone: string;
  groupName: string | null;
  state: PaymentState;
  amount: number;
  note: string | null;
}

/* ── Points ──────────────────────────────────────────────────────────────── */

export interface PointsHistoryItem {
  change: number;
  reason: string;
  byUserId: string | null;
  byUserName: string | null;
  date: string;
}

export interface PointsDetail {
  current: number;
  history: PointsHistoryItem[];
}

export interface LeaderboardRow {
  studentId: string;
  name: string;
  points: number;
  rank: number;
}

/* ── Notifications ───────────────────────────────────────────────────────── */

export interface NotificationItem {
  id: string;
  type: NotificationType;
  text: string;
  read: boolean;
  date: string;
}

/* ── Stats (GET /stats/dashboard) ────────────────────────────────────────── */

export interface DashboardStats {
  students: number;
  approvedStudents: number;
  teachers: number;
  parents: number;
  groups: number;
  tests: number;
  videos: number;
  today: {
    date: string;
    marked: number;
    present: number;
    absent: number;
    late: number;
    attendanceRate: number | null;
  };
  month: {
    month: number;
    year: number;
    income: number;
    paidCount: number;
    debtors: number;
  };
  queue: {
    grading: number;
    pendingPurchases: number;
  };
}

export interface IncomePoint {
  month: number;
  year: number;
  income: number;
  paidCount: number;
}

/* ── Exam activity (GET /stats/exam-activity) ─────────────────────────── */

export type ExamActivityRange = "today" | "7d" | "30d" | "3m" | "6m" | "year";

export interface ExamActivityBucket {
  /** Bucket start (ISO). Hourly for today, daily/weekly/monthly otherwise. */
  key: string;
  started: number;
  completed: number;
  avgScore: number | null;
}

export interface ExamActivity {
  range: ExamActivityRange;
  buckets: ExamActivityBucket[];
  totals: {
    started: number;
    completed: number;
    avgScore: number | null;
    completionRate: number;
  };
}

/* ── Settings ────────────────────────────────────────────────────────────── */

export interface Settings {
  teacherPointLimit: number;
  initialPoints: number;
  monthlyFee: number;
  gameThreshold: number;
}

export interface UpdateSettingsInput {
  teacherPointLimit?: number;
  initialPoints?: number;
  monthlyFee?: number;
  gameThreshold?: number;
}

/* ── IELTS band tables (super_admin) ─────────────────────────────────────── */

/** Xom→band jadvali: [[minRaw 0..40, band 0..9], ...] (kamayuvchi tartib) */
export type BandTable = Array<[number, number]>;

export interface IeltsBands {
  listening: BandTable;
  readingAcademic: BandTable;
  readingGeneral: BandTable;
}

export interface IeltsBandsResponse extends IeltsBands {
  customized: Record<keyof IeltsBands, boolean>;
}

export interface UpdateIeltsBandsInput {
  listening?: BandTable;
  readingAcademic?: BandTable;
  readingGeneral?: BandTable;
}

/* ── Articles ────────────────────────────────────────────────────────────── */

export interface Article {
  id: string;
  title: string;
  body: string;
  category: string | null;
  tags: string[];
  authorId?: string;
  authorName?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateArticleInput {
  title: string;
  body: string;
  category: string;
  tags?: string[];
}

/* ── Gallery (AccordionGallery) ─────────────────────────────────────────── */

export interface GalleryImage {
  id: string;
  image: string;
  label?: string;
  link?: string;
  alt?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface GalleryAdminItem extends GalleryImage {
  imageKey: string;
  updatedAt: string;
}

export interface CreateGalleryInput {
  label?: string;
  link?: string;
  alt?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateGalleryInput {
  label?: string;
  link?: string;
  alt?: string;
  sortOrder?: number;
  isActive?: boolean;
}

/* ── Users (management) ──────────────────────────────────────────────────── */

/** GET /users/:id — base + rolga qarab children yoki groups */
export interface UserDetail extends UserListItem {
  children?: ChildSummary[];
  groups?: TeacherGroupSummary[];
}

export interface CreateUserInput {
  name: string;
  phone: string;
  password: string;
  role: Exclude<Role, "super_admin">;
  groupId?: string;
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
  password?: string;
  role?: Exclude<Role, "super_admin">;
  isActive?: boolean;
  isApproved?: boolean;
  groupId?: string | null;
}

/* ── Groups (management) ─────────────────────────────────────────────────── */

export interface GroupInput {
  name: string;
  teacherId?: string | null;
  schedule?: ScheduleItem[];
}

/* ── Audit ───────────────────────────────────────────────────────────────── */

export interface AuditLogItem {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

/* ── Telegram ────────────────────────────────────────────────────────────── */

export interface TelegramStatus {
  linked: boolean;
  botUsername: string | null;
}

export interface TelegramLinkToken {
  url: string;
  token: string;
  expiresAt: string;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

export interface TestListItem {
  id: string;
  type: TestType;
  title: string;
  level: string | null;
  isDemo: boolean;
  isActive: boolean;
  durationMinutes: number | null;
  questionCount: number;
  sections: TestSection[];
}

export interface TestQuestionFull {
  id: string;
  testId: string;
  section: TestSection;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  correctAnswer: string | null;
  maxScore: number;
  createdAt: string;
  /** Comfortable testing: passage / instructions / audio (nullable — legacy rows lack them) */
  passageText?: string | null;
  instructions?: string | null;
  audioUrl?: string | null;
  hasAudio?: boolean;
}

export interface TestDetail {
  id: string;
  type: TestType;
  title: string;
  level: string | null;
  isDemo: boolean;
  isActive: boolean;
  durationMinutes: number | null;
  sectionQuestionCounts: Record<string, number> | null;
  questionCount: number;
  /** faqat xodimlar uchun */
  questions?: TestQuestionFull[];
}

/** O'quvchiga yuboriladigan savol — to'g'ri javobsiz */
export interface RunnerQuestion {
  id: string;
  section: TestSection;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  maxScore: number;
}

export interface StartResult {
  attemptId: string;
  resumed: boolean;
  durationMinutes: number | null;
  startedAt: string;
  questions: RunnerQuestion[];
  savedAnswers?: Record<string, string>;
}

export interface AttemptSummary {
  id: string;
  studentId: string;
  studentName?: string;
  testId: string;
  testTitle?: string;
  testType?: TestType;
  status: AttemptStatus;
  autoScore: number | null;
  manualScore: number | null;
  totalScore: number | null;
  antiCheatCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface AttemptQuestion {
  order: number;
  questionId: string;
  section: TestSection;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  maxScore: number;
  correctAnswer?: string | null;
  answer: string | null;
  score: number | null;
  isGraded: boolean;
  comment: string | null;
}

export interface AttemptDetail extends AttemptSummary {
  questions: AttemptQuestion[];
  cheatEvents?: { event: string; date: string }[];
}

export interface CreateTestInput {
  type: TestType;
  title: string;
  level?: string;
  isDemo?: boolean;
  durationMinutes?: number;
  sectionQuestionCounts?: Record<string, number>;
}

export interface CreateQuestionInput {
  section: TestSection;
  type: QuestionType;
  prompt: string;
  options?: string[];
  correctAnswer?: string;
  maxScore?: number;
  passageText?: string;
  instructions?: string;
  audioUrl?: string;
}

export interface TestImportIssue {
  line?: number;
  message: string;
}

export interface TestImportQuestion extends CreateQuestionInput {
  number: number;
  line: number;
  maxScore: number;
}

export interface TestImportPreview {
  questions: TestImportQuestion[];
  errors: TestImportIssue[];
  warnings: TestImportIssue[];
  sectionCounts: Partial<Record<TestSection, number>>;
}

/* ── Videos ──────────────────────────────────────────────────────────────── */

export type VideoAccess = "granted" | "pending_confirmation" | "locked";

export interface VideoLessonItem {
  id: string;
  title: string;
  description: string | null;
  price: number;
  isFreeForApproved: boolean;
  thumbnailUrl: string | null;
  createdAt: string;
  /** login bo'lganda qo'shiladi */
  access?: VideoAccess;
}

export interface VideoPurchaseItem {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  videoId: string;
  videoTitle: string;
  price: number;
  status: PurchaseStatus;
  method: string;
  createdAt: string;
}

export interface StreamUrl {
  url: string;
  expiresAt: string;
}

/* ── Broadcast ───────────────────────────────────────────────────────────── */

export type BroadcastAudience = "all" | "role" | "group" | "debtors";

export interface BroadcastInput {
  audience: BroadcastAudience;
  role?: Role;
  groupId?: string;
  includeParents?: boolean;
  text: string;
}

/* ── Mock exams (backend/src/mock) ───────────────────────────────────────── */

export type MockExamType = "ielts_academic" | "ielts_general" | "multilevel";
export type PracticeLevel = "A1" | "A2" | "B1" | "B2" | "C1";
export type ObjectiveAnswerRule = "ONE_WORD" | "ONE_WORD_AND_OR_NUMBER";
export type MockContentLayout = "document" | "table" | "notes" | "summary" | "sentences" | "headings" | "speakers" | "short_texts" | "paragraphs" | "map" | "multi_extract";
export interface TaskGuidance { taskKey: string; displayLabel?: string; wordMin?: number; wordMax?: number; prepSeconds?: number; responseSeconds?: number }
export interface PartSpecification { key: string; count: number; types: string[]; rawMax?: number; options?: number; wordMin?: number; wordMax?: number }
export type MockSkill = "listening" | "reading" | "writing" | "speaking";
export type MockQuestionType =
  | "multiple_choice"
  | "multi_select"
  | "true_false_notgiven"
  | "yes_no_notgiven"
  | "matching"
  | "matching_headings"
  | "sentence_completion"
  | "note_completion"
  | "summary_completion"
  | "table_completion"
  | "short_answer"
  | "map_labelling"
  | "essay_task1"
  | "essay_task2"
  | "speaking_task";
export type MockAttemptStatus = "in_progress" | "grading" | "completed";
export type MockAttemptMode = "practice" | "timed";
export type MockAccess = "granted" | "pending" | "locked";

/** Latest AI JSON import for an exam (null = created manually). */
export interface MockExamImportRef {
  packageId: string;
  revision: number;
  importedAt: string;
}

/** GET /mock/exams */
export interface MockExamListItem {
  id: string;
  type: MockExamType;
  profile?: string;
  title: string;
  description: string | null;
  level: string | null;
  practiceLevel?: PracticeLevel | null;
  isDemo: boolean;
  isPublished: boolean;
  /** Server-authoritative start readiness. */
  ready?: boolean;
  canEdit: boolean;
  skills: MockSkill[];
  questionCount: number;
  durationMinutes: number | null;
  price: number;
  access: MockAccess;
  imported: MockExamImportRef | null;
}

/** Runner savoli — o'quvchiga to'g'ri javobsiz; xodimga `correctAnswers` qo'shiladi */
export interface MockQuestion {
  id: string;
  number: number;
  sortOrder: number;
  type: MockQuestionType;
  prompt: string;
  options: string[] | null;
  points: number;
  wordLimit: number | null;
  answerRule?: ObjectiveAnswerRule | null;
  guidance?: TaskGuidance;
  correctAnswers?: string[] | null;
  acceptedVariants?: string[] | null;
}

export interface MockGroup {
  id: string;
  sortOrder: number;
  title: string | null;
  instructions: string | null;
  passageText: string | null;
  contentHtml: string | null;
  contentLayout: string | null;
  optionsReusable?: boolean | null;
  /** Staff authoring responses only; omitted from student-shaped exams. */
  audioScript?: string | null;
  hasAudio: boolean;
  audioUrl: string | null;
  imageUrl: string | null;
  /** Staff-only semantic Multilevel task/part cap. */
  maxScore?: number | null;
  /** Staff-only shared Multilevel source relationship. */
  stimulusRef?: string | null;
  partNumber: number | null;
  audioDurationSec: number | null;
  audioPlayLimit: number;
  questions: MockQuestion[];
}

export interface MockSection {
  id: string;
  skill: MockSkill;
  title: string | null;
  sortOrder: number;
  durationMinutes: number | null;
  instructions: string | null;
  groups: MockGroup[];
}

/** shapeExam natijasi (start javobidagi `exam`) — narx/access YO'Q */
export interface MockExamStructure {
  id: string;
  type: MockExamType;
  specificationVersion?: string;
  specification?: Record<MockSkill, { durationSeconds: number; parts: PartSpecification[] }>;
  /** practice = 1–4 skill, full_mock = strict IELTS blueprint. */
  profile: string;
  title: string;
  description: string | null;
  level: string | null;
  practiceLevel?: PracticeLevel | null;
  isPublished: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optimistic content version (stale-tab save guard). */
  contentVersion: number;
  questionCount: number;
  sections: MockSection[];
}

/** GET /mock/exams/:id */
export interface MockExamDetail extends MockExamStructure {
  /** Server-authoritative start readiness. */
  ready?: boolean;
  price: number;
  isFreeForApproved: boolean;
  access: MockAccess;
}

/** POST /mock/exams/:id/start */
export interface StartMockResult {
  attemptId: string;
  resumed: boolean;
  mode: MockAttemptMode;
  startedAt: string;
  deadlineAt: string | null;
  serverTime: string;
  durationMinutes: number | null;
  flowMode: string;
  currentSkill: MockSkill | null;
  sectionDeadlines: Partial<Record<string, string>> | null;
  overallDeadlineAt: string | null;
  exam: MockExamStructure;
  annotations: unknown[];
  savedAnswers: Record<string, string>;
}

export interface MockSectionScore {
  score: number;
  max: number;
}

export interface MockAttemptSummary {
  id: string;
  examId: string;
  examTitle?: string;
  examType?: MockExamType;
  studentId: string;
  studentName?: string;
  status: MockAttemptStatus;
  mode: MockAttemptMode;
  deadlineAt: string | null;
  flowMode: string;
  currentSkill: MockSkill | null;
  sectionDeadlines: Partial<Record<string, string>> | null;
  overallDeadlineAt: string | null;
  rawScores: Record<string, MockSectionScore> | null;
  sectionBands: Record<string, number> | null;
  overallBand: number | null;
  cefrLevel: string | null;
  specificationVersion?: string;
  scoreMethod?: 'ESTIMATED' | 'OFFICIAL_CALIBRATED';
  scoreVersion?: string;
  standardScores?: Record<string, { estimatedStandardScore: number; rawCorrect?: number; questionCount?: number; gradingSource?: string }>;
  overallScore?: number | null;
  serverTime?: string;
  antiCheatCount: number;
  startedAt: string;
  submittedAt: string | null;
  finishedAt: string | null;
}

export interface MockAttemptQuestion {
  id: string;
  number: number;
  type: MockQuestionType;
  prompt: string;
  options: string[] | null;
  points: number;
  wordLimit: number | null;
  answerRule?: ObjectiveAnswerRule | null;
  guidance?: TaskGuidance;
  response: string | null;
  hasAudio: boolean;
  audioUrl: string | null;
  score: number | null;
  isCorrect: boolean | null;
  isGraded: boolean;
  feedback: string | null;
  rubricScores?: Record<string, number> | null;
  correctAnswers?: string[] | null;
}

export interface MockAttemptGroup {
  id: string;
  title: string | null;
  instructions: string | null;
  passageText: string | null;
  contentHtml?: string | null;
  contentLayout?: string | null;
  hasAudio: boolean;
  questions: MockAttemptQuestion[];
}

export interface MockAttemptSection {
  id: string;
  skill: MockSkill;
  title: string | null;
  durationMinutes: number | null;
  instructions: string | null;
  score: number | null;
  max: number | null;
  band: number | null;
  standardScore?: number | null;
  groups: MockAttemptGroup[];
}

export interface MockAttemptDetail extends MockAttemptSummary {
  annotations: unknown[];
  sections: MockAttemptSection[];
  cheatEvents?: { event: string; date: string }[];
}

export interface MockPurchaseItem {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  examId: string;
  examTitle: string;
  amount: number;
  status: PurchaseStatus;
  createdAt: string;
}

/* ── Mock authoring inputs ───────────────────────────────────────────────── */

export interface CreateMockExamInput {
  starterStructure?: boolean;
  profile?: "practice" | "full_mock";
  /** Starter sections are created only for these skills (default: all four). */
  skills?: MockSkill[];
  type: MockExamType;
  title: string;
  description?: string;
  level?: string;
  practiceLevel?: PracticeLevel | null;
  isDemo?: boolean;
  price?: number;
  isFreeForApproved?: boolean;
}

export interface UpdateMockExamInput {
  title?: string;
  description?: string;
  level?: string;
  practiceLevel?: PracticeLevel | null;
  isPublished?: boolean;
  isDemo?: boolean;
  price?: number;
  isFreeForApproved?: boolean;
}

export interface CreateMockSectionInput {
  skill: MockSkill;
  title?: string;
  sortOrder?: number;
  durationMinutes?: number;
  instructions?: string;
}

export interface MockGroupInput {
  maxScore?: number;
  stimulusRef?: string;
  sortOrder?: number;
  title?: string;
  instructions?: string;
  passageText?: string;
  contentHtml?: string;
  audioScript?: string;
  contentLayout?: MockContentLayout;
  optionsReusable?: boolean | null;
  partNumber?: number;
  audioDurationSec?: number;
  audioPlayLimit?: number;
}

export interface MockQuestionInput {
  number: number;
  sortOrder?: number;
  type: MockQuestionType;
  prompt: string;
  options?: string[];
  correctAnswers?: string[];
  acceptedVariants?: string[];
  points?: number;
  wordLimit?: number;
  answerRule?: ObjectiveAnswerRule | null;
}

/* ── AI JSON import (POST /mock/exam-imports/*) ─────────────────────────── */

export interface MockImportIssue {
  code: string;
  path: string;
  message: string;
  blocks: Array<"import" | "publish">;
  sourceKey?: string;
}

export interface MockImportReport {
  checksum: string;
  issues: MockImportIssue[];
  counts: { sections: number; skills: number; groups: number; questions: number; media: number };
  canImport: boolean;
  canPublish: boolean;
  sanitizerNotes: Array<{ path: string; changed: boolean }>;
  truncated: boolean;
  totalIssues: number;
}

export interface MockStagedUpload {
  uploadId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  kind: string;
  expiresAt: string;
}

export interface MockImportCommit {
  examId: string;
  importId: string;
  revision: number;
  replay: boolean;
  addedToExisting: boolean;
  editorUrl: string;
}

/** GET /mock/exam-imports/by-exam/:examId — staff-only provenance, no answer keys. */
export interface MockImportProvenanceIssue {
  id: string;
  code: string;
  path: string;
  message: string;
  sourceKey: string | null;
  entityKind: string | null;
  status: string;
}

export interface MockImportSourceMap {
  kind: string;
  sourceKey: string;
  entityId: string;
}

export interface MockExamImportProvenance {
  packageId: string;
  revision: number;
  profile: string;
  importedAt: string;
  openIssues: number;
  issues: MockImportProvenanceIssue[];
  sourceMaps: MockImportSourceMap[];
}
