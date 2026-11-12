/**
 * Answer tile colours of the Live Vocab Battle. They are categories (DESIGN_SYSTEM.md exception: game answer
 * colours), so they keep fixed hues in both themes: the theme tokens turn light in the dark theme and white
 * text on them dropped below 3:1. These dark steps keep white text at about 4.5:1 or more, and every tile
 * also carries a shape, so an answer never depends on colour alone.
 */
export const BATTLE_ANSWER_STYLES = [
  { bg: "bg-red-600", text: "text-white", shape: "▲" },
  { bg: "bg-sky-700", text: "text-white", shape: "◆" },
  { bg: "bg-amber-700", text: "text-white", shape: "●" },
  { bg: "bg-violet-600", text: "text-white", shape: "■" },
] as const;
