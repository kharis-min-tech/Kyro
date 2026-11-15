/**
 * "wrong data" — a tile reading "Peak 30 · most at once, at 10:32", on a
 * day whose fullest moment, on another card, was eleven.
 *
 * Both figures were honest about what they are. The label was not.
 *
 * The big one is total_current: the LARGER of what the cameras can see and
 * how many have been counted in less those counted out. That is right and
 * deliberate — people sit in corners no camera covers, and a doorway's
 * arithmetic finds them where a picture cannot. But it is not a sighting.
 * It is a running belief about the building, and it inherits whatever is
 * wrong with the counting that feeds it: with the register inflated, the
 * belief inflates with it, and "most at once" became a figure larger than
 * the most anybody was ever actually seen.
 *
 * So the most that was ever IN SHOT at once is kept beside it. It cannot
 * exceed what a camera had in front of it, which makes it the one nobody
 * can argue with — and the page says so whenever the two disagree.
 *
 * Neither figure is changed. A number that cannot be defended says so; it
 * does not get quietly rewritten.
 *
 *   node tests/test_a_peak_says_how_many_were_in_shot.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const tile   = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");

// ── The two figures are different questions ───────────────────────────────
{
  ok("the big one is the larger of seen and counted, on purpose",
     /const hereNow = anyRunning \? Math\.min\(Math\.max\(seenNow, countedNet\), ceiling\) : 0;/.test(worker));
  ok("and it is what the peak is taken from", /const people = v\.total_current;/.test(worker));
  ok("the other is what was in shot", /const seen = v\.seen_now \?\? v\.total_current;/.test(worker));
  ok("…and it is now kept too",
     /this\.recentSeen = \[\.\.\.\(this\.recentSeen \?\? \[\]\)/.test(worker)
     && /if \(heldSeen > \(live\.peak_seen \?\? 0\)\) live\.peak_seen = heldSeen;/.test(worker));
  // Both must survive the same flicker rule: a number that held for a
  // moment is not a peak, which is why neither is taken straight from now.
  ok("both wait for the figure to hold before recording it",
     (worker.match(/at <= now - PEAK_HOLD_MS \/ 2/g) || []).length === 2,
     `${(worker.match(/at <= now - PEAK_HOLD_MS \/ 2/g) || []).length} of 2`);
  ok("and it is reported", /peak_seen: live\.peak_seen \?\? 0,/.test(worker));
}

// ── The arithmetic the warning rests on ───────────────────────────────────
// peak_seen can never be larger than peak, because peak is the max of seen
// and counted. If it ever were, the note below would be nonsense.
{
  const hereNow = (seenNow, countedNet, ceiling) => Math.min(Math.max(seenNow, countedNet), ceiling);
  for (const [seen, net, ceil] of [[11, 30, 600], [30, 11, 600], [11, 11, 600], [40, 5, 20]]) {
    const big = hereNow(seen, net, ceil);
    ok(`seen ${seen}, counted net ${net} → the believed figure is ${big}`,
       big >= Math.min(seen, ceil) || ceil < seen,
       `${big} against a sighting of ${seen}`);
  }
  // The case in the report: the cameras saw eleven, the arithmetic believed
  // thirty, and thirty is what went on the tile.
  ok("the reported case comes out as reported", hereNow(11, 30, 600) === 30);
}

// ── The page says which is which, only when they differ ───────────────────
{
  ok("the tile knows about the smaller figure", /peak_seen\?: number;/.test(tile));
  ok("it is shown only when the two disagree",
     /live\.peak_seen > 0 && live\.peak_seen < live\.peak/.test(tile));
  ok("and says plainly where the difference comes from",
     /were ever in shot at once — the rest is counted in, less counted out/.test(tile));
  ok("the big figure itself is untouched",
     /<p className="text-2xl font-bold text-white tabular-nums">\{live\.peak\}<\/p>/.test(tile));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A peak says how many were in shot.");
process.exit(fails ? 1 : 0);
