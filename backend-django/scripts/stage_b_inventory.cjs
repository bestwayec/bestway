// Active lifecycle and directly used access/result-support contracts only.
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../backend');
const ref = createRequire(path.join(root, 'package.json'));
ref('reflect-metadata');
const {RequestMethod} = ref('@nestjs/common');
const sets = [
  [ref(path.join(root, 'dist/mock/mock.controller.js')).MockController, new Set([
    'listExams', 'getExam', 'start', 'myAttempts', 'getAttempt', 'saveAnswer', 'bulkAnswers',
    'prepareListening', 'playListening', 'startSpeaking', 'uploadSpeaking', 'speakingAudio',
    'saveAnnotations', 'flagCheat', 'submit', 'advance', 'audio', 'image', 'purchase',
    'forceSubmit', 'extend', 'reopen', 'deleteAttempt', 'listAttempts', 'listPurchases',
    'confirmPurchase', 'rejectPurchase', 'certificate'])],
  [ref(path.join(root, 'dist/tests/tests.controller.js')).TestsController, new Set([
    'list', 'listDemo', 'getDemo', 'submitDemo', 'getOne', 'start', 'myAttempts', 'getAttempt',
    'answer', 'saveMarks', 'flagCheat', 'submit', 'questionAudio', 'listAttempts', 'certificate'])],
];
const endpoints = [];
for (const [controller, selected] of sets) {
  const prefix = Reflect.getMetadata('path', controller);
  for (const name of selected) {
    const handler = controller.prototype[name];
    if (!handler) throw new Error(`Missing reference handler ${prefix}.${name}`);
    const route = Reflect.getMetadata('path', handler);
    const method = Reflect.getMetadata('method', handler);
    endpoints.push({method: RequestMethod[method], path: `/v1/${prefix}/${route}`.replace(/\/+$/, ''),
      handler: name, roles: Reflect.getMetadata('roles', handler) ?? null,
      optionalAuth: Reflect.getMetadata('optionalAuth', handler) === true,
      public: Reflect.getMetadata('isPublic', handler) === true,
      successStatus: Reflect.getMetadata('__httpCode__', handler) ?? (method === RequestMethod.POST ? 201 : 200)});
  }
}
process.stdout.write(JSON.stringify({count: endpoints.length, endpoints}, null, 2));
