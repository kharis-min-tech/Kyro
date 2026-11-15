/**
 * "this data is not correct" — a camera reading 7, with 38 as its busiest,
 * in a room that has never had more than eleven people in shot at once.
 *
 * The camera's busiest was the highest count ever seen in a single pass of
 * the AI, kept for ever:
 *
 *     c.peak = Math.max(c.peak, c.count);
 *
 * One bad look at the room sets it. A reflection in a window, a poster, a
 * face on a phone, motion blur splitting one person into two. The count
 * itself recovers on the very next pass — the live figure was right, 7 —
 * but the high-water mark it left behind never does, and it is what gets
 * reported as the busiest the room has been.
 *
 * The venue's own busiest figure has required a number to HOLD for ten
 * seconds since the day it was written, and says so in a comment beside
 * it. A camera's did not. Same rule now: keep the last ten seconds of
 * counts and take the lowest of them, so a figure only becomes the busiest
 * if it lasted.
 *
 * A real crowd lasts. A miscount does not.
 *
 *   node tests/test_busiest_needs_a_figure_that_held.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
const HOLD = Number(/const PEAK_HOLD_MS = ([0-9_]+);/.exec(ctx)?.[1].replace(/_/g, ""));

/**
 * The rule itself, run rather than read: counts arrive, and the busiest is
 * only raised by a figure that spanned the window.
 */
function busiest(counts, hold = HOLD) {
  let peak = 0, recent = [];
  for (const { at, n } of counts) {
    recent = [...recent.filter((x) => at - x.at <= hold), { at, n }];
    const spanned = recent[0].at <= at - hold / 2;
    const held = spanned ? Math.min(...recent.map((x) => x.n)) : 0;
    peak = Math.max(peak, held);
  }
  return peak;
}
/** A steady count of `n` for `secs` seconds, a reading every second. */
const steady = (from, secs, n) => Array.from({ length: secs }, (_, i) => ({ at: from + i * 1000, n }));

ok("the window is written down once", HOLD > 0, `${HOLD}`);

// ── A spike does not become the busiest ───────────────────────────────────
{
  // Seven people in the room for a minute, with one pass that saw 38.
  const day = [...steady(0, 30, 7)];
  day.splice(15, 0, { at: 15_500, n: 38 });
  ok("one bad pass of 38 does not become the busiest", busiest(day) === 7, `${busiest(day)}`);

  // …nor do several scattered ones.
  const flickery = [...steady(0, 60, 7)];
  for (const i of [10, 25, 40]) flickery.splice(i, 0, { at: i * 1000 + 500, n: 38 });
  ok("three scattered bad passes do not either", busiest(flickery) === 7, `${busiest(flickery)}`);
}

// ── A real crowd does ─────────────────────────────────────────────────────
{
  // Seven, then thirty-eight people really do come in and stay.
  const real = [...steady(0, 20, 7), ...steady(20_000, 30, 38)];
  ok("thirty-eight people who stay are the busiest", busiest(real) === 38, `${busiest(real)}`);

  // A crowd that lasts just over the window still counts.
  const brief = [...steady(0, 20, 7), ...steady(20_000, 12, 20), ...steady(32_000, 20, 7)];
  ok("a crowd that holds for twelve seconds counts", busiest(brief) === 20, `${busiest(brief)}`);
  // One that does not span the window does not.
  const tooBrief = [...steady(0, 20, 7), ...steady(20_000, 3, 20), ...steady(23_000, 20, 7)];
  ok("one that lasts three seconds does not", busiest(tooBrief) === 7, `${busiest(tooBrief)}`);
}

// ── A quiet room is not reported as busy ──────────────────────────────────
{
  ok("an empty room's busiest is nobody", busiest(steady(0, 30, 0)) === 0);
  ok("and a single reading proves nothing at all",
     busiest([{ at: 0, n: 38 }]) === 0, `${busiest([{ at: 0, n: 38 }])}`);
}

// ── It is the rule the code actually uses ─────────────────────────────────
{
  ok("the camera keeps its recent counts",
     /c\.recentCounts = \[\.\.\.c\.recentCounts\.filter\(\(x\) => at - x\.at <= PEAK_HOLD_MS\), \{ at, n: c\.count \}\];/.test(ctx));
  ok("and raises the busiest only by a figure that held",
     /const held = spanned \? Math\.min\(\.\.\.c\.recentCounts\.map\(\(x\) => x\.n\)\) : 0;/.test(ctx)
     && /c\.peak = Math\.max\(c\.peak, held\);/.test(ctx));
  ok("the old way is gone", !/c\.peak = Math\.max\(c\.peak, c\.count\);/.test(ctx));
  ok("a fresh start clears the window too, not just the figure",
     /c\.peak = c\.count; c\.recentCounts = \[\];/.test(ctx));
  // The live count is untouched: it was always right, and it is what the
  // room reads to know how many are in it now.
  ok("the live count itself is unchanged",
     /c\.count = c\.steady\.add\(c\.people\.length\);/.test(ctx));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Busiest means it lasted.");
process.exit(fails ? 1 : 0);
