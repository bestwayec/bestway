// BESTWAY Learning 3.0 — vocabulary pronunciation and Vocabulary Exam 3.0 in a real browser (Playwright,
// Chromium, Next production build + Django + PostgreSQL). Synthetic accounts and original words only.
//
//   BW_WEB=http://localhost:3300 node vocab-learning-3.mjs
//
// Stored pronunciation audio is a generated tone served for an HTTPS URL through Playwright routing and
// played by the real HTMLAudioElement. Headless Chromium has no speech voices, so window.speechSynthesis
// is replaced by a deterministic logger (start/end after 300 ms) — the engine under test is unchanged.
//
// P1 two plays, strictly sequential (stored audio), no third play
// P2 two plays via the speech fallback for a word without stored audio
// P3 answering during playback cancels it; the next word never inherits the old word's playback
// P4 no pronunciation (or IPA / example sentence) is offered where it would reveal the answer
// V1 mode picker shows grounded type counts and disables types without data
// V2 a listening quiz completes and the attempt is stored server-side
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000011";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "vocab-learning-3");
mkdirSync(OUT, { recursive: true });
const AUDIO_HOST = "https://audio.bestway-e2e.test";

const results = [];
const ok = (c, m) => { results.push(!!c); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const pageErrors = [];

function wav(ms = 450) {
  const rate = 8000, n = Math.round((rate * ms) / 1000), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}
const TONE = wav();

/** In-page instrumentation: every media play/end/pause and every speech start/end is logged with a timestamp. */
const INSTRUMENT = () => {
  window.__log = [];
  const log = (e) => window.__log.push({ ...e, t: performance.now() });
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__wired) {
      this.__wired = true;
      this.addEventListener("ended", () => log({ kind: "audio-end", src: this.currentSrc || this.src }));
      this.addEventListener("pause", () => { if (!this.ended) log({ kind: "audio-pause", src: this.currentSrc || this.src }); });
    }
    log({ kind: "audio-start", src: this.src, rate: this.playbackRate });
    return origPlay.call(this);
  };
  let current = null, timer = null;
  const fake = {
    speaking: false,
    getVoices: () => [{ lang: "en-US", name: "E2E US", localService: true, default: true, voiceURI: "e2e" }],
    speak(u) {
      current = u; log({ kind: "speech-start", text: u.text, rate: u.rate, lang: u.lang });
      timer = setTimeout(() => { if (current !== u) return; current = null; log({ kind: "speech-end", text: u.text }); u.onend && u.onend(); }, 300);
    },
    cancel() {
      if (!current) return;
      const u = current; current = null; clearTimeout(timer);
      log({ kind: "speech-cancel", text: u.text }); u.onerror && u.onerror({ error: "interrupted" });
    },
    addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ""; this.rate = 1; this.voice = null; this.onend = null; this.onerror = null; };
};

