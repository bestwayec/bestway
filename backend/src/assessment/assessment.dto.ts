import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { AssessmentResult } from './contracts';

export class ReviewPartDto {
  @IsString() @IsNotEmpty() @MaxLength(100) id: string;
  // Numeric/rubric validation is program-specific and occurs in the domain.
  @IsOptional() rawScore?: number;
  @IsOptional() @IsObject() criteria?: Record<string, number>;
}

export class ReviewAssessmentDto {
  @IsIn(['ACCEPT', 'OVERRIDE', 'EDIT_FEEDBACK', 'REGRADE', 'NEEDS_REVIEW']) action: 'ACCEPT' | 'OVERRIDE' | 'EDIT_FEEDBACK' | 'REGRADE' | 'NEEDS_REVIEW';
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsString() @IsNotEmpty() @MaxLength(2000) reason: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ReviewPartDto) parts?: ReviewPartDto[];
  @IsOptional() @IsObject() feedback?: AssessmentResult;
}
