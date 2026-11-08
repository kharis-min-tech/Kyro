/**
 * Turning running totals into "how many came in, and when".
 *
 * The thing being guarded against: a reading of 55 means 55 since the camera
 * started, not 55 just now. Only the step between two readings is people
 * moving. The chart treated the FIRST reading as a step, so a camera's whole
 * history was charged to whichever quarter of an hour Kyro happened to start
 * looking — "55 people arrived, 12:15–12:30 PM" was a morning's arrivals
 * landing in one bar as if they had all walked in at once.
 *
 * It was made worse by withheld readings being read as zero: a morning of
 * zeroes then the first real reading looked like a leap from nothing to the
 * running total.
 *
 *   node tests/test_arrival_buckets.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-arr-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/arrivals.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { bucketArrivals } = await import(path.join(tmp, "arrivals.js"));

const T = Date.parse("2026-11-08T12:00:00Z");
const min = 60_000;
const pt = (mins, entries, exits) => ({ t: T + mins * min, entries, exits });

// 1. The bug, in the shape she saw it: Kyro starts looking at a camera whose
//    counter already reads 55, and nobody moves afterwards.
{
  const r = bucketArrivals([[pt(0, 55, 9), pt(5, 55, 9), pt(10, 55, 9)]], 15);
  ok("a camera already at 55 doesn't report 55 arrivals", r.totalArrived === 0,
     `got ${r.totalArrived}`);
  ok("nor 9 departures", r.totalLeft === 0, `got ${r.totalLeft}`);
}

// 2. Real movement after that first reading is counted, all of it.
{
  const r = bucketArrivals([[pt(0, 55, 9), pt(5, 58, 9), pt(10, 60, 12)]], 15);
  ok("five people arriving are counted", r.totalArrived === 5, `got ${r.totalArrived}`);
  ok("three leaving are counted", r.totalLeft === 3, `got ${r.totalLeft}`);
}

// 3. A camera that genuinely starts from nothing loses only what happened
//    before Kyro's first look — which is nothing.
{
  const r = bucketArrivals([[pt(0, 0, 0), pt(5, 4, 0), pt(10, 7, 2)]], 15);
  ok("a camera starting from zero counts everything after it", r.totalArrived === 7);
  ok("and its departures", r.totalLeft === 2);
}

// 4. A camera restarted mid-day: the counter drops, and the reading after the
//    drop is the step. It must not come out negative or be ignored.
{
  const r = bucketArrivals([[pt(0, 40, 10), pt(5, 46, 12), pt(10, 3, 1)]], 15);
  ok("a restart counts what came after it", r.totalArrived === 6 + 3, `got ${r.totalArrived}`);
  ok("and never goes backwards", r.totalLeft >= 0 && r.totalLeft === 2 + 1);
}

// 5. Two cameras are added together, each measured from its own first reading.
{
  const r = bucketArrivals([
    [pt(0, 55, 9), pt(10, 60, 9)],
    [pt(0, 500, 300), pt(10, 503, 300)],
  ], 15);
  ok("two cameras' movement adds up, their histories don't", r.totalArrived === 8,
     `got ${r.totalArrived} (counting the first readings would give 563)`);
}

// 6. The time it lands in is the time it happened, not the first reading's.
{
  const r = bucketArrivals([[pt(0, 0, 0), pt(20, 10, 0)]], 15);
  const busiest = r.slots.reduce((a, b) => (a.arrived > b.arrived ? a : b));
  ok("arrivals are charted when they happened",
     new Date(busiest.start).toISOString().slice(11, 16) === "12:15", new Date(busiest.start).toISOString());
}

// 7. One reading on its own says nothing about movement.
{
  const r = bucketArrivals([[pt(0, 55, 9)]], 15);
  ok("a single reading is a starting point, nothing more",
     r.totalArrived === 0 && r.totalLeft === 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. A running total is a starting point, not an arrival.");
process.exit(fails ? 1 : 0);
