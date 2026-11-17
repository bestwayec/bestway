#!/usr/bin/env node
// Rewrites hard-coded shape values to the design tokens in src/app/globals.css
// (docs/design/DIRECTION.md §3.4–3.5):
//   rounded-[6px]  → rounded-chip      rounded-[8px]  → rounded-field    rounded-[10px] → rounded-control
//   rounded-[12px] → rounded-card      rounded-[14px] → rounded-card     rounded-[16px|18px|20px] → rounded-dialog
//   (also with side prefixes: rounded-t-[12px] → rounded-t-card, and variants: sm:rounded-[12px])
//   coloured glow shadows (shadow-brand/30, shadow-emerald-900/30, shadow-[0_0_12px_rgba(16,185,129,.3)])
//   are removed: elevation is neutral, never coloured.
//
// Usage: node scripts/tokenize-shape.mjs [--check] <file...>
//   --check  report what would change and exit 1 if anything would; do not write.
import fs from "node:fs";

const RADIUS = { 6: "chip", 8: "field", 10: "control", 12: "card", 14: "card", 16: "dialog", 18: "dialog", 20: "dialog" };
const RADIUS_RE = /\brounded-((?:[trbl]|tl|tr|bl|br|s|e|ss|se|es|ee)-)?\[(\d+)px\]/g;
// A coloured shadow: a palette or brand colour after shadow-, or an arbitrary glow drawn in a green/teal/amber rgba.
const GLOW_RE = /(?<=^|[\s"'`])(?:[a-z0-9-]+:)*shadow-(?:(?:brand|emerald|green|teal|lime)(?:-\d{2,3})?(?:\/\d{1,3})?|\[0_0_[^\]]*rgba\((?:16,185,129|20,184,166|34,197,94|245,158,11)[^\]]*\])(?=$|[\s"'`])/g;

export function tokenizeShape(src) {
  return src
    .replace(RADIUS_RE, (m, side, px) => (RADIUS[px] ? `rounded-${side ?? ""}${RADIUS[px]}` : m))
    .replace(GLOW_RE, "\u0000")
    .replace(/([ \t]?)\u0000([ \t]?)/g, (m, a, b) => (a && b ? a : ""));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  let changed = 0;
  for (const file of args.filter((a) => !a.startsWith("--"))) {
    const before = fs.readFileSync(file, "utf8");
    const after = tokenizeShape(before);
    if (after === before) continue;
    changed++;
    if (check) console.log(`would change: ${file}`);
    else fs.writeFileSync(file, after);
  }
  if (check && changed) process.exit(1);
  if (!check) console.log(`${changed} file(s) changed`);
}
