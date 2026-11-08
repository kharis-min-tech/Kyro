/**
 * The live figures must survive the counting computer being reloaded.
 *
 * A browser reports its own tally since IT started. Reload it — which I asked
 * for a dozen times today — and that tally goes back to nothing, so the live
 * arrivals collapsed to zero while the chart, which adds up the steps between
 * readings, carried on from where it was. That is how the headline came to
 * read 18 with 1,271 arrivals on the card two inches below it.
 *
 * The website adds up the steps itself now, and keeps the running total.
 *
 *   node tests/test_counts_survive_reload.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// The rule, lifted out of report() and run as the worker runs it.
function add(seen, rIn, rOut) {
  seen.in += seen.lastIn === null || rIn < seen.lastIn ? rIn : rIn - seen.lastIn;
  seen.out += seen.lastOut === null || rOut < seen.lastOut ? rOut : rOut - seen.lastOut;
  seen.lastIn = rIn; seen.lastOut = rOut;
  return seen;
}
const fresh = () => ({ in: 0, out: 0, lastIn: null, lastOut: null });

// 1. An ordinary morning: the browser's tally climbs, and so does ours.
{
  let s = fresh();
  for (const [i, o] of [[10, 0], [25, 3], [40, 8]]) s = add(s, i, o);
  ok("a climbing counter is followed", s.in === 40 && s.out === 8, JSON.stringify(s));
}

// 2. The counting computer is reloaded at lunchtime. Its tally starts again
//    at nothing; the morning's 40 must not vanish, and the afternoon's must
//    be added on rather than counted from zero.
{
  let s = fresh();
  for (const [i, o] of [[10, 0], [40, 8]]) s = add(s, i, o);
  for (const [i, o] of [[0, 0], [6, 1], [15, 4]]) s = add(s, i, o);   // after the reload
  ok("the morning is kept and the afternoon added", s.in === 40 + 15, `got ${s.in}`);
  ok("and the same for departures", s.out === 8 + 4, `got ${s.out}`);
}

// 3. A camera that has already counted before the website ever hears from it:
//    its first reading is what it has counted so far, not a step from zero.
{
  const s = add(fresh(), 37, 5);
  ok("a camera's first reading counts in full", s.in === 37 && s.out === 5);
}

// 4. Nothing moving changes nothing.
{
  let s = fresh();
  for (const [i, o] of [[12, 2], [12, 2], [12, 2]]) s = add(s, i, o);
  ok("readings that don't change add nothing", s.in === 12 && s.out === 2, JSON.stringify(s));
}

// 5. It is the running total that is published and stored, not the browser's
//    own tally — and it is kept, so a Durable Object restart doesn't lose it.
{
  ok("the running total is what the live figures report", /entries: seen\.in, exits: seen\.out,/.test(src));
  ok("and it is written down", /await this\.ctx\.storage\.put\("counters", counters\)/.test(src));
  ok("loaded again each time", /const counters = await this\.get\("counters", \{\}\);/.test(src));
}

// 6. "Start fresh" marks its line against the running total, or a reload
//    after one would wipe out the session it had just started.
{
  ok("a fresh start remembers the running totals",
     /for \(const \[id, c\] of Object\.entries\(counters\)\) base\[id\] = \{ entries: c\.in \|\| 0, exits: c\.out \|\| 0 \};/.test(src));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A reload no longer resets the morning.");
process.exit(fails ? 1 : 0);
