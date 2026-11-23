// BESTWAY Learning 3.0 (PR C) in a real browser: online Bamboozle 1v1 scored by the server, and a
// teacher-chosen vocabulary question type. Playwright + Chromium against the local Next production
// build, Django and PostgreSQL. Synthetic accounts and original content only.
//
//   BW_WEB=http://localhost:3300 node games-learning-3.mjs
//
// B1 the host opens a 1v1 room from a deck card; the guest joins by the shared link (two browsers)
// B2 only the player whose turn it is can open a card; the other board is locked
// B3 the server judges the chosen option; both screens show the same score (polling)
// B4 no unopened answer reaches the browser; forged plays (no token, wrong turn) are refused
// B5 the server keeps the 2x bonus; the game ends with the same result on both screens
// H1 the teacher fixes "Fill in the blank" for vocabulary homework in the assign form
// H2 the learner sees the teacher's type and gets only gap-fill questions
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = process.env.BW_WEB || "http://localhost:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const TEACHER = process.env.BW_TEACHER || "+998900000003";
const STUDENT = process.env.BW_STUDENT || "+998900000011";
const GROUP_STUDENT = process.env.BW_GROUP_STUDENT || "+998900101000"; // B1 Kechki (seed_teacher_workspace_local)
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(WEB).hostname)) { console.error("Refusing non-loopback host"); process.exit(2); }
const OUT = join(here, "..", "..", ".local", "e2e", "games-learning-3");
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (c, m) => { results.push(!!c); console.log((c ? "PASS " : "FAIL ") + m); };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const pageErrors = [];
const shot = (page, name) => page.screenshot({ path: join(OUT, name), fullPage: true });

async function login(phone, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "en-US" });
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
const score = async (page, team) => Number((await page.getByTestId(`team-${team}-score`).innerText()).trim());
const waitScore = (page, team, value) => page.waitForFunction(([t, v]) => {
  const el = document.querySelector(`[data-testid="team-${t}-score"]`);
  return el && Number(el.textContent.trim()) === v;
}, [team, value], { timeout: 15000 }).then(() => true).catch(() => false);
const turnText = (page) => page.getByTestId("turn-status").innerText();
const cardByIndex = (page, n) => page.getByTestId("online-card").nth(n - 1);

// ── setup: a deck with two questions and two surprise cards ────────────────────────────────────
const stamp = Date.now();
const { ctx: hctx, page: host } = await login(TEACHER);
const deckTitle = `E2E Arena ${stamp}`;
const deck = await api(host, "POST", "/v1/quiz-decks/create", {
  title: deckTitle, category: "Vocabulary",
  cards: [
    { card_type: "question", points: 10, question_text: "Choose the synonym of 'rapid'.", options: ["slow", "quick", "heavy"], correct_answer: "quick" },
    { card_type: "double", points: 0, question_text: "2X" },
    { card_type: "question", points: 15, question_text: "Choose the opposite of 'ancient'.", options: ["modern", "old", "historic"], correct_answer: "modern" },
    { card_type: "swap", points: 0, question_text: "SWAP" },
  ],
});
ok(deck.status === 201 && deck.data?.id, `setup: teacher created a 4-card deck (HTTP ${deck.status})`);

// ── B1: host opens a room from the deck card, guest joins by link ──────────────────────────────
await host.goto(`${WEB}/en/bamboozle`);
const deckCard = host.locator("div").filter({ hasText: deckTitle }).filter({ has: host.getByTestId("bamboozle-1v1") }).last();
await deckCard.getByTestId("bamboozle-1v1").click({ timeout: 60000 });
const enter = host.getByRole("button", { name: /Arenaga Kirish/ });
await enter.waitFor({ timeout: 30000 });
await enter.click();
await host.getByTestId("bamboozle-online").waitFor({ timeout: 30000 });
const roomCode = (await host.locator("header .font-mono").innerText()).trim();
ok(/^[A-Z2-9]{6}$/.test(roomCode), `B1 host is in room ${roomCode}`);
ok(/Waiting for your opponent/.test(await turnText(host)), "B1 the host waits for an opponent");
ok(await cardByIndex(host, 1).isDisabled(), "B2 no card can be opened before the guest joins");

