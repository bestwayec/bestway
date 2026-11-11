#!/usr/bin/env node
// Rewrites raw Tailwind palette classes (bg-slate-900, text-emerald-400, border-red-200, ...) to the
// semantic design tokens defined in src/app/globals.css (bg-surface, text-brand, border-danger-border, ...).
//
// Why: raw palette classes are fixed colours. The app ships light and dark themes (dark is the default),
// and only the semantic tokens follow the theme. Components written for one theme render wrongly in the
// other (white cards in dark mode, white text on white in light mode).
//
// Not migrated on purpose: components/common/StrictErrorBoundary.tsx (crash report is a white box in both
// themes, see CDLayout.spec.ts), certificate-modal.tsx (print artwork), google-auth-button.tsx (brand mark).
//
// Usage: node scripts/tokenize-colors.mjs [--check] [--neutral-only] <file...>
//   --check         report what would change and exit 1 if anything would; do not write.
//   --neutral-only  only rewrite neutrals (slate/gray/white/black ...); keep every hue. For files whose hues
//                   carry meaning (per-skill colours, highlighter colours, question-type chips).
//
// The mapping is deterministic and documented in docs/design/DESIGN_SYSTEM.md. Deliberate exceptions:
//   bg-black/<n>  modal and media overlays stay black in both themes.
//   text-white    kept on a line that also paints a saturated (non-brand) background, e.g. a red badge.
//   neutral text  kept on a line that paints a solid hue (e.g. dark text on an amber "flagged" chip).
//   info hues     (blue/sky/purple/...) kept when a file uses more than one of them: they are categories.
import fs from "node:fs";

const NEUTRAL = new Set(["slate", "gray", "zinc", "neutral", "stone"]);
const BRAND = new Set(["emerald", "green", "teal", "lime"]);
const DANGER = new Set(["red", "rose"]);
const WARNING = new Set(["amber", "yellow"]);
const ORANGE = new Set(["orange"]);
const INFO = new Set(["blue", "sky", "cyan", "indigo", "violet", "purple", "fuchsia", "pink"]);
const HUES = [...NEUTRAL, ...BRAND, ...DANGER, ...WARNING, ...ORANGE, ...INFO];

// Utility prefixes and the "role" they colour.
const ROLE = {
  bg: "bg", from: "bg", via: "bg", to: "bg",
  text: "text", fill: "text", stroke: "text", placeholder: "text", caret: "text", accent: "text", decoration: "text",
  border: "border", ring: "border", divide: "border", outline: "border", shadow: "border",
};

const CLASS_RE = new RegExp(
  String.raw`(?<![\w-])((?:[a-z0-9-]+:|\[[^\]\s]+\]:)*)` + // variant chain (hover:, sm:, dark:, group-hover:, ...)
    String.raw`(bg|from|via|to|text|fill|stroke|placeholder|caret|accent|decoration|border(?:-[trblxy])?|ring|divide|outline|shadow)-` +
    String.raw`(${HUES.join("|")}|white|black)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?(?![\w-])`,
  "g",
);

// Solid fills (no /opacity), raw or already tokenized (so the codemod is idempotent).
const SATURATED_BG = new RegExp(
  String.raw`(?<![\w-])bg-(?:(?:${[...DANGER, ...WARNING, ...ORANGE, ...INFO].join("|")})-[4-7]00|danger|warning|info|orange)(?![\w/-])`,
);

function neutral(role, shade, isWhite, isBlack, alpha) {
  if (role === "text") {
    if (isWhite || isBlack) {
      if (alpha !== undefined && alpha < 50) return "fg-subtle";
      if (alpha !== undefined && alpha < 80) return "fg-muted";
      return "fg";
    }
    if (shade <= 200) return "fg";
    if (shade <= 400) return "fg-muted";
    if (shade === 500) return "fg-subtle";
    if (shade <= 700) return "fg-muted";
    return "fg";
  }
  if (role === "border") {
    if (isWhite || isBlack) return "border";
    if (shade <= 200) return "border";
    if (shade <= 700) return "border-strong";
    return "border";
  }
  // background
  if (isWhite) return alpha !== undefined && alpha <= 20 ? "surface-hover" : "surface";
  if (isBlack) return "bg";
  if (shade === 50) return "bg-subtle";
  if (shade <= 200) return "surface-hover";
  if (shade <= 300) return "border-strong";
  if (shade <= 600) return "fg-subtle";
  if (shade === 700) return "border-strong";
  if (shade === 800) return "surface-hover";
  if (shade === 900) return "surface";
  return "bg";
}

