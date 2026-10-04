import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser, OptionalAuth, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import {
  AddQuestionsDto,
  SaveGroupContentDto,
  BulkAnswersDto,
  ConfirmPurchaseDto,
  CreateGroupDto,
  CreateMockExamDto,
  CreateSectionDto,
  ExtendDeadlineDto,
  FlagCheatDto,
  GradeMockAnswerDto,
  ImportQuestionsDto,
  ListAttemptsQueryDto,
  ListExamsQueryDto,
  ListPurchasesQueryDto,
  ParseQuestionsDto,
  SaveAnnotationsDto,
  SaveAnswerDto,
  StartAttemptDto,
  SubmitMockAttemptDto,
  UpdateGroupDto,
  UpdateMockExamDto,
  UpdateQuestionDto,
  UpdateSectionDto,
} from './dto/mock.dto';
import { MockAccessService } from './mock-access.service';
import { MockAttemptService } from './mock-attempt.service';
import { MockAuthoringService } from './mock-authoring.service';
import { MockCertificateService } from './mock-certificate.service';
import { MockGradingService } from './mock-grading.service';
import { mockMediaMulterOptions, speakingAudioMulterOptions } from './mock-storage';
import { AssessmentService } from '../assessment/assessment.service';

// Diqqat: aniq marshrutlar (attempts/mine, groups/..., sections/..., purchases) ':id' dan OLDIN.
@ApiTags('mock')
@Controller('mock')
export class MockController {
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Put('groups/:groupId/content')
  saveGroupContent(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Body() dto: SaveGroupContentDto,
  ) {
    return this.authoring.saveGroupContent(user, groupId, dto);
  }

  constructor(
    private readonly authoring: MockAuthoringService,
    private readonly attempts: MockAttemptService,
    private readonly grading: MockGradingService,
    private readonly certificates: MockCertificateService,
    private readonly access: MockAccessService,
    private readonly assessment: AssessmentService,
  ) {}

  // ───────────── Exams ro'yxati / yaratish ─────────────