const { ctx: gctx, page: guest } = await login(STUDENT, { width: 390, height: 844 });
guest.on("pageerror", (e) => pageErrors.push(e.message));
await guest.goto(`${WEB}/en/bamboozle?room=${roomCode}`);
await guest.getByTestId("bamboozle-online").waitFor({ timeout: 60000 });
ok(/'s turn/.test(await turnText(guest)), "B1 the guest joined; it is the host's turn");
ok(await cardByIndex(guest, 1).isDisabled(), "B2 the guest's board is locked on the host's turn");
await host.getByText(/Your turn/).waitFor({ timeout: 15000 });
ok(await cardByIndex(host, 1).isEnabled(), "B2 the host sees the guest joined (poll) and may play");

// ── B4: what the browser can see, and forged plays ─────────────────────────────────────────────
const publicRoom = await api(guest, "GET", `/v1/bamboozle/rooms/${roomCode}`);
ok(publicRoom.data.cards.every((c) => !("correct_answer" in c)) && !JSON.stringify(publicRoom.data).includes("_tokens"),
  "B4 the room state carries no unopened answer and no token");
const guestSeat = await guest.evaluate((code) => JSON.parse(sessionStorage.getItem(`bestway.bamboozle.${code}`)), roomCode);
ok(guestSeat?.team === 2 && typeof guestSeat.token === "string", "B4 the guest holds its own seat token (team 2)");
const firstCardId = publicRoom.data.cards[0].id;
const noToken = await api(guest, "POST", `/v1/bamboozle/rooms/${roomCode}/play`, { card_id: firstCardId, answer: "quick", is_correct: true, team: 1 });
ok(noToken.status === 403 && noToken.error?.code === "NOT_A_PLAYER", "B4 a play without a seat token is refused (is_correct/team ignored)");
const wrongTurn = await api(guest, "POST", `/v1/bamboozle/rooms/${roomCode}/play`, { card_id: firstCardId, answer: "quick", player_token: guestSeat.token });
ok(wrongTurn.status === 409 && wrongTurn.error?.code === "NOT_YOUR_TURN", "B4 the guest cannot play on the host's turn");

// ── B3: the host answers correctly; both screens agree ─────────────────────────────────────────
await cardByIndex(host, 1).click();
await host.getByTestId("online-option").filter({ hasText: "quick" }).click();
ok(await waitScore(host, 1, 10), "B3 host answered correctly: 10 points by the server");
ok(await waitScore(guest, 1, 10), "B3 the guest's screen shows the same score");
await guest.getByText(/Your turn/).waitFor({ timeout: 15000 });
await shot(guest, "1-guest-turn-390.png");

// ── B5: guest takes 2x, host answers wrong (0), guest... swap ends the game ────────────────────
await cardByIndex(guest, 2).click();                                   // double for team 2
await host.getByText(/Your turn/).waitFor({ timeout: 15000 });
ok(await host.getByTestId("team-2").getByText(/2×/).isVisible(), "B5 the host sees the guest's 2x bonus kept by the server");
await cardByIndex(host, 3).click();
await host.getByTestId("online-option").filter({ hasText: "old" }).click();
await host.getByTestId("last-play").getByText(/wrong answer/).waitFor({ timeout: 15000 });
ok(await score(host, 1) === 10, "B5 a wrong option scores nothing");
await guest.getByText(/Your turn/).waitFor({ timeout: 15000 });
await cardByIndex(guest, 4).click();                                   // swap: 0 <-> 10
ok(await waitScore(guest, 2, 10) && await waitScore(guest, 1, 0), "B5 swap exchanged the scores on the server");
await guest.getByTestId("online-result").waitFor({ timeout: 15000 });
await host.getByTestId("online-result").waitFor({ timeout: 15000 });
const hostResult = await host.getByTestId("online-result").innerText();
ok(hostResult === await guest.getByTestId("online-result").innerText() && /wins/.test(hostResult), `B5 both screens show the same result (${hostResult.trim()})`);
const opened = await api(guest, "GET", `/v1/bamboozle/rooms/${roomCode}`);
ok(opened.data.cards[0].correct_answer === "quick", "B4 an opened card's answer is shown once it is revealed");
await shot(host, "2-host-finished-1366.png");
await gctx.close();

// ── H1/H2: teacher-fixed vocabulary question type ──────────────────────────────────────────────
const overview = await api(host, "GET", "/v1/teacher/workspace/overview");
const group = (overview.data?.groups || []).find((g) => g.name === "B1 Kechki");
if (!group) {
  ok(false, "H setup: the seeded group 'B1 Kechki' exists (run seed_teacher_workspace_local)");
} else {
  const set = await api(host, "POST", "/v1/vocabulary/sets", {
    title: `E2E gap-fill ${stamp}`, level: "B1", isPublic: false,
    words: [
      { english: "journey", uzbek: "sayohat", contextSentence: "The journey took three days." },
      { english: "border", uzbek: "chegara", contextSentence: "We crossed the border at night." },
      { english: "luggage", uzbek: "yuk" },
    ],
  });
  ok(set.status === 201, "H setup: teacher created a set (2 words have example sentences)");
  await host.goto(`${WEB}/en/teacher/assign?group=${group.id}`);
  await host.getByTestId("hw-type-vocabulary").click({ timeout: 60000 });
  await host.getByTestId("hw-source").selectOption(set.data.id);
  const modeSelect = host.getByTestId("hw-vocab-mode");
  await modeSelect.waitFor({ timeout: 15000 });
  await modeSelect.selectOption("synonym");
  await host.getByText(/no data|ma'lumot yo'q|ma’lumot/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  ok(await host.getByTestId("hw-assign").isDisabled().catch(() => true), "H1 a type the words have no data for (synonym) cannot be assigned");
  await modeSelect.selectOption("fill_blank");
  const title = `Gap-fill E2E ${stamp % 100000}`;
  await host.getByTestId("hw-title").fill(title);
  await host.getByTestId("hw-preview").waitFor({ timeout: 30000 });
  await host.getByTestId("hw-assign").click({ timeout: 30000 });
  await host.getByTestId("hw-success").waitFor({ timeout: 30000 });
  ok(true, "H1 the teacher assigned the homework with 'Fill in the blank'");
  await shot(host, "3-assign-fill-blank-1366.png");

  const { ctx: sctx, page: s } = await login(GROUP_STUDENT, { width: 390, height: 844 });
  const mine = await api(s, "GET", "/v1/student/my-assignments");
  const row = (mine.data || []).find((a) => a.title === title);
  ok(!!row, "H2 the learner has the new homework");
  await s.goto(`${WEB}/en/vocabulary/assignment/${row.id}`);
  const note = s.getByTestId("teacher-mode");
  await note.waitFor({ timeout: 60000 });
  ok(/Fill in the blank/.test(await note.innerText()), "H2 the learner sees the teacher's question type");
  await s.getByTestId("start-teacher-mode").click();
  const quiz = s.getByTestId("vocab-quiz");
  await quiz.waitFor({ timeout: 60000 });
  const issued = await api(s, "POST", `/v1/student/assignments/${row.id}/vocabulary`, { mode: "eng_uzb" });
  const types = (issued.data?.questions || []).map((q) => q.type);
  ok(issued.data?.mode === "fill_blank" && types.filter((t) => t === "fill_blank").length === 2,
    `H2 the server issued the teacher's type for both words with sentences, ignoring the learner's request (${types.join(", ")})`);
  const text = await quiz.innerText();
  ok(!/\bjourney\b|\bborder\b/.test(text), "H2 the gap-fill question does not show the answer");
  await shot(s, "4-student-fill-blank-390.png");
  await sctx.close();
}
await hctx.close();

ok(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
