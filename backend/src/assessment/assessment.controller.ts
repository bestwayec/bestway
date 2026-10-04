import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { MockGradingService } from '../mock/mock-grading.service';
import { audioContentType, streamFileRange } from '../mock/mock-storage';
import { StorageService } from '../videos/storage.service';
import { ReviewAssessmentDto } from './assessment.dto';
import { AssessmentService } from './assessment.service';

@Controller('assessment')
export class AssessmentController {
  constructor(private readonly service: AssessmentService, private readonly grading: MockGradingService, private readonly storage: StorageService) {}

  @Get('attempts/:attemptId')
  get(@CurrentUser() viewer: AuthUser, @Param('attemptId') attemptId: string) { return this.service.forAttempt(viewer, attemptId); }

  @Roles('teacher', 'admin', 'super_admin')
  @Post('jobs/:jobId/review')
  review(@CurrentUser() actor: AuthUser, @Param('jobId') jobId: string, @Body() dto: ReviewAssessmentDto) { return this.service.review(actor, jobId, dto, (tx, id) => this.grading.recompute(tx, id)); }

  @Get('jobs/:jobId/audio/:questionId')
  async audio(@CurrentUser() viewer: AuthUser, @Param('jobId') jobId: string, @Param('questionId') questionId: string, @Req() req: Request, @Res() res: Response) {
    const key = await this.service.authorizedAudio(viewer, jobId, questionId);
    streamFileRange(this.storage, key, audioContentType(key), req, res);
  }
}