  /** Mock imtihonlar ro'yxati — kirish holati (access) va narx bilan */
  @OptionalAuth()
  @Get('exams')
  listExams(@CurrentUser() user: AuthUser | undefined, @Query() q: ListExamsQueryDto) {
    return this.authoring.listExams(user, q);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('exams')
  createExam(@CurrentUser() user: AuthUser, @Body() dto: CreateMockExamDto) {
    return this.authoring.createExam(user, dto);
  }

  // ───────────── Savol parse (paste) ─────────────

  /** Yopishtirilgan matnni savollarga ajratib beradi (preview, bazaga yozmaydi) */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('parse-questions')
  parseQuestions(@Body() dto: ParseQuestionsDto) {
    return this.authoring.parsePreview(dto.text);
  }

  // ───────────── Xaridlar (pullik kirish) ─────────────

  /** Admin: xaridlar ro'yxati (tasdiqlash paneli): ?status=pending_confirmation */
  @ApiBearerAuth()
  @Roles('admin', 'super_admin')
  @Get('purchases')
  listPurchases(@Query() q: ListPurchasesQueryDto) {
    return this.access.listPurchases(q);
  }

  // ───────────── Attempts (aniq marshrutlar avval) ─────────────

  /** O'qituvchi/admin baholash navbati: ?status=grading */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Get('attempts')
  listAttempts(@CurrentUser() user: AuthUser, @Query() q: ListAttemptsQueryDto) {
    return this.grading.listAttempts(user, q);
  }

  /** O'quvchining o'z urinishlari */
  @ApiBearerAuth()
  @Roles('student')
  @Get('attempts/mine')
  myAttempts(@CurrentUser() user: AuthUser, @Query() q: ListAttemptsQueryDto) {
    return this.grading.myAttempts(user, q);
  }

  /** Urinish tafsiloti (javoblar + band bilan) */
  @ApiBearerAuth()
  @Get('attempts/:attemptId')
  getAttempt(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.grading.getAttempt(user, attemptId);
  }

  @ApiBearerAuth()
  @Roles('student')
  @Post('attempts/:attemptId/answer')
  saveAnswer(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnswerDto,
  ) {
    return this.attempts.saveAnswer(user, attemptId, dto);
  }

  @Roles('student') @Post('attempts/:attemptId/listening/:groupId/prepare')
  prepareListening(@CurrentUser() user: AuthUser, @Param('attemptId') id: string, @Param('groupId') groupId: string) { return this.attempts.startMediaPhase(user, id, groupId, 'listening'); }
  @Roles('student') @Post('attempts/:attemptId/listening/:groupId/play')
  playListening(@CurrentUser() user: AuthUser, @Param('attemptId') id: string, @Param('groupId') groupId: string) { return this.attempts.startMediaPhase(user, id, groupId, 'listening', true); }
  @Roles('student') @Post('attempts/:attemptId/speaking/:questionId/start')
  startSpeaking(@CurrentUser() user: AuthUser, @Param('attemptId') id: string, @Param('questionId') qid: string) { return this.attempts.startMediaPhase(user, id, qid, 'speaking'); }

  @ApiBearerAuth()
  @Roles('student')
  @Post('attempts/:attemptId/answers')
  bulkAnswers(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto: BulkAnswersDto,
  ) {
    return this.attempts.bulkAnswers(user, attemptId, dto);
  }

  /** Speaking audio javobini yuklash (multipart: audio) */
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles('student')
  @Post('attempts/:attemptId/speaking/:questionId')
  @UseInterceptors(FileInterceptor('audio', speakingAudioMulterOptions()))
  uploadSpeaking(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attempts.uploadSpeaking(user, attemptId, questionId, file);
  }

  /** Speaking javob audiosini oqim qilib olish (baholash uchun; egasi yoki xodim) */
  @ApiBearerAuth()
  @Get('attempts/:attemptId/answers/:questionId/audio')
  speakingAudio(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.grading.streamSpeakingAudio(user, attemptId, questionId, req, res);
  }

  /** Highlight / eslatmalarni saqlash */
  @ApiBearerAuth()
  @Roles('student')
  @Put('attempts/:attemptId/annotations')
  saveAnnotations(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnnotationsDto,
  ) {
    return this.attempts.saveAnnotations(user, attemptId, dto);
  }

  @ApiBearerAuth()
  @Roles('student')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('attempts/:attemptId/flag-cheat')
  flagCheat(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto: FlagCheatDto,
  ) {
    return this.attempts.flagCheat(user, attemptId, dto);
  }

  @ApiBearerAuth()
  @Roles('student')
  @Post('attempts/:attemptId/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto?: SubmitMockAttemptDto,
  ) {
    return this.grading.submit(user, attemptId, dto?.skills).then(async (result) => {
      await this.assessment.enqueue(attemptId, dto?.skills);
      return result;
    });
  }

  /** Xodim: qotib qolgan urinishni majburan yakunlash */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('attempts/:attemptId/force-submit')
  forceSubmit(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.grading.forceSubmit(user, attemptId).then(async (result) => {
      await this.assessment.enqueue(attemptId);
      return result;
    });
  }

  /** Xodim: deadline uzaytirish (+minutes barcha muddatlarga) */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('attempts/:attemptId/extend')
  extend(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string, @Body() dto: ExtendDeadlineDto) {
    return this.grading.extendDeadline(user, attemptId, dto.minutes);
  }

  /** Xodim: baholanayotgan urinishni qayta ochish */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('attempts/:attemptId/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.grading.reopen(user, attemptId);
  }

  /** Admin: urinishni to'liq o'chirish */
  @ApiBearerAuth()
  @Roles('admin', 'super_admin')
  @Delete('attempts/:attemptId')
  deleteAttempt(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.grading.deleteAttempt(user, attemptId);
  }

  /** Full-test: joriy bo'limni yakunlab keyingisiga o'tish (L→R→W, orqaga yo'q) */
  @ApiBearerAuth()
  @Roles('student')
  @Post('attempts/:attemptId/advance')
  advance(@CurrentUser() user: AuthUser, @Param('attemptId') attemptId: string) {
    return this.attempts.advanceSection(user, attemptId);
  }

  /** Writing/Speaking qo'lda baholash */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('attempts/:attemptId/grade')
  grade(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Body() dto: GradeMockAnswerDto,
  ) {
    return this.grading.grade(user, attemptId, dto);
  }

  /** Natija sertifikati (PDF) */
  @ApiBearerAuth()
  @Get('attempts/:attemptId/certificate')
  async certificate(
    @CurrentUser() user: AuthUser,
    @Param('attemptId') attemptId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const data = await this.grading.certificateData(user, attemptId);
    const pdf = await this.certificates.generate(data);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="mock-${attemptId}.pdf"`,
    });
    return new StreamableFile(pdf);
  }

  // ───────────── Groups (media, savollar) ─────────────

  /** Listening audio oqimi (Range; demo bo'lmasa auth kerak; exam da attemptId bilan once-only) */
  @OptionalAuth()
  @Get('groups/:groupId/audio')
  async audio(
    @CurrentUser() user: AuthUser | undefined,
    @Param('groupId') groupId: string,
    @Query('attemptId') attemptId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Exam strict (qaror #4): bir marta eshitish — stream dan oldin hisoblagich.
    if (attemptId && user) {
      await this.attempts.recordAudioPlay(user, attemptId, groupId);
    }
    return this.authoring.streamMedia(user, groupId, 'audio', req, res);
  }

  /** Map/diagram rasmi */
  @OptionalAuth()
  @Get('groups/:groupId/image')
  image(
    @CurrentUser() user: AuthUser | undefined,
    @Param('groupId') groupId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.authoring.streamMedia(user, groupId, 'image', req, res);
  }

  /** Audio/rasm yuklash (multipart: audio?, image?) */
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles('teacher', 'admin', 'super_admin')
  @Post('groups/:groupId/media')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'audio', maxCount: 1 },
        { name: 'image', maxCount: 1 },
      ],
      mockMediaMulterOptions(),
    ),
  )
  setGroupMedia(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @UploadedFiles() files: { audio?: Express.Multer.File[]; image?: Express.Multer.File[] },
  ) {
    return this.authoring.setGroupMedia(user, groupId, files ?? {});
  }

  /** Yopishtirilgan matn + javob kaliti (raqam bo'yicha) → savollarni qo'shadi */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('groups/:groupId/questions/import')
  importQuestions(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Body() dto: ImportQuestionsDto,
  ) {
    return this.authoring.importQuestions(user, groupId, dto);
  }

  /** Blokka savol(lar) qo'shish — bir so'rovda bir nechta (javob kaliti bilan) */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('groups/:groupId/questions')
  addQuestions(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Body() dto: AddQuestionsDto,
  ) {
    return this.authoring.addQuestions(user, groupId, dto);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Patch('groups/:groupId')
  updateGroup(
    @CurrentUser() user: AuthUser,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.authoring.updateGroup(user, groupId, dto);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Delete('groups/:groupId')
  deleteGroup(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    return this.authoring.deleteGroup(user, groupId);
  }

  // ───────────── Sections ─────────────

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('sections/:sectionId/groups')
  createGroup(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.authoring.createGroup(user, sectionId, dto);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Patch('sections/:sectionId')
  updateSection(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateSectionDto,
  ) {
    return this.authoring.updateSection(user, sectionId, dto);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Delete('sections/:sectionId')
  deleteSection(@CurrentUser() user: AuthUser, @Param('sectionId') sectionId: string) {
    return this.authoring.deleteSection(user, sectionId);
  }

  // ───────────── Questions ─────────────

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Patch('questions/:questionId')
  updateQuestion(
    @CurrentUser() user: AuthUser,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.authoring.updateQuestion(user, questionId, dto);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Delete('questions/:questionId')
  deleteQuestion(@CurrentUser() user: AuthUser, @Param('questionId') questionId: string) {
    return this.authoring.deleteQuestion(user, questionId);
  }

  // ───────────── Exam (':id' bilan — oxirida) ─────────────

  /** Imtihon tafsiloti (xodimlar javoblar bilan; o'quvchi javobsiz) + access/price */
  @OptionalAuth()
  @Get('exams/:id')
  getExam(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    return this.authoring.getExam(user, id);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Patch('exams/:id')
  updateExam(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMockExamDto,
  ) {
    return this.authoring.updateExam(user, id, dto);
  }

  @ApiBearerAuth()
  @Roles('super_admin')
  @Delete('exams/:id')
  deleteExam(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.authoring.deleteExam(user, id);
  }

  /** Imtihonni nusxalash — o'z qoralama nusxangni yaratadi (media siz) */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('exams/:id/clone')
  cloneExam(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.authoring.cloneExam(user, id);
  }

  /** Nashr-readiness checklist (kamchiliklar ro'yxati, bloklamaydi) */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Get('exams/:id/readiness')
  readiness(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.authoring.readiness(user, id);
  }

  /** Student-preview — o'quvchi ko'radigan holat (kalitsiz) */
  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Get('exams/:id/preview')
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.authoring.preview(user, id);
  }

  @ApiBearerAuth()
  @Roles('teacher', 'admin', 'super_admin')
  @Post('exams/:id/sections')
  createSection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSectionDto,
  ) {
    return this.authoring.createSection(user, id, dto);
  }

  /** O'quvchi sotib olish so'rovi qoldiradi (admin keyin tasdiqlaydi) */
  @ApiBearerAuth()
  @Roles('student')
  @Post('exams/:id/purchase')
  purchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.access.purchase(user, id);
  }

  /** Admin xaridni qo'lda tasdiqlaydi */
  @ApiBearerAuth()
  @Roles('admin', 'super_admin')
  @Post('exams/:id/confirm-purchase')
  confirmPurchase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseDto,
  ) {
    return this.access.confirmPurchase(user, id, dto.userId);
  }

  /** Admin xarid so'rovini rad etadi */
  @ApiBearerAuth()
  @Roles('admin', 'super_admin')
  @Post('exams/:id/reject-purchase')
  rejectPurchase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseDto,
  ) {
    return this.access.rejectPurchase(user, id, dto.userId);
  }

  /** Imtihonni boshlash — rejim (practice/timed) bilan */
  @ApiBearerAuth()
  @Roles('student')
  @Post('exams/:id/start')
  start(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: StartAttemptDto,
  ) {
    return this.attempts.start(user, id, dto);
  }
}