async function login(phone, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
  await ctx.route(`${AUDIO_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: TONE, headers: { "access-control-allow-origin": "*" } }));
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/\bgis\b/.test(e.message)) pageErrors.push(e.message); });
  await page.goto(`${WEB}/en/login`); await page.waitForSelector("#phone");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.fill("#phone", phone); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/login")), page.click('button[type="submit"]')]);
  await page.waitForURL(/dashboard/, { timeout: 60000 }).catch(() => {});
  return { ctx, page };
}
async function api(page, method, path, body) {
  const res = await page.request.fetch(`${WEB}/api/backend${path}`, { method, ...(body !== undefined ? { data: body } : {}) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status(), data: json.data, error: json.error };
}
const events = (page) => page.evaluate(() => window.__log.slice());
const clearLog = (page) => page.evaluate(() => { window.__log.length = 0; });
const plays = (log) => log.filter((e) => e.kind === "audio-start" || e.kind === "speech-start");
const waitIdle = (page) => page.waitForFunction(() => {
  const s = document.querySelector('[data-testid="pronounce-status"]');
  return s && s.textContent.trim() === "";
}, null, { timeout: 15000 }).catch(() => {});

// ── setup: a teacher's set with grounded data ───────────────────────────────────────────────────
const stamp = Date.now();
const { ctx: tctx, page: t } = await login(TEACHER);
const created = await api(t, "POST", "/v1/vocabulary/sets", {
  title: `E2E Vocabulary 3.0 ${stamp}`, level: "B1", isPublic: true,
  words: [
    { english: "achievement", uzbek: "yutuq", contextSentence: "Winning the prize was a great achievement for her.", synonyms: ["accomplishment"], pronunciation: "/əˈtʃiːvmənt/", audioUrl: `${AUDIO_HOST}/achievement.wav` },
    { english: "decline", uzbek: "pasayish", contextSentence: "Sales saw a sharp decline last year.", synonyms: ["decrease"] },
    { english: "rapid", uzbek: "tez" },
    { english: "growth", uzbek: "o'sish" },
    { english: "career", uzbek: "kasb" },
  ],
});
ok([200, 201].includes(created.status) && created.data?.id, `setup: teacher created a set (HTTP ${created.status})`);
const setId = created.data.id;
await tctx.close();

const { ctx: sctx, page: s } = await login(STUDENT);

// ── V1: mode picker ────────────────────────────────────────────────────────────────────────────
await s.goto(`${WEB}/en/vocabulary/${setId}`);
const synonymMode = s.getByRole("radio", { name: /Synonym/ });
await synonymMode.getByText(/words have the data/).waitFor({ timeout: 60000 });
ok((await synonymMode.innerText()).includes("2 words have the data"), "V1 synonym mode shows the 2 words that have synonyms");
ok((await s.getByRole("radio", { name: /Fill in the blank/ }).innerText()).includes("2 words have the data"), "V1 fill-in-the-blank counts only sentences containing the word");
ok(await s.getByRole("radio", { name: /Listen and type/ }).isEnabled(), "V1 listening types are available for every word");

// ── P1/P2/P3: listen and choose ────────────────────────────────────────────────────────────────
await s.getByRole("radio", { name: /Listen and choose/ }).click();
await s.getByRole("button", { name: /start/i }).last().click();
const quiz = s.getByTestId("vocab-quiz");
await quiz.waitFor({ timeout: 60000 });
ok(await quiz.getAttribute("data-question-type") === "listen_choose", "P listening question loaded");
ok(await s.getByTestId("vocab-prompt").count() === 0, "P4 the heard word is not displayed");
const quizText = await quiz.innerText();
ok(!/achievement|decline|rapid|growth|career/.test(quizText) && !quizText.includes("/əˈtʃiːvmənt/"), "P4 neither the word nor its IPA is on screen");

let storedChecked = false, speechChecked = false, cancelChecked = false;
const now = () => s.evaluate(() => performance.now());
const options = quiz.locator("div.grid button");
// Each question's playback starts from the click that opened it (auto-play after the first gesture).
let mark = await now();
await s.getByTestId("pronounce-button").click(); // first play needs an explicit gesture
for (let i = 0; i < 5; i++) {
  await s.waitForFunction((m) => window.__log.some((e) => e.t >= m && (e.kind === "audio-start" || e.kind === "speech-start")), mark, { timeout: 8000 }).catch(() => {});
  const first = plays((await events(s)).filter((e) => e.t >= mark))[0];
  if (!cancelChecked && i >= 1 && first && first.kind === "speech-start") {
    // P3: answer while the first play of this (speech) word is still running.
    const word = first.text;
    mark = await now();
    await options.first().click();
    await s.waitForTimeout(3500);
    const later = plays((await events(s)).filter((e) => e.t >= mark));
    ok(!later.some((e) => (e.src || e.text) === word), `P3 the interrupted word "${word}" never plays again after answering`);
    const next = later[0] ? later[0].src || later[0].text : null;
    ok(later.length === 2 && later.every((e) => (e.src || e.text) === next && next !== word), "P3 the next word plays its own two plays");
    cancelChecked = true;
    continue; // `mark` already points at the start of the next question
  }
  await s.waitForTimeout(3500); // two plays + pause + margin for a wrong third
  const log = (await events(s)).filter((e) => e.t >= mark);
  const starts = plays(log);
  const stored = starts.length > 0 && starts[0].kind === "audio-start";
  const ends = log.filter((e) => e.kind === (stored ? "audio-end" : "speech-end"));
  const sameWord = starts.every((e) => (e.src || e.text) === (starts[0].src || starts[0].text));
  const sequential = starts.length === 2 && sameWord && ends.length >= 1 && ends[0].t <= starts[1].t;
  const gap = sequential ? Math.round(starts[1].t - ends[0].t) : -1;
  ok(starts.length === 2 && sameWord, `P question ${i + 1}: exactly two plays of one word (${starts.length})`);
  if (stored && !storedChecked) {
    ok(sequential, `P1 stored audio: the 2nd play starts only after the 1st ended (+${gap} ms)`);
    ok(gap >= 500 && gap <= 1200, `P1 pause between plays ≈650 ms (${gap} ms)`);
    storedChecked = true;
  } else if (!stored && starts.length && !speechChecked) {
    ok(sequential, `P2 speech fallback: the 2nd play starts only after the 1st ended (+${gap} ms)`);
    speechChecked = true;
  }
  mark = await now();
  if (!(await options.count())) break;
  await options.first().click();
  await s.waitForTimeout(300);
  if (!(await s.getByTestId("vocab-quiz").count())) break;
}
ok(storedChecked, "P1 a stored-audio word was played");
ok(speechChecked, "P2 a speech-fallback word was played");
ok(cancelChecked, "P3 cancellation was exercised");

// ── V2: attempt stored ─────────────────────────────────────────────────────────────────────────
await s.waitForFunction(() => !document.querySelector('[data-testid="vocab-quiz"]'), null, { timeout: 30000 }).catch(() => {});
await s.screenshot({ path: join(OUT, "V2-result-1366.png") });
const detail = await api(s, "GET", `/v1/vocabulary/sets/${setId}`);
const attempt = detail.data?.attempts?.[0];
ok(!!attempt && attempt.totalWords === 5 && attempt.mode === "listen_choose", `V2 the attempt is stored server-side (${attempt ? `${attempt.score}/${attempt.totalWords} ${attempt.mode}` : "none"})`);

// ── P4: questions that ask for the English word offer no audio ─────────────────────────────────
await s.goto(`${WEB}/en/vocabulary/${setId}`);
await s.getByRole("radio", { name: /^Uzbek → English/ }).click();
await s.getByRole("button", { name: /start/i }).last().click();
await s.getByTestId("vocab-quiz").waitFor({ timeout: 60000 });
ok(await s.getByTestId("pronounce-button").count() === 0, "P4 uzb→eng questions have no speaker button (it would say the answer)");
const uzText = await s.getByTestId("vocab-quiz").innerText();
ok(!/Winning the prize|Sales saw a sharp/.test(uzText), "P4 uzb→eng questions do not show the example sentence (it contains the answer)");

ok(pageErrors.length === 0, `no uncaught page errors (${pageErrors.slice(0, 2).join(" | ")})`);
await sctx.close(); await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\nSUMMARY ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
