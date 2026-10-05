import { AttemptStatus, QuestionType, TestSection, TestType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

export class QueryTestsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['IELTS', 'MULTILEVEL'])
  program?: 'IELTS' | 'MULTILEVEL';
  @IsOptional()
  @IsEnum(TestType)
  type?: TestType;
}

export class DemoSubmitDto {
  /** Guest javoblari: questionId -> answer . Writing bo'sh bo'lishi mumkin. */
  @IsOptional()
  @IsObject()
  answers?: Record<string, string>;
}

export class CreateTestDto {
  @IsEnum(TestType)
  type: TestType;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  /** Masalan "B2", "Academic" */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  /** Mehmonlar ham ko'ra oladigan demo testmi */
  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  /** Bo'lim bo'yicha random tanlanadigan savollar soni: {"listening":10,"reading":10} */
  @IsOptional()
  @IsObject()
  sectionQuestionCounts?: Record<string, number>;
}

export class UpdateTestDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  @IsOptional()
  @IsObject()
  sectionQuestionCounts?: Record<string, number>;
}

export class CreateQuestionDto {
  @IsEnum(TestSection)
  section: TestSection;

  @IsEnum(QuestionType)
  type: QuestionType;

  @IsString()
  @MinLength(3)
  prompt: string;

  /** multiple_choice uchun variantlar */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  /** listening/reading uchun majburiy; bir nechta to'g'ri variant "|" bilan ajratiladi */
  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxScore?: number;

  /** Reading/Survey uzun matn */
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  passageText?: string;

  /** Guruh ko'rsatmasi (masalan "Listen and choose...") */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  /** Audio URL/storage key — odatda POST :questionId/audio orqali yuklanadi */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  audioUrl?: string;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsEnum(TestSection)
  section?: TestSection;

  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsString()
  @MinLength(3)
  prompt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxScore?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  passageText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  audioUrl?: string;
}

export class ImportQuestionsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100000)
  text: string;

  @IsOptional()
  @IsEnum(TestSection)
  defaultSection?: TestSection;
}

export class SubmitAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  /** O'quvchi javobi (bo'sh string = javobni o'chirish) */
  @IsString()
  answer: string;
}

export class FlagCheatDto {
  /** Masalan "tab_switch" — frontend visibilitychange da avtomatik yuboradi */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  event: string;
}

export class SaveMarksDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  /** Reading highlight'lari — passage'dan ajratilgan parchalar (50 tagacha, har biri 300 belgigacha) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  highlights?: string[];

  /** Shaxsiy eslatma (bo'sh string = o'chirish) */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class GradeAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class QueryAttemptsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['IELTS', 'MULTILEVEL'])
  program?: 'IELTS' | 'MULTILEVEL';
  @IsOptional()
  @IsEnum(AttemptStatus)
  status?: AttemptStatus;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  testId?: string;
}
