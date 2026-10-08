// Isolated local Stage A reference server. Never loads AppModule or backend/.env.
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../backend');
const ref = createRequire(path.join(root, 'package.json'));
ref('reflect-metadata');
const {Module, ValidationPipe, UseGuards} = ref('@nestjs/common');
const {NestFactory, Reflector} = ref('@nestjs/core');
const {ConfigService} = ref('@nestjs/config');
const {JwtService} = ref('@nestjs/jwt');
const load = p => ref(path.join(root, 'dist', p));
// Equivalent random storage keys make their derived checksum comparable without
// normalizing checksum semantics. Applied only inside this disposable harness.
let uploadSequence = 0;
require('crypto').randomUUID = () => `00000000-0000-4000-8000-${String(++uploadSequence).padStart(12, '0')}`;
// Deterministic Fisher-Yates draws only in the equivalent legacy test fixture.
require('crypto').randomInt = () => 0;
const {PrismaService} = load('prisma/prisma.service.js');
const {AuditService} = load('audit/audit.service.js');
const {StorageService} = load('videos/storage.service.js');
const {ExamProgramService} = load('common/exam-program.service.js');
const {MockAccessService} = load('mock/mock-access.service.js');
const {MockAuthoringService} = load('mock/mock-authoring.service.js');
const {MockExamImportService} = load('mock/mock-exam-import.service.js');
const {MockController} = load('mock/mock.controller.js');
const {MockExamImportController} = load('mock/mock-exam-import.controller.js');
const {JwtAuthGuard} = load('common/jwt-auth.guard.js');
const {RolesGuard} = load('common/roles.guard.js');
const {AllExceptionsFilter} = load('common/all-exceptions.filter.js');
const {TransformInterceptor} = load('common/transform.interceptor.js');
const {AppException} = load('common/app.exception.js');
function firstMessage(errors) {
  for (const e of errors) {
    if (e.constraints) return Object.values(e.constraints)[0];
    if (e.children?.length) return firstMessage(e.children);
  }
  return 'Validatsiya xatosi';
}
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^stage_a_diff_[a-f0-9]+_nest$/.test(url.searchParams.get('schema') || '')) {
    throw new Error('Refusing non-isolated local database');
  }
  const prisma = new PrismaService();
  const config = new ConfigService(process.env);
  const audit = new AuditService(prisma);
  const storage = new StorageService(config);
  const programs = new ExamProgramService(prisma);
  const inaccessible = new Proxy({}, {get: (_obj, prop) => ['then', 'onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown'].includes(prop) ? undefined : () => {
    throw new Error('Out-of-scope dependency invoked');
  }});
  const access = new MockAccessService(prisma, audit, inaccessible, programs);
  const authoring = new MockAuthoringService(prisma, audit, storage, access, config, programs);
  const imports = new MockExamImportService(prisma, audit);
  const values = new Map([[PrismaService, prisma], [MockAuthoringService, authoring],
    [MockExamImportService, imports], [MockAccessService, access]]);
  // Stage B opts into real lifecycle dependencies, never workers/providers.
  if (process.env.VERIFY_STAGE_B === '1') {
    const {MockAttemptService} = load('mock/mock-attempt.service.js');
    const {MockGradingService} = load('mock/mock-grading.service.js');
    const {AccessService} = load('common/access.service.js');
    const {SettingsService} = load('settings/settings.service.js');
    const {AssessmentService} = load('assessment/assessment.service.js');
    const {NotificationsService} = load('notifications/notifications.service.js');
    const studentAccess = new AccessService(prisma);
    const notifications = new NotificationsService(prisma, {send: async () => {}});
    values.set(AssessmentService, new AssessmentService(prisma, studentAccess, programs, storage, config));
    const {TestsService} = load('tests/tests.service.js');
    const {GradingService} = load('tests/grading.service.js');
    const {CertificateService} = load('tests/certificate.service.js');
    values.set(TestsService, new TestsService(prisma,audit,programs));
    values.set(GradingService, new GradingService(prisma,studentAccess,notifications,programs));
    values.set(CertificateService, new CertificateService(config));
    values.set(MockAttemptService, new MockAttemptService(prisma, access, storage, config));
    values.set(MockGradingService, new MockGradingService(prisma, studentAccess, notifications,
      storage, audit, new SettingsService(prisma, audit), config, programs));
  }
  const controllers = [MockController, MockExamImportController];
  const moduleImports=[], extraProviders=[];
  if (process.env.VERIFY_STAGE_B === '1') controllers.push(load('tests/tests.controller.js').TestsController);
  if (process.env.VERIFY_STAGE_B === '1') {
    const {ThrottlerModule,ThrottlerGuard}=ref('@nestjs/throttler');
    const controller=controllers[controllers.length-1];
    UseGuards(ThrottlerGuard)(controller.prototype,'flagCheat',Object.getOwnPropertyDescriptor(controller.prototype,'flagCheat'));
    moduleImports.push(ThrottlerModule.forRoot([{name:'default',ttl:60000,limit:100000}]));
    extraProviders.push(ThrottlerGuard);
  }
  for (const controller of controllers) {
    for (const token of Reflect.getMetadata('design:paramtypes', controller)) {
      if (!values.has(token)) values.set(token, inaccessible);
    }
  }
  class StageAModule {}
  Module({controllers,imports:moduleImports,
    providers: [...values].map(([provide, useValue]) => ({provide, useValue})).concat(extraProviders)})(StageAModule);
  const app = await NestFactory.create(StageAModule, {logger: false, abortOnError: false, bodyParser: false});
  const express = ref('express');
  app.use(express.json({limit: '3mb', verify: (req, _res, buf) => {req.rawBody = buf;}}));
  app.setGlobalPrefix('v1');
  const reflector = new Reflector();
  app.useGlobalGuards(new JwtAuthGuard(new JwtService({secret: process.env.JWT_SECRET}), prisma, reflector), new RolesGuard(reflector));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(new ValidationPipe({whitelist: true, forbidNonWhitelisted: true, transform: true,
    exceptionFactory: errors => new AppException('VALIDATION_ERROR', firstMessage(errors), 400)}));
  await app.listen(0, '127.0.0.1');
  process.stdout.write(JSON.stringify({port: app.getHttpServer().address().port}) + '\n');
  process.stdin.resume();
  process.stdin.once('data', async () => {await app.close(); process.exit(0);});
})().catch(e => {console.error(e); process.exitCode = 2;});
