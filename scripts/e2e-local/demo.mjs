// BESTWAY local browser check of the public demo test page (Playwright, real Chromium, as a guest).
// Loopback only. Creates one synthetic demo test in the local database first:
//   BW_WEB=http://localhost:3300 BW_PYTHON=<venv python> node demo.mjs
// Checks: the page source and Next data carry no answer key, no placeholder audio or transcript,
// the answers are checked by the server and only the server's auto-checked score is shown.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(WEB).hostname)) {
  console.error(`Refusing to run against non-loopback host: ${WEB}`);
  process.exit(2);
}
const backend = join(here, "..", "..", "backend-django");
const SEED = `
import os, sys, uuid
sys.path.insert(0, '.')
import django; django.setup()
from django.conf import settings
db = settings.DATABASES['default']
assert db['HOST'] in ('127.0.0.1', 'localhost', '::1') and db['NAME'].endswith('_local'), 'local *_local database only'
from django.utils import timezone
from apps.legacy_schema.models import Test, Question
now = timezone.now(); tid = 'e2e-demo-' + uuid.uuid4().hex[:8]
Test.objects.create(id=tid, type='ielts', title='E2E Demo test', level=None, is_demo=True, is_active=True, duration_minutes=5, section_question_counts=None, created_at=now)
rows = [('reading', 'multiple_choice', 'Which colour is the sky on a clear day?', ['green', 'blue', 'red'], 'blue'),
        ('reading', 'short_answer', 'Write the number of days in a week.', None, 'seven'),
        ('writing', 'essay', 'Write two sentences about your town.', None, None)]
for n, (section, kind, prompt, options, key) in enumerate(rows):
    Question.objects.create(id=f'{tid}-q{n}', test_id=tid, section=section, type=kind, prompt=prompt, options=options, correct_answer=key,
        max_score=1, audio_url=None, passage_text='A short passage for the demo.' if n == 0 else None, instructions=None, created_at=now)
print(tid)
`;
const TID = execFileSync(process.env.BW_PYTHON || "python", ["-c", SEED], { cwd: backend, encoding: "utf8" }).trim().split("\n").pop();
const messages = (locale) => JSON.parse(readFileSync(join(here, "..", "..", "frontend", "messages", `${locale}.json`), "utf8"));
const M = { en: messages("en"), uz: messages("uz") };
const OUT = join(here, "..", "..", ".local", "e2e", "demo");
mkdirSync(OUT, { recursive: true });
const results = []; const ok = (c, m) => { results.push([!!c, m]); console.log((c ? "PASS " : "FAIL ") + m); };
async function run(name, { locale, dark, width, height }) {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"], ...(process.env.BW_CHROMIUM ? { executablePath: process.env.BW_CHROMIUM } : {}) });
  const c = await b.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  await c.addCookies([{ name: "NEXT_LOCALE", value: locale, url: WEB }]);
  await c.addInitScript((d) => { try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {} }, dark);
  const p = await c.newPage(); const errors = [];
  p.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) errors.push(e.message); });
  const url = `${WEB}${locale === "en" ? "/en" : ""}/demo/${TID}`;
  const raw = await (await p.request.get(url, { headers: { cookie: `NEXT_LOCALE=${locale}` } })).text();
  ok(!/\bseven\b/.test(raw) && !/correctAnswers?\\?"\s*:\s*\\?"(blue|seven)/.test(raw) && !/"isCorrect"/.test(raw), `${name}: page source and Next data carry no answer key`);
  ok(!/soundhelix|Researcher Smith|\blucid dream/i.test(raw), `${name}: no placeholder audio or transcript`);
  await p.goto(url, { waitUntil: "domcontentloaded" }); await p.waitForLoadState("networkidle").catch(() => {});
  await p.getByText("Which colour is the sky").waitFor({ timeout: 30000 });
  await p.getByLabel("blue").check();
  await p.getByRole("textbox").first().fill("seven");
  p.once("dialog", (d) => d.accept());
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes(`/tests/demo/${TID}/submit`)), p.getByRole("button", { name: M[locale].marketing.demoSubmit }).first().click()]);
  ok(resp.status() === 201, `${name}: answers are checked by the server (HTTP ${resp.status()})`);
  await p.getByTestId("demo-result").waitFor({ timeout: 15000 });
  const text = await p.getByTestId("demo-result").innerText();
  ok(/2\s*\/\s*2/.test(text) && text.includes("100%") && !/0\s*\/\s*1/.test(text) && text.includes(M[locale].marketing.demoNotAutoChecked), `${name}: result is the server's auto-checked 2 / 2; the essay section has no score`);
  const body = await p.evaluate(() => document.body.innerText);
  ok(body.includes(M[locale].marketing.demoNotAutoChecked), `${name}: the essay is marked as not auto-checked`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${name}: ${width}px no horizontal overflow`);
  await p.screenshot({ path: `${OUT}/demo-${name}-${locale}-${dark ? "dark" : "light"}-${width}.png`, fullPage: true });
  ok(errors.length === 0, `${name}: no page errors ${errors.join(" | ")}`);
  await b.close();
}
(async () => {
  await run("A", { locale: "uz", dark: true, width: 390, height: 844 });
  await run("B", { locale: "en", dark: false, width: 1440, height: 900 });
  const missing = await (await fetch(`${WEB}/en/demo/no-such-demo`)).status;
  ok(missing === 404, `unknown demo id gives 404 instead of invented questions (${missing})`);
  const failed = results.filter(([c]) => !c).length; console.log(`${results.length - failed}/${results.length} PASS`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
