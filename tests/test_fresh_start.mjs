/**
 * Starting the arrival and exit figures fresh for a new session.
 *
 * The thing being guarded against: a second service inherited the first one's
 * arrivals, so the afternoon opened with the morning's several hundred people
 * already "in" — and the only way anyone could think of to get a clean figure
 * was to delete the day's counts, which threw the morning away to tidy up the
 * afternoon.
 *
 * A fresh start deletes nothing. It remembers where each counter stood and
 * measures from there, and the whole day is still there to look at.
 *
 *   node tests/test_fresh_start.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");

// ── The worker's rule for "since the fresh start" ────────────────────────────
const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const from = src.indexOf("function sinceFresh(");
const to = src.indexOf("/**\n * One room's figures");
ok("the worker has a sinceFresh rule", from > 0 && to > from);
const sinceFresh = new Function(`${src.slice(from, to)}; return sinceFresh;`)();

// 1. The ordinary case: a camera computer that keeps counting through the
//    fresh start. 40 at the mark, 47 now = 7 this session.
ok("a running counter is measured from the mark", sinceFresh(47, 40) === 7);
ok("nothing has moved yet at the mark itself", sinceFresh(40, 40) === 0);
ok("no mark means everything counted", sinceFresh(47, 0) === 47 && sinceFresh(47, undefined) === 47);

// 2. A counter that reads LOWER than the mark started over (the browser
//    counter was put back to zero, or the computer restarted). Subtracting
//    would read as "nothing has happened" for the rest of the session — the
//    exact bug this rule exists to avoid.
ok("a counter that started over counts from itself", sinceFresh(5, 40) === 5,
   `got ${sinceFresh(5, 40)} (subtracting would have given a negative, clamped to nothing)`);
ok("and keeps counting up from there", sinceFresh(23, 40) === 23);

// ── Narrowing the chart to this session ─────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-fresh-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/arrivals.ts"),
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { bucketArrivals, sinceFreshStart } = await import(path.join(tmp, "arrivals.js"));
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const min = 60_000;
const t0 = new Date(2026, 10, 8, 9, 0, 0).getTime();   // 9:00 am
// A morning: 120 people in by 11:00. Then a fresh start at 12:00, and the
// browser counter goes back to zero and counts 30 more in the afternoon.
const morning = [
  { t: t0, entries: 0, exits: 0 },
  { t: t0 + 30 * min, entries: 60, exits: 0 },
  { t: t0 + 60 * min, entries: 100, exits: 2 },
  { t: t0 + 120 * min, entries: 120, exits: 115 },
];
const mark = t0 + 180 * min;                            // 12:00 — "start fresh"
const afternoon = [
  { t: mark + 10 * min, entries: 0, exits: 0 },
  { t: mark + 40 * min, entries: 30, exits: 1 },
];
const day = [[...morning, ...afternoon]];

// 3. The whole day is still the whole day.
{
  const all = bucketArrivals(day, 15);
  ok("the whole day still totals the morning and the afternoon", all.totalArrived === 150,
     `got ${all.totalArrived}`);
}

// 4. This session only: the afternoon's thirty, not the morning's hundred and
//    twenty on top.
{
  const session = bucketArrivals(sinceFreshStart(day, mark), 15);
  ok("this session counts only this session's arrivals", session.totalArrived === 30,
     `got ${session.totalArrived}`);
  ok("and its departures", session.totalLeft === 1, `got ${session.totalLeft}`);
  ok("nothing from the morning is in the session's bars",
     session.slots.every((s) => s.start >= mark));
}

// 5. A camera computer that did NOT put its own counter back to zero: the
//    reading before the mark is the starting point, so the session's figure is
//    still right and nobody is counted twice.
{
  const kept = [[...morning, { t: mark + 10 * min, entries: 150, exits: 116 }]];
  const session = bucketArrivals(sinceFreshStart(kept, mark), 15);
  ok("a counter that kept running still gives this session's arrivals", session.totalArrived === 30,
     `got ${session.totalArrived}`);
}

// 6. Nothing yet this session: empty, not the morning's figures.
{
  const session = bucketArrivals(sinceFreshStart([morning], mark), 15);
  ok("no readings since the fresh start means no figures, not the morning's", session.totalArrived === 0,
     `got ${session.totalArrived}`);
}

// 7. No fresh start at all: untouched.
{
  ok("without a fresh start the series is left alone", sinceFreshStart(day, null) === day);
}

// ── The counter in the browser ──────────────────────────────────────────────
// 8. Starting fresh must not blank the room. The people being followed are
//    kept, so "here now" holds and nobody sitting in the hall is counted as
//    having just walked in.
{
  const tr = new PersonTracker();
  const person = (x) => ({ box: [x, 100, x + 40, 300] });
  let now = 1_000_000;
  const three = [person(100), person(200), person(300)];
  for (let i = 0; i < 4; i++) { tr.update(three, now); now += 400; }
  // A room camera no longer answers "how many arrived" — it has no line for
  // anybody to cross, and saying it did is what produced "1 person on the
  // camera and 6 came in". What it answers is how many are in the room, and
  // that is what a fresh start must not blank.
  ok("a room camera counts nobody in", tr.entries === 0, `got ${tr.entries}`);
  const here = tr.update(three, now);
  ok("and three are here", here === 3, `got ${here}`);

  tr.resetCounts();
  ok("a fresh start puts the arrivals back to zero", tr.entries === 0);
  ok("and the departures", tr.exits === 0);
  now += 400;
  const stillHere = tr.update(three, now);
  ok("the three people in the room are still there", stillHere === 3, `got ${stillHere}`);
  ok("and are not counted as arriving again", tr.entries === 0, `got ${tr.entries}`);

  // One more person walks in afterwards. In a room that is one more person
  // in the room — not one arrival, because a room camera cannot tell an
  // arrival from somebody who was always there and has only just been seen.
  const four = [...three, person(400)];
  let now4 = 0;
  for (let i = 0; i < 4; i++) { now += 400; now4 = tr.update(four, now); }
  ok("someone arriving after the fresh start is in the room", now4 === 4, `got ${now4}`);
  ok("and is still not an arrival, because a room cannot tell", tr.entries === 0, `got ${tr.entries}`);
}

// 9. reset() is still the "new day" tool and still clears everything, so the
//    two are not confused.
{
  const tr = new PersonTracker();
  const three = [{ box: [1, 1, 41, 201] }, { box: [50, 1, 90, 201] }, { box: [99, 1, 139, 201] }];
  let now = 2_000_000;
  for (let i = 0; i < 4; i++) { tr.update(three, now); now += 400; }
  tr.reset();
  ok("reset() still forgets the people as well", tr.update([], now + 400) === 0 && tr.entries === 0);
}

// 10. It asks first. Starting fresh changes what every figure on the page
//     means for the rest of the session, and the button sits beside a row of
//     harmless ones — a stray click should not be the whole of it. Asked in
//     the page, not in one of the browser's own boxes: those appear for
//     reloads too, cannot say why they are asking, and teach people to click
//     through warnings without reading them.
{
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("the button asks before doing anything", /setFreshAsking\(true\)/.test(card));
  ok("the question says what it does",
     /Start the came in \/ went out figures from zero\?/.test(card));
  ok("and says nothing is deleted", /<strong>Nothing is deleted<\/strong>/.test(card));
  ok("there is a way to say yes", /Yes, start fresh/.test(card));
  ok("and a way to say no", /Cancel/.test(card));
  ok("only the yes actually starts fresh",
     /onFreshStart!\(false\)/.test(card) && !/onClick=\{async \(\) => \{\s*setFreshing\(true\); setFreshErr\(null\);\s*try \{ await onFreshStart\(\)/.test(card));
  // And a second, separate yes for the stronger one: putting the register of
  // people back to nobody, for when Kyro has counted the same person more
  // than once. Never the same button as the ordinary fresh start.
  ok("forgetting everyone is its own button", /onFreshStart!\(true\)/.test(card)
     && /Start again from nobody/.test(card));

  const services = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");
  ok("the Services page asks too", /setConfirmFresh\(true\)/.test(services)
     && /Start the came in \/ went out figures from zero\?/.test(services));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
