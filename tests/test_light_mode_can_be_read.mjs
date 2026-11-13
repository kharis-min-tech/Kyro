/**
 * "i also cant see this, light mode."
 *
 * A warning on the Cameras page, in pale yellow, on a pale yellow card, on
 * white. The text was there; it could not be read.
 *
 * Kyro's light theme works by overriding the pale text colours that were
 * chosen for a dark background. That list is hand-written, so a colour
 * nobody added to it goes on being pale — and nothing says so, because the
 * page still renders perfectly and the words are still in the HTML.
 *
 * Two ways for a colour to be unreadable, and this checks both:
 *
 *   · a Tailwind class (text-amber-200) with no light-mode rule;
 *   · a pale colour written straight into a style, which no CSS rule can
 *     reach at all — those have to be theme tokens.
 *
 *   node tests/test_light_mode_can_be_read.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const SRC = path.join(root, "dashboard/src");
const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8");

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.tsx?$/.test(f)) files.push(f);
  }
})(SRC);
const read = (f) => fs.readFileSync(f, "utf8");
const name = (f) => f.replace(SRC + "/", "");

// ── 1. Every pale text class has a light-mode rule ────────────────────────
//
// 100–400 of any colour is pale enough to vanish on white.
{
  const used = new Map();
  for (const f of files) {
    for (const m of read(f).matchAll(/\btext-(amber|yellow|emerald|green|red|rose|orange|indigo|blue|sky|purple|violet|pink|teal|cyan)-(100|200|300|400)\b/g)) {
      if (!used.has(m[0])) used.set(m[0], name(f));
    }
  }
  const missing = [...used].filter(([c]) => !css.includes(`light"] .${c}:not(`));
  ok(`1. every pale text class has a light-mode rule (${used.size} in use)`,
     missing.length === 0,
     missing.map(([c, f]) => `${c} — first used in ${f}`).join("\n   "));
}

// ── 2. No pale colour written straight into a style ───────────────────────
//
// An inline colour is the one thing the theme cannot reach: CSS cannot
// override a style attribute. So a pale one is pale in both themes, for
// ever. These are the exact shades the dark theme reaches for.
{
  const PALE = [
    "#fcd34d", "#fde68a", "#fef3c7", "#fef08a",   // ambers and yellows
    "#a7f3d0", "#6ee7b7", "#bbf7d0", "#86efac",   // greens
    "#bfdbfe", "#c7d2fe", "#a5b4fc", "#ddd6fe",   // blues and indigos
    "#fecaca", "#fca5a5",                          // reds
  ];
  /**
   * …except where the thing behind it is dark whatever the theme.
   *
   * A label over a camera picture, or on a panel that sets its own near-
   * black background, is pale on purpose and right to be. The test for
   * that is the background on the same line: dark AND solid enough to
   * actually cover the card underneath.
   *
   * Translucency is the whole point of the check. rgba(34,197,94,0.12) is
   * not a green background — it is a twelfth of a green over whatever is
   * behind it, which on the light theme is white. Pale green on that is
   * the bug, not the exception.
   */
  const lightness = (hex) => {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? [...h].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    const [r, g, b] = n.map((x) => parseInt(x, 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const darkBehind = (line) => {
    const rgba = /background[^"']*["']rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(line);
    if (rgba) {
      const [, r, g, b, a] = rgba;
      const l = (0.299 * +r + 0.587 * +g + 0.114 * +b) / 255;
      return l < 0.3 && (a === undefined || +a >= 0.5);
    }
    const hex = /background[^"']*["'](#[0-9a-fA-F]{3,6})["']/.exec(line);
    return !!hex && lightness(hex[1]) < 0.3;
  };
  const allowed = (f, line) =>
    /globals\.css$/.test(f)
    || /ReviewPanel\.tsx$/.test(f)
    || /textShadow/.test(line)
    || /keep-white/.test(line)
    || darkBehind(line);

  const bad = [];
  for (const f of files) {
    read(f).split("\n").forEach((line, i) => {
      if (allowed(name(f), line)) return;
      if (!/colou?r\s*:/i.test(line)) return;
      for (const hex of PALE) {
        if (line.toLowerCase().includes(hex)) bad.push(`${name(f)}:${i + 1} ${hex}`);
      }
    });
  }
  ok("2. no pale colour is written straight into a style", bad.length === 0, bad.join("\n   "));
}

// ── 3. The warning she could not read ─────────────────────────────────────
{
  const cameras = read(path.join(SRC, "app/cameras/page.tsx"));
  const warn = cameras.slice(cameras.indexOf("each in its own zone") - 600, cameras.indexOf("each in its own zone"));
  ok("3. the two-cameras-one-room warning uses a colour that follows the theme",
     /color: "var\(--accent-amber\)"/.test(warn) && !/text-amber-200/.test(warn), warn.slice(-300));
}

// ── 4. The tokens it leans on really do change with the theme ─────────────
{
  for (const token of ["--accent-amber", "--accent-green", "--accent-indigo", "--accent-red"]) {
    // Each block on its own: a greedy match runs past the first : root {
    // into the light one and reports the same colour twice.
    const block = (head) => {
      const at = css.indexOf(head);
      return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
    };
    const value = (head) => new RegExp(`${token}:\\s*(#[0-9a-f]{3,8})`, "i").exec(block(head))?.[1];
    const dark = value(':root[data-theme="dark"] {');
    const light = value(':root[data-theme="light"] {');
    ok(`4. ${token} is a different colour in each theme`,
       !!dark && !!light && dark.toLowerCase() !== light.toLowerCase(), `${dark} / ${light}`);
  }
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
