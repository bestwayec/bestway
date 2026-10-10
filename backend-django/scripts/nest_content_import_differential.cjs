// Read-only reference: pure validators/sanitizer, no database or external services.
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../backend');
const ref = createRequire(path.join(root, 'package.json'));
const content = ref(path.join(root, 'dist/mock/mock-content.js'));
const imports = ref(path.join(root, 'dist/mock/mock-import-validate.js'));
(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const cases = JSON.parse(input);
  const results = cases.map(c => {
    try {
      return {value: c.kind === 'html' ? content.sanitizeMockContent(c.value)
        : imports.validateImportPackage(c.value, c.options || {})};
    } catch (e) { return {error: String(e.message)}; }
  });
  process.stdout.write(JSON.stringify(results));
})().catch(e => {console.error(e); process.exitCode = 2;});
