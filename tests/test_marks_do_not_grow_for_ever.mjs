/**
 * "We have already asked about this" is kept on purpose, and must still end.
 *
 * Found by sweeping, not by being told. Kyro keeps a note of every seat it
 * has put a question about and every pair of chairs it has proposed, so a
 * hall of a hundred chairs does not become a hundred questions a week. Both
 * notes only ever gained entries.
 *
 *     seats_asked  900 seats × 4 cameras = 3,600 marks → 130 KB ✗
 *     chairs_asked 3,000 pairs                         → 173 KB ✗
 *
 * One stored value holds 128 KB. Past that the write throws — inside the
 * report, which is the same shape that broke the doorway's memory at three
 * hundred people and took every camera on that computer down with it.
 *
 *   node tests/test_marks_do_not_grow_for_ever.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const worker = read("worker/venue.js");
const LIMIT = 131_072;

// ── 1. Both lists are trimmed where they are written ──────────────────────
{
  for (const key of ["seats_asked", "chairs_asked"]) {
    const writes = [...worker.matchAll(new RegExp(`storage\\.put\\("${key}", ([^;]*?)\\);`, "g"))].map((m) => m[1]);
    ok(`1. every write of ${key} is trimmed (${writes.length})`,
       writes.length > 0 && writes.every((w) => /trimMarks\(/.test(w)), writes.join(" | "));
  }
  ok("1. and trimming keeps the newest", /newest = keys\.sort\(\(a, b\) => \(marks\[b\] \|\| 0\) - \(marks\[a\] \|\| 0\)\)/.test(worker));
}

// ── 2. The cap is inside what a stored value holds ────────────────────────
{
  const most = Number(/const MOST_ASKED_MARKS = (\d+);/.exec(worker)?.[1]);
  ok("2. the cap is written down", Number.isFinite(most), `${most}`);
  // A key and a timestamp, as they really are.
  const one = JSON.stringify({ "web-a1b2c3:usb-0#K123|web-a1b2c3:usb-1#K456": 1763148000000 }).length - 2;
  const bytes = most * one;
  // Not merely under the limit: under it with room for a longer key than
  // the one measured here. A tenth to spare is not headroom.
  ok(`2. ${most} marks is ${Math.round(bytes / 1024)} KB, with room to spare in the ${Math.round(LIMIT / 1024)} KB a value holds`,
     bytes < LIMIT * 0.65, `${bytes} bytes, ${Math.round((1 - bytes / LIMIT) * 100)}% spare`);
  /**
   * …and bigger than any real building will fill, or chairs start being
   * asked about twice.
   *
   * These mark what has been ASKED about, not what exists: a seat is only
   * marked when Kyro could not settle it, three at a time, and a pair only
   * when it was actually proposed. Twelve hundred of those is far past what
   * a cathedral produces in years.
   */
  ok("2. and far more than a building will ever ask about", most >= 1000, `${most}`);
}

// ── 3. trimMarks does what it says ────────────────────────────────────────
{
  const src = worker.slice(worker.indexOf("function trimMarks(marks, most) {"));
  const body = src.slice(0, src.indexOf("\n}") + 2);
  const trimMarks = new Function(`${body}; return trimMarks;`)();
  const marks = {};
  for (let i = 0; i < 100; i++) marks[`k${i}`] = 1000 + i;   // oldest first
  const out = trimMarks(marks, 10);
  ok("3. it keeps the cap", Object.keys(out).length === 10, `${Object.keys(out).length}`);
  ok("3. and keeps the newest", out.k99 === 1099 && out.k90 === 1090 && out.k89 === undefined);
  ok("3. a list under the cap is untouched", trimMarks({ a: 1, b: 2 }, 10).b === 2);
}

// ── 4. Asking must never take the counting down with it ───────────────────
//
// The worst a failure in the asking can do on its own is leave a chair
// unasked about. A report that fails takes every camera on that computer.
{
  for (const [what, call] of [
    ["chairs it isn't sure of", "askAboutSeats\\(seatAsks, cams, now\\)"],
    ["whether two seats are one chair", "askAboutSameChair\\(cams, now\\)"],
    ["whether its seat count is right", "askAboutSeatCount\\(cams"],
  ]) {
    const re = new RegExp(`try \\{[\\s\\S]{0,260}${call}[\\s\\S]{0,160}?\\} catch`);
    ok(`4. asking about ${what} cannot fail a report`, re.test(worker));
  }
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
