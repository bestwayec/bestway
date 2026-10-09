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
    access.notifications=notifications;
    const {MockCertificateService}=load('mock/mock-certificate.service.js');
    values.set(MockCertificateService,new MockCertificateService(config));
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
  let gameControl;
  if (process.env.VERIFY_FULL_FOUNDATION === '1') {
    const {SettingsService} = load('settings/settings.service.js');
    const {GroupsService} = load('groups/groups.service.js');
    const {AccessService} = load('common/access.service.js');
    const {ArticlesService} = load('articles/articles.service.js');
    const {NotificationsService} = load('notifications/notifications.service.js');
    values.set(PrismaService, prisma);
    values.set(AuditService, audit);
    values.set(SettingsService, new SettingsService(prisma));
    values.set(GroupsService, new GroupsService(prisma, audit, new AccessService(prisma)));
    values.set(ArticlesService, new ArticlesService(prisma, audit));
    values.set(NotificationsService, new NotificationsService(prisma, {send:async()=>{}}));
    const {PaymentsService}=load('payments/payments.service.js');
    values.set(PaymentsService, new PaymentsService(prisma,new AccessService(prisma),audit,values.get(NotificationsService)));
    const {AttendanceService}=load('attendance/attendance.service.js');
    const {ExportService}=load('stats/export.service.js');
    const {StatsService}=load('stats/stats.service.js');
    values.set(AttendanceService,new AttendanceService(prisma,new AccessService(prisma),audit,values.get(NotificationsService)));
    values.set(ExportService,new ExportService(prisma));
    values.set(StatsService,new StatsService(prisma));
    const {GameService}=load('game/game.service.js');
    const {GalleryService}=load('gallery/gallery.service.js');
    const {TeachersService}=load('teachers/teachers.service.js');
    const {UsersService}=load('users/users.service.js');
    const {VideosService}=load('videos/videos.service.js');
    const {StreamTokenService}=load('videos/stream-token.service.js');
    values.set(VideosService,new VideosService(prisma,storage,new StreamTokenService(config),audit,config));
    values.set(GalleryService,new GalleryService(prisma,storage,audit,config));
    values.set(TeachersService,new TeachersService(prisma,storage,audit,config));
    values.set(UsersService,new UsersService(prisma,audit,new AccessService(prisma),values.get(SettingsService)));
    const {TestsService}=load('tests/tests.service.js');
    const {GradingService}=load('tests/grading.service.js');
    const {CertificateService}=load('tests/certificate.service.js');
    values.set(TestsService,new TestsService(prisma,audit,programs));
    values.set(GradingService,new GradingService(prisma,new AccessService(prisma),values.get(NotificationsService),programs));
    values.set(CertificateService,new CertificateService(config));
    const {TelegramService}=load('telegram/telegram.service.js');
    const {TelegramLinkService}=load('telegram/telegram-link.service.js');
    const {TelegramMenuService}=load('telegram/telegram-menu.service.js');
    const {TelegramBotService}=load('telegram/telegram-bot.service.js');
    const telegram=new TelegramService(config), deliveries=[];
    // Real link/menu/bot services with a recording transport, never Telegram API.
    telegram.call=async(method,payload)=>{deliveries.push({method,payload});return method==='getMe'?{username:'fixture_bot'}:true;};
    const links=new TelegramLinkService(prisma,telegram,config,audit);
    const menu=new TelegramMenuService(prisma,telegram);
    const bot=new TelegramBotService(telegram,links,menu,prisma,config);
    bot.onModuleInit=async()=>{};
    values.set(TelegramService,telegram);values.set(TelegramLinkService,links);
    values.set(TelegramMenuService,menu);values.set(TelegramBotService,bot);
    const {PointsService}=load('points/points.service.js');
    const game=new GameService(prisma,values.get(SettingsService),values.get(NotificationsService),audit);
    const startup=game.onModuleInit.bind(game);
    // Initial fixture setup must not silently mutate one side. Exercise the real
    // startup method explicitly through the private stdin lifecycle channel.
    game.onModuleInit=async()=>{};
    values.set(GameService,game);
    values.set(PointsService,new PointsService(prisma,new AccessService(prisma),audit,
      values.get(SettingsService),values.get(NotificationsService),game));
    const pending=new Set();
    const notifications=values.get(NotificationsService);
    let failedNotificationType=null;
    const originalMany=notifications.notifyMany.bind(notifications);
    notifications.notifyMany=(...args)=>failedNotificationType===args[1]
      ?Promise.reject(new Error('Injected local fixture notification failure')):originalMany(...args);
    for(const method of ['notify','notifyParents']) {
      const original=notifications[method].bind(notifications);
      notifications[method]=(...args)=>{
        const promise=original(...args);pending.add(promise);
        promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;
      };
    }
    gameControl=async command=>{
      if(command.action==='telegramDeliveries')return deliveries.splice(0);
      if(command.action==='notificationFailure') {failedNotificationType=command.type??null;return true;}
      if(command.action==='drain') {while(pending.size) await Promise.allSettled([...pending]);return true;}
      if(command.action==='rollover') return game.rolloverStale();
      if(command.action==='startup') {await startup();return null;}
      if(command.action==='monthly') {await game.monthlyReset();return null;}
      if(command.action==='ensure') return prisma.$transaction(tx=>game.ensureCurrentPeriod(tx,command.studentId));
      if(command.action==='qualify') return game.checkAndQualify(command.actorId??null,command.studentId,command.points,command.name);
      throw new Error('Unknown private fixture control');
    };
    controllers.splice(0, controllers.length,
      load('settings/settings.controller.js').SettingsController,
      load('audit/audit.controller.js').AuditController,
      load('groups/groups.controller.js').GroupsController,
      load('articles/articles.controller.js').ArticlesController,
      load('notifications/notifications.controller.js').NotificationsController,
      load('payments/payments.controller.js').PaymentsController,
      load('attendance/attendance.controller.js').AttendanceController,
      load('stats/stats.controller.js').StatsController,
      load('game/game.controller.js').GameController,
      load('points/points.controller.js').PointsController);
    controllers.push(load('gallery/gallery.controller.js').GalleryController,
      load('teachers/teachers.controller.js').TeachersController,load('users/users.controller.js').UsersController,
      load('videos/videos.controller.js').VideosController);
    controllers.push(load('tests/tests.controller.js').TestsController,load('telegram/telegram.controller.js').TelegramController);
  }
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
  if(gameControl) {
    const input=require('node:readline').createInterface({input:process.stdin});let queue=Promise.resolve();
    input.on('line',line=>{queue=queue.then(async()=>{
      if(line==='stop') {await app.close();process.exit(0);}
      try {const result=await gameControl(JSON.parse(line));process.stdout.write('CONTROL '+JSON.stringify({ok:true,result})+'\n');}
      catch {process.stdout.write('CONTROL '+JSON.stringify({ok:false})+'\n');}
    });});
  } else process.stdin.once('data', async () => {await app.close(); process.exit(0);});
})().catch(e => {console.error(e); process.exitCode = 2;});
