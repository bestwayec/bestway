import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || "before";
const OUT = join(here, "..", "..", "docs", "design", mode);
mkdirSync(OUT, { recursive: true });

const WEB = process.env.BW_WEB || "http://127.0.0.1:3300";
const PASSWORD = process.env.BW_PASSWORD || "LocalDev-2026!";
const STUDENT = process.env.BW_STUDENT || "+998900000010";

function findChromium() {
  const root = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(root, d, sub, "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

// Generate or get an attempt for runner
let attemptId = "";
try {
  const py = join(here, "..", "..", "backend-django", ".venv", "Scripts", "python.exe");
  attemptId = execFileSync(py, ["manage.py", "seed_local_k1_attempt", "--phone", STUDENT],
    { cwd: join(here, "..", "..", "backend-django"), encoding: "utf8" }).trim().split(/\s+/).pop();
} catch (e) {
  console.warn("Could not seed attempt:", e.message);
}

const VIEWPORTS = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
];

const THEMES = ["dark", "light"];

const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    console.log(`\n=== Viewport: ${vp.name}, Theme: ${theme} ===`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: "en-US",
      colorScheme: theme,
    });

    // Login via API to avoid form timeouts
    const loginRes = await ctx.request.post(`${WEB}/api/auth/login`, {
      data: { phone: STUDENT, password: PASSWORD },
    });
    if (loginRes.status() !== 200) {
      console.warn(`API login status: ${loginRes.status()}`);
    }

    const page = await ctx.newPage();

    async function applyTheme() {
      await page.evaluate((th) => {
        if (th === "dark") {
          document.documentElement.classList.add("dark");
          document.documentElement.setAttribute("data-theme", "dark");
        } else {
          document.documentElement.classList.remove("dark");
          document.documentElement.setAttribute("data-theme", "light");
        }
      }, theme);
      await page.waitForTimeout(200);
    }

    const targets = [
      { name: "landing", path: "/en" },
      { name: "login", path: "/en/login" },
      { name: "dashboard", path: "/en/dashboard" },
      { name: "exams", path: "/en/mock" },
      ...(attemptId ? [{ name: "exam-runner", path: `/en/mock/attempt/${attemptId}?simulator=dtm` }] : []),
      { name: "profile", path: "/en/profile" },
    ];

    for (const t of targets) {
      try {
        await page.goto(`${WEB}${t.path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await applyTheme();
        await page.screenshot({ path: join(OUT, `${t.name}-${vp.name}-${theme}.png`) });
        console.log(`[OK] ${t.name} ${vp.name} ${theme}`);
      } catch (err) {
        console.error(`[ERR] ${t.name} ${vp.name} ${theme}:`, err.message.split("\n")[0]);
      }
    }

    await page.close();
    await ctx.close();
  }
}

await browser.close();
console.log(`\nAll screenshots saved to: ${OUT}`);
