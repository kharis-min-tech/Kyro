/**
 * "seat editor is not functional" — a plain grey rectangle, no picture, no
 * message, nothing to draw on.
 *
 * It was trying to tell her why the whole time.
 *
 * The empty canvas was filled with `ctx.fillStyle = "var(--bg-hover)"`. A
 * canvas context cannot read a CSS variable: it REFUSES the assignment and
 * silently keeps whatever colour was set last. The colour set last was
 * #6b7280 — the very colour the message underneath is written in — so the
 * box was painted in exactly the colour of the text on it.
 *
 * What was left was a grey rectangle with an invisible explanation in the
 * middle of it. Which looks precisely like a broken editor.
 *
 * The same line is in the seat map, where it meant the map was drawn on
 * black whatever the page's theme, and after a redraw on whatever colour
 * the last seat happened to be.
 *
 * And the message itself could never have fitted: fillText draws one line
 * and does not wrap, so a forty-word explanation ran off both edges of the
 * canvas. It is broken into lines that fit now.
 *
 * The rule, for every canvas: a real colour, never a variable. Nothing
 * warns you — no error, no console message, just the wrong colour.
 *
 *   node tests/test_a_canvas_cannot_read_a_variable.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");

// ── No canvas anywhere is given a CSS variable ────────────────────────────
{
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(full);
    }
  };
  walk(path.join(root, "dashboard/src"));

  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      // Only where a canvas context is being painted — a style= prop may
      // use a variable perfectly happily, and most of them do.
      if (/\b(ctx|context|c2d)\s*\.\s*(fillStyle|strokeStyle|shadowColor)\s*=\s*["'`]\s*var\(/.test(line)) {
        offenders.push(`${path.relative(root, f)}:${i + 1}`);
      }
    });
  }
  ok("no canvas is painted with a colour it cannot read",
     offenders.length === 0, offenders.join("\n   "));
}

// ── The empty seat editor says why, in a colour you can see ───────────────
{
  const ed = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SeatLayoutEditor.tsx"), "utf8");
  const bg = /const EMPTY_CANVAS_BG = "(#[0-9a-f]{6})";/.exec(ed)?.[1];
  const fg = /const EMPTY_CANVAS_TEXT = "(#[0-9a-f]{6})";/.exec(ed)?.[1];
  ok("the box and the writing are both real colours", !!bg && !!fg, `${bg} / ${fg}`);
  ok("and they are not the same colour, which was the whole bug", bg !== fg);
  // Far enough apart to read. Plain brightness is enough to catch the
  // failure that happened, which was the two being identical.
  const bright = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  ok("and far enough apart to read", Math.abs(bright(bg) - bright(fg)) > 60,
     `${Math.round(bright(bg))} against ${Math.round(bright(fg))}`);
  ok("the message is broken into lines that fit the canvas",
     /ctx\.measureText\(next\)\.width > room/.test(ed)
     && /lines\.forEach\(\(text, i\) => ctx\.fillText\(text, canvas\.width \/ 2, top \+ i \* lineHeight\)\)/.test(ed));
  ok("and it still says the three things it can say",
     /Taking a picture from the camera…/.test(ed)
     && /This camera is off, so there is no picture to draw on/.test(ed)
     && /Upload a camera screenshot to begin/.test(ed));
}

// ── …and the map is drawn on a colour of its own ──────────────────────────
{
  const map = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SeatMap.tsx"), "utf8");
  ok("the seat map has a real background colour",
     /const MAP_BG = "#[0-9a-f]{6}";/.test(map) && /ctx\.fillStyle = MAP_BG;/.test(map));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A canvas is painted in colours it can read.");
process.exit(fails ? 1 : 0);
