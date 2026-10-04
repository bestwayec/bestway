import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ExamProgram } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { CurrentUser, Roles } from './decorators';
import { AuthUser } from './types';
import { ExamProgramService } from './exam-program.service';

class SelectProgramDto {
  @IsEnum(ExamProgram) program: ExamProgram;
}
class EnrollProgramsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(2) @IsEnum(ExamProgram, { each: true }) availablePrograms: ExamProgram[];
  @IsOptional() @IsEnum(ExamProgram) activeProgram?: ExamProgram;
}
@Controller('exam-programs')
export class ExamProgramController {
  constructor(private readonly programs: ExamProgramService) {}
  @Roles('student') @Get('mine') mine(@CurrentUser() user: AuthUser) { return this.programs.state(user.id); }
  @Roles('student') @Patch('mine') select(@CurrentUser() user: AuthUser, @Body() dto: SelectProgramDto) { return this.programs.select(user.id, dto.program); }
  @Roles('teacher', 'admin', 'super_admin') @Get('students/:id') state(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.programs.managedState(user, id); }
  @Roles('teacher', 'admin', 'super_admin') @Put('students/:id') enroll(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EnrollProgramsDto) {
    return this.programs.enroll(user, id, dto.availablePrograms, dto.activeProgram);
  }
}
