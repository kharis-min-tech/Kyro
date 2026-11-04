/**
 * Arrivals and departures.
 *
 * Ruth, alone in front of one camera, was shown "19 in and outs". The cause was
 * that Kyro worked arrivals out from how the number in the room changed between
 * one minute and the next, so every wobble in the AI count became a person
 * arriving and another leaving. This checks the replacement — countedMovement,
 * which reads each camera's own running totals.
 *
 *   node tests/test_in_out.mjs
 */
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "../worker/venue.js"), "utf8");
const from = src.indexOf("function countedMovement(");
const code = src.slice(from, src.indexOf("\n}\n", from) + 2);
const countedMovement = new Function(`${code}; return countedMovement;`)();

let fails = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`✗ ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
};

/** Feeds readings through it the way the two reports do. */
function totals(readings) {
  const counters = new Map(), arrivals = new Array(24).fill(0), departures = new Array(24).fill(0);
  let known = false;
  for (const r of readings) {
    if (countedMovement(counters, r, arrivals, departures, r.hour ?? 10)) known = true;
  }
  return { in: arrivals.reduce((a, b) => a + b, 0), out: departures.reduce((a, b) => a + b, 0), known };
}
const cam = (entries, exits, hour = 10, camera_id = "cam1") => ({ camera_id, entries, exits, hour });

// ── Ruth's case ─────────────────────────────────────────────────────────────
// She is there before counting starts and never moves. Her camera's tracker
// reports 1 arrival (her, when counting began) and never changes.
is("one person who never moves: nothing came or went",
  totals([cam(1, 0), cam(1, 0), cam(1, 0), cam(1, 0), cam(1, 0)]), { in: 0, out: 0, known: true });

// The AI count wobbling between 1 and 3 must change nothing, because the
// tracker's totals don't move. This is the exact bug she reported.
const wobble = [1, 2, 2, 1, 3, 2, 1, 1, 2, 3, 2, 1].map(() => cam(1, 0));
is("a wobbling count invents no arrivals", totals(wobble), { in: 0, out: 0, known: true });

// ── Real movement is still counted ──────────────────────────────────────────
is("four people arrive over the morning",
  totals([cam(1, 0), cam(2, 0), cam(3, 0), cam(5, 0)]), { in: 4, out: 0, known: true });
is("people leaving are counted",
  totals([cam(5, 0), cam(5, 2), cam(5, 3)]), { in: 0, out: 3, known: true });
is("arrivals and departures together",
  totals([cam(10, 1), cam(14, 3), cam(14, 9)]), { in: 4, out: 8, known: true });

// ── Restarts must not invent a crowd ────────────────────────────────────────
// A reload gives the camera a fresh tracker starting at 0 again.
is("a reload adds nothing",
  totals([cam(1, 0), cam(4, 1), cam(1, 0), cam(1, 0)]), { in: 3, out: 1, known: true });
is("counting restarted twice, nobody moved",
  totals([cam(1, 0), cam(1, 0), cam(1, 0), cam(1, 0), cam(1, 0), cam(1, 0)]), { in: 0, out: 0, known: true });
is("arrivals after a restart still count",
  totals([cam(6, 2), cam(1, 0), cam(3, 0)]), { in: 2, out: 0, known: true });

// ── Several cameras are kept apart ──────────────────────────────────────────
is("two cameras don't bleed into each other",
  totals([cam(1, 0, 10, "a"), cam(1, 0, 10, "b"), cam(3, 0, 10, "a"), cam(2, 0, 10, "b")]),
  { in: 3, out: 0, known: true });

// ── Nothing to compare against yet ──────────────────────────────────────────
is("a single reading gives no movement figure", totals([cam(1, 0)]), { in: 0, out: 0, known: false });
is("no readings at all", totals([]), { in: 0, out: 0, known: false });

// ── Rubbish in the column can't produce rubbish out ─────────────────────────
is("missing values are treated as none",
  totals([{ camera_id: "a" }, { camera_id: "a", entries: 2 }]), { in: 2, out: 0, known: true });
is("a negative value can't subtract",
  totals([cam(5, 0), cam(-3, 0), cam(1, 0)]), { in: 1, out: 0, known: true });
is("a nonsense value can't add",
  totals([cam(1, 0), cam("rubbish", 0), cam(2, 0)]), { in: 2, out: 0, known: true });

// ── The hour each movement lands in ─────────────────────────────────────────
{
  const counters = new Map(), arrivals = new Array(24).fill(0), departures = new Array(24).fill(0);
  countedMovement(counters, cam(1, 0), arrivals, departures, 9);
  countedMovement(counters, cam(4, 0), arrivals, departures, 10);
  countedMovement(counters, cam(4, 3), arrivals, departures, 11);
  is("movements land in the right hour", [arrivals[9], arrivals[10], departures[11]], [0, 3, 3]);
}

// ── What she would have been shown, before and after ────────────────────────
const minutes = [1,1,2,2,1,1,2,3,2,1,1,1,2,2,3,2,2,1,1,2,1,1,2,2,1,2,3,3,2,1,1,1,2,1,1,2,2,1,1,1];
let a = 0, d = 0, prev = 0;
for (const n of minutes) { if (n > prev) a += n - prev; else if (n < prev) d += prev - n; prev = n; }
const after = totals(minutes.map(() => cam(1, 0)));
console.log(`\nHer 40 minutes, alone, with the count wobbling 1–3:`);
console.log(`  the old way: ${a} in, ${d} out  (${a + d} "in and outs")`);
console.log(`  now:         ${after.in} in, ${after.out} out`);
is("the old way was wrong", a + d > 15, true);
is("the new way is right", [after.in, after.out], [0, 0]);

console.log(fails ? `\n${fails} FAILED` : "\nAll passed");
process.exit(fails ? 1 : 0);