function tinted(family, role, shade, util, variants = "") {
  const t = {
    brand: { subtleBg: "brand-subtle", solid: "brand", strong: "brand-hover", text: "brand", textStrong: "brand-subtle-fg", border: "brand/30" },
    danger: { subtleBg: "danger-bg", solid: "danger", strong: "danger", text: "danger", textStrong: "danger", border: "danger-border" },
    warning: { subtleBg: "warning-bg", solid: "warning", strong: "warning", text: "warning", textStrong: "warning", border: "warning-border" },
    orange: { subtleBg: "orange-subtle", solid: "orange", strong: "orange", text: "orange", textStrong: "orange", border: "orange/30" },
    info: { subtleBg: "info-bg", solid: "info", strong: "info", text: "info", textStrong: "info", border: "info-border" },
  }[family];
  if (role === "text") return shade >= 700 && shade <= 900 ? t.textStrong : t.text;
  if (role === "border") return shade >= 400 && shade <= 700 ? t.solid : t.border;
  // gradient stops stay solid except the lightest / darkest washes
  if (util === "from" || util === "via" || util === "to") return shade <= 100 || shade >= 900 ? t.subtleBg : shade >= 700 ? t.strong : t.solid;
  // a lighter hover fill on a solid chip (hover:bg-amber-300) must stay solid: its text is dark
  if (/(?:^|:)(?:hover|active|focus):$/.test(variants) && shade >= 200 && shade <= 400) return t.solid;
  if (shade <= 300 || shade >= 900) return t.subtleBg;
  if (shade >= 700) return t.strong;
  return t.solid;
}

function familyOf(hue) {
  if (BRAND.has(hue)) return "brand";
  if (DANGER.has(hue)) return "danger";
  if (WARNING.has(hue)) return "warning";
  if (ORANGE.has(hue)) return "orange";
  if (INFO.has(hue)) return "info";
  return "neutral";
}

const SOLID_HUE_BG = new RegExp(
  String.raw`(?<![\w-])bg-(?:(?:${HUES.filter((h) => !NEUTRAL.has(h)).join("|")})-[3-7]00|brand|danger|warning|info|orange)(?![\w/-])`,
);

export function tokenizeLine(line, { neutralOnly = false, keepInfo = false } = {}) {
  const keepWhiteText = SATURATED_BG.test(line);
  const solidHueBg = SOLID_HUE_BG.test(line);
  const brandSolidBg = /(?<![\w-])bg-(?:(?:emerald|green|teal|lime)-[4-7]00|brand)(?![\w/-])/.test(line);
  return line.replace(CLASS_RE, (whole, variants, util, hue, shadeStr, alphaStr) => {
    const role = ROLE[util.replace(/-[trblxy]$/, "")];
    const shade = shadeStr ? Number(shadeStr) : 500;
    const alpha = alphaStr ? Number(alphaStr) : undefined;
    const isWhite = hue === "white";
    const isBlack = hue === "black";
    if (role === "bg" && isBlack && alpha !== undefined) return whole; // overlays
    if (variants.split(":").includes("dark")) return "\u0000"; // tokens already follow the theme
    if (role === "text" && isWhite && (alpha === undefined || alpha >= 80)) {
      if (brandSolidBg) return `${variants}${util}-brand-fg`;
      if (keepWhiteText) return whole;
    }
    const family = isWhite || isBlack ? "neutral" : familyOf(hue);
    if (family !== "neutral" && (neutralOnly || (keepInfo && family === "info"))) return whole;
    if (family === "neutral" && role === "text" && solidHueBg && !isWhite) {
      return brandSolidBg && (isBlack || shade >= 800) ? `${variants}${util}-brand-fg` : whole;
    }
    let token = family === "neutral" ? neutral(role, shade, isWhite, isBlack, alpha) : tinted(family, role, shade, util, variants);
    if (family === "brand" && token === "brand" && role === "bg" && /(?:^|:)(?:hover|active):$/.test(variants)) token = "brand-hover";
    // keep explicit opacity on tinted solids (bg-emerald-500/10 -> bg-brand/10)
    if (alpha !== undefined && !token.includes("/") && !(family === "neutral" && (isWhite || isBlack))) {
      token = `${token}/${alpha}`;
    }
    return `${variants}${util}-${token}`;
  });
}

export function tokenizeSource(src, { neutralOnly = false } = {}) {
  const infoHues = new Set([...src.matchAll(new RegExp(String.raw`-(${[...INFO].join("|")})-\d{2,3}`, "g"))].map((m) => m[1]));
  const opts = { neutralOnly, keepInfo: infoHues.size > 1 };
  return src
    .split("\n")
    .map((line) =>
      tokenizeLine(line, opts)
        // drop the placeholder left by removed dark: classes, and one adjacent space
        .replace(/ \u0000|\u0000 ?/g, ""),
    )
    .join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const neutralOnly = args.includes("--neutral-only");
  let changed = 0;
  for (const file of args.filter((a) => !a.startsWith("--"))) {
    const before = fs.readFileSync(file, "utf8");
    const after = tokenizeSource(before, { neutralOnly });
    if (after !== before) {
      changed += 1;
      if (check) console.log(`would change: ${file}`);
      else fs.writeFileSync(file, after);
    }
  }
  console.log(`${check ? "would change" : "changed"} ${changed} file(s)`);
  if (check && changed) process.exit(1);
}
