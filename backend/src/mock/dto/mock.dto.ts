import {
  MockAttemptMode,
  AssessmentPolicyMode,
  ExamProgram,
  MockAttemptStatus,
  MockExamType,
  MockQuestionType,
  MockSkill,
  PurchaseStatus,
  PracticeLevel,
} from '@prisma/client';
import { OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';
import { MOCK_CONTENT_LAYOUTS } from '../mock-content';
import { ANSWER_RULES } from '../question-engine';

/* ─────────────────────────── Exam ─────────────────────────── */

export class CreateMockExamDto {
  @IsOptional()
  @IsEnum(PracticeLevel)
  practiceLevel?: PracticeLevel;
  @IsOptional()
  @IsEnum(AssessmentPolicyMode)
  assessmentPolicy?: AssessmentPolicyMode;
  @IsOptional()
  @IsBoolean()
  starterStructure?: boolean;

  /** practice = 1–4 skill (single-skill allowed); full_mock = strict IELTS blueprint. */
  @IsOptional()
  @IsIn(['practice', 'full_mock'])
  profile?: string;

  /** Starter sectionlar shu skilllar uchun yaratiladi (berilmasa barchasi). */
  @IsOptional()
  @IsArray()
  @IsEnum(MockSkill, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  skills?: MockSkill[];

  @IsEnum(MockExamType)
  type: MockExamType;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;

  /** Narx (so'mda); 0 = bepul */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isFreeForApproved?: boolean;
}

export class UpdateMockExamDto {
  @IsOptional()
  @IsEnum(PracticeLevel)
  practiceLevel?: PracticeLevel | null;
  @IsOptional()
  @IsEnum(AssessmentPolicyMode)
  assessmentPolicy?: AssessmentPolicyMode;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['practice', 'full_mock'])
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsBoolean()
  isFreeForApproved?: boolean;
}

export class ListExamsQueryDto {
  @IsOptional()
  @IsEnum(ExamProgram)
  program?: ExamProgram;

  @IsOptional()
  @IsEnum(PracticeLevel)
  practiceLevel?: PracticeLevel;
  @IsOptional()
  @IsEnum(MockExamType)
  type?: MockExamType;
}

/* ─────────────────────────── Section ─────────────────────────── */

export class CreateSectionDto {
  @IsEnum(MockSkill)
  skill: MockSkill;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

/* ─────────────────────────── Group (passage/audio blok) ─────────────────────────── */

export class CreateGroupDto {
  @IsOptional()
  @IsBoolean()
  optionsReusable?: boolean | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  /** Reading matni yoki Listening transkripti */
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  passageText?: string;

  /** Sanitized rich document. Gap tokens use <span data-gap="N"></span>. */
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  contentHtml?: string;

  /** Staff-only transcript/review material. */
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  audioScript?: string;

  @IsOptional()
  @IsString()
  @IsIn(MOCK_CONTENT_LAYOUTS)
  contentLayout?: string;

  /** Listening part raqami (1..4) — full-test L→R→W tartibi uchun */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  partNumber?: number;

  /** Audio davomiyligi (sekund) — full-test deadline = duration + 120s review */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7200)
  audioDurationSec?: number;

  /** Exam rejimda audio necha marta eshitiladi (practice da cheksiz) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  audioPlayLimit?: number;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsBoolean()
  optionsReusable?: boolean | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  passageText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  contentHtml?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  audioScript?: string;

  @IsOptional()
  @IsString()
  @IsIn(MOCK_CONTENT_LAYOUTS)
  contentLayout?: string;

  /** Listening part raqami (1..4) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  partNumber?: number;

  /** Audio davomiyligi (sekund) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7200)
  audioDurationSec?: number;

  /** Exam rejimda audio necha marta eshitiladi */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  audioPlayLimit?: number;
}

/* ─────────────────────────── Question ─────────────────────────── */

export class QuestionInputDto {
  @IsOptional()
  @IsIn(ANSWER_RULES)
  answerRule?: 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER' | null;
  /** Imtihondagi savol raqami (1..40) */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  number: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsEnum(MockQuestionType)
  type: MockQuestionType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  prompt: string;

  /** multiple_choice / matching uchun variantlar */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(26)
  options?: string[];

  /** Qabul qilinadigan to'g'ri javob(lar) — auto-baholanadigan savollar uchun */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  correctAnswers?: string[];

  /** Qo'shimcha to'g'ri shakllar (British/American imlo va b.) — grading da ham qabul qilinadi */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  acceptedVariants?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  points?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  wordLimit?: number;
}

/** Bitta so'rovda bir nechta savol qo'shish (kuchli javob-kaliti kiritish) */
export class AddQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => QuestionInputDto)
  questions: QuestionInputDto[];
}

