// Read-only inventory from the currently built, active NestJS controllers.
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../backend');
const ref = createRequire(path.join(root, 'package.json'));
ref('reflect-metadata');
const {RequestMethod} = ref('@nestjs/common');
const controllers = [
  ref(path.join(root, 'dist/mock/mock.controller.js')).MockController,
  ref(path.join(root, 'dist/mock/mock-exam-import.controller.js')).MockExamImportController,
];
const rows = [];
for (const controller of controllers) {
  const prefix = Reflect.getMetadata('path', controller);
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    if (name === 'constructor') continue;
    const handler = controller.prototype[name];
    const route = Reflect.getMetadata('path', handler);
    const method = Reflect.getMetadata('method', handler);
    if (route === undefined || method === undefined) continue;
    if (prefix === 'mock' && !/^(exams(?:$|\/[^/]+(?:$|\/(?:clone|readiness|multilevel-repair-inspection|apply-multilevel-safe-repair|clone-corrected-multilevel|repair-multilevel|preview|sections)$))|groups\/|sections\/|questions\/|parse-questions$)/.test(route)) continue;
    rows.push({method: RequestMethod[method], path: `/v1/${prefix}/${route}`.replace(/\/+$/, ''),
      roles: Reflect.getMetadata('roles', handler) ?? null,
      optionalAuth: Reflect.getMetadata('optionalAuth', handler) === true,
      successStatus: Reflect.getMetadata('__httpCode__', handler) ?? (method === RequestMethod.POST ? 201 : 200),
      handler: name,
      alternateSuccessStatus: name === 'commit' ? [200] : ['audio', 'image'].includes(name) ? [206] : [],
    });
  }
}
process.stdout.write(JSON.stringify({count: rows.length, endpoints: rows}, null, 2));
