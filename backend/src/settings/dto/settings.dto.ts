import { IsArray, IsIn, IsOptional, IsInt, Max, Min } from 'class-validator';

export class UpdateExamProgramPolicyDto {
  @IsIn(['SELF_SELECT', 'STAFF_ASSIGNED'])
  accessPolicy: 'SELF_SELECT' | 'STAFF_ASSIGNED';
}

export class UpdateSettingsDto {
  /** O'qituvchi bir amalda qo'sha/ayira oladigan maksimal ball */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  teacherPointLimit?: number;

  /** Yangi o'quvchiga beriladigan boshlang'ich ball */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  initialPoints?: number;

  /** Standart oylik to'lov summasi (so'm) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  monthlyFee?: number;

  /** Oylik o'yinga qo'shilish uchun kerakli chegara ball */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  gameThreshold?: number;
}

/**
 * IELTS xom→band jadvallari (super_admin). Har bir jadval
 * `[[minRaw 0..40, band 0..9 (0.5 qadam)], ...]` — batafsil tekshiruv
 * `parseBandTable` da (service). Berilmagan jadval o'zgarmaydi.
 */
export class UpdateIeltsBandsDto {
  @IsOptional()
  @IsArray()
  listening?: unknown;

  @IsOptional()
  @IsArray()
  readingAcademic?: unknown;

  @IsOptional()
  @IsArray()
  readingGeneral?: unknown;
}