export class SaveGroupQuestionDto extends OmitType(QuestionInputDto, ['prompt'] as const) {
  /** Incomplete drafts may retain a blank prompt; publication validates it. */
  @IsString()
  @MaxLength(5000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  id?: string;
}

/** Save the material and complete question list together, retaining question IDs. */
export class SaveGroupContentDto extends UpdateGroupDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaveGroupQuestionDto)
  questions: SaveGroupQuestionDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  deletedQuestionIds: string[];

  /**
   * Optimistic concurrency: yuklangan MockExam.contentVersion. Mos kelmasa
   * 409 (boshqa tab saqlagan). Berilmasa — tekshirilmaydi (backward compatible).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedContentVersion?: number;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsIn(ANSWER_RULES)
  answerRule?: 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER' | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  number?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(MockQuestionType)
  type?: MockQuestionType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  prompt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(26)
  options?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  correctAnswers?: string[];

  /** Qo'shimcha to'g'ri shakllar (British/American imlo va b.) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  acceptedVariants?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  points?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  wordLimit?: number;
}

/* ─────────────────────────── Attempt oqimi ─────────────────────────── */

export class SaveAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  /** O'quvchi javobi (bo'sh satr = javobni tozalash) */
  @IsString()
  @MaxLength(10000)
  response: string;
}

class AnswerItemDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsString()
  @MaxLength(10000)
  response: string;
}

export class BulkAnswersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AnswerItemDto)
  answers: AnswerItemDto[];
}

export class FlagCheatDto {
  /** Warn-only (qaror #5): tab_switch, blur, paste_attempt, copy_attempt, seek_attempt, rate_attempt */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  event: string;
}

export class ExtendDeadlineDto {
  /** Qo'shimcha daqiqalar (1..180) — barcha muddatlar shuncha siljiydi */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  minutes: number;
}

export class GradeMockAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  /**
   * Writing/Speaking uchun band (0–9) yoki ball (0..points), 0.5 qadam mumkin.
   * Ixtiyoriy: berilmasa va 4 ta rubric to'liq kiritilsa — score rubric
   * o'rtachasidan avtomatik hisoblanadi.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;

  /** Human-grader rubriklari (qaror #3): writing {ta,cc,lr,gra} / speaking {fluency,lexical,grammar,pronunciation} 0..9 */
  @IsOptional()
  @IsObject()
  rubricScores?: Record<string, number>;
}

export class ListAttemptsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ExamProgram)
  program?: ExamProgram;
  @IsOptional()
  @IsEnum(MockAttemptStatus)
  status?: MockAttemptStatus;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  examId?: string;
}

/* ─────────────────────────── Start / rejim ─────────────────────────── */

export class StartAttemptDto {
  /** `practice` (vaqtsiz) yoki `timed` (vaqtli, ekran full). Standart: practice */
  @IsOptional()
  @IsEnum(MockAttemptMode)
  mode?: MockAttemptMode;

  /** `full_test` (L→R→W ketma-ket, teacher exam — strict) yoki `single_skill` (mashq — lenient). Standart: single_skill */
  @IsOptional()
  @IsString()
  flow?: string;
}

/**
 * Submit filtri (masalan desktop section-by-section): faqat berilgan
 * skill'lar baholanadi, status/overall ham shulardan hisoblanadi.
 * Berilmasa — butun urinish (eski xatti).
 */
export class SubmitMockAttemptDto {
  @IsOptional()
  @IsArray()
  @IsEnum(MockSkill, { each: true })
  skills?: MockSkill[];
}

/* ─────────────────────────── Savol parse / import ─────────────────────────── */

export class ParseQuestionsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  text: string;
}

export class ImportQuestionsDto {
  /** Yopishtirilgan savollar matni */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  text: string;

  /** Javob kaliti: { "1": "B", "2": "flowers/flower", "3": "TRUE" } */
  @IsOptional()
  @IsObject()
  answers?: Record<string, string>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  points?: number;
}

/* ─────────────────────────── Xarid (pullik kirish) ─────────────────────────── */

export class ConfirmPurchaseDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class ListPurchasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;
}

/* ─────────────────────────── Highlight / annotatsiya ─────────────────────────── */

export class SaveAnnotationsDto {
  /** Frontend highlight/eslatmalari (ixtiyoriy struktura) */
  @IsOptional()
  @IsArray()
  annotations?: unknown[];
}
