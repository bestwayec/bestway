// Local-only parse API harness. Uses the real controller/service, DTO validation,
// roles guard, exception filter and envelope. Authentication identities are injected
// equally on both sides; JWT authentication and all other routes are out of scope.
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../backend');
const ref = createRequire(path.join(root, 'package.json'));
ref('reflect-metadata');
const {Module, ValidationPipe} = ref('@nestjs/common');
const {NestFactory, Reflector} = ref('@nestjs/core');
const load = p => ref(path.join(root, 'dist', p));
const {MockController} = load('mock/mock.controller.js');
const {MockAuthoringService} = load('mock/mock-authoring.service.js');
const {RolesGuard} = load('common/roles.guard.js');
const {AllExceptionsFilter} = load('common/all-exceptions.filter.js');
const {TransformInterceptor} = load('common/transform.interceptor.js');
const {AppException} = load('common/app.exception.js');
function firstMessage(errors) {
  for (const error of errors) {
    if (error.constraints) return Object.values(error.constraints)[0];
    if (error.children?.length) return firstMessage(error.children);
  }
  return 'Validatsiya xatosi';
}
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const cases = JSON.parse(input);
  const authoring = new MockAuthoringService(undefined, undefined, undefined, undefined, {get: () => undefined}, {});
  const dependencies = Reflect.getMetadata('design:paramtypes', MockController);
  const inaccessible = {};
  class ParseModule {}
  Module({controllers: [MockController], providers: dependencies.map(token => ({
    provide: token, useValue: token === MockAuthoringService ? authoring : inaccessible,
  }))})(ParseModule);
  const app = await NestFactory.create(ParseModule, {logger: false, abortOnError: false});
  app.setGlobalPrefix('v1');
  app.use((req, _res, next) => {
    if (req.path !== '/v1/mock/parse-questions') throw new Error('Out-of-scope route invoked');
    const role = req.headers['x-fixture-role'];
    if (role) req.user = {id: 'fixture-user', role};
    next();
  });
  app.useGlobalGuards(new RolesGuard(new Reflector()));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(new ValidationPipe({whitelist: true, forbidNonWhitelisted: true, transform: true,
    exceptionFactory: errors => new AppException('VALIDATION_ERROR', firstMessage(errors), 400)}));
  try {
    await app.listen(0, '127.0.0.1');
    const port = app.getHttpServer().address().port;
    const results = [];
    for (const item of cases) {
      const headers = {'content-type': 'application/json'};
      if (item.role) headers['x-fixture-role'] = item.role;
      const response = await fetch(`http://127.0.0.1:${port}/v1/mock/parse-questions`, {
        method: 'POST', headers, body: JSON.stringify(item.payload),
      });
      results.push({status: response.status, body: await response.json()});
    }
    process.stdout.write(JSON.stringify(results));
  } finally {await app.close();}
}
main().catch(error => {console.error(error); process.exitCode = 2;});
