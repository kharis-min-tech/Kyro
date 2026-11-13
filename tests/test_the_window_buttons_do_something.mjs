/**
 * "every time i change the table on my real data to 1 hour 2 hr and see the
 * data, nothing changes the numbers are still the same"
 *
 * Two separate things behind that, and only one of them is a bug in the
 * sums — which are fine, and are measured here to prove it.
 *
 *   · Two of the five figures ARE the whole day and cannot change. That is
 *     what "all day" means. The two that do change said so very quietly:
 *     "Busiest arrival time · 9:00 – 10:00 AM" becoming "8:00 – 10:00 AM"
 *     is one digit on a card full of digits, and the heading above it never
 *     moved at all. The window is now in the heading.
 *
 *   · And the Entries tile read 7,393 over the words "Nobody counted yet".
 *     The figure fell through to the cameras' tally of CROSSINGS when there
 *     was nothing better, while the line under it ran out of branches. The
 *     note in that file says crossings never appear in that tile. They did.
 *
 *   node tests/test_the_window_buttons_do_something.mjs
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
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-window-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/arrivals.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { bucketPeople, bucketArrivals } = await import(path.join(tmp, "arrivals.js"));

const SIZES = [15, 30, 60, 120, 180, 240];
const day = new Date(); day.setHours(8, 0, 0, 0);

/** A morning: a trickle from eight, a rush at nine, everyone out after twelve. */
const movement = (() => {
  const arrived = [], left = [];
  for (let i = 0; i < 20; i++) {
    const mins = i * 15;
    arrived.push(mins < 60 ? 20 : mins < 120 ? 60 : mins < 180 ? 5 : 0);
    left.push(mins >= 240 ? 70 : 0);
  }
  return { from: day.getTime(), minutes: 15, arrived, left };
})();
/** The same morning as a camera's running totals, read once a minute. */
const tallies = (() => {
  const pts = []; let inN = 0, outN = 0;
  for (let i = 0; i <= 300; i++) {
    inN += i < 60 ? 5 : i < 120 ? 15 : i < 180 ? 1 : 0;
    outN += i >= 240 ? 18 : 0;
    pts.push({ t: day.getTime() + i * 60_000, entries: inN, exits: outN });
  }
  return [pts];
})();

for (const [what, run] of [
  ["from the register of people", (m) => bucketPeople(movement, m)],
  ["from the cameras' own tallies", (m) => bucketArrivals(tallies, m)],
]) {
  const runs = SIZES.map((m) => ({ m, s: run(m) }));

  // ── 1. The window really does change the buckets ───────────────────────
  {
    const counts = runs.map((r) => r.s.slots.length);
    ok(`1. ${what}: a bigger window means fewer slots`,
       counts.every((n, i) => i === 0 || n <= counts[i - 1]) && counts[0] > counts[counts.length - 1],
       SIZES.map((m, i) => `${m}m:${counts[i]}`).join(" "));
    const peaks = runs.map((r) => r.s.peakArrival.arrived);
    ok(`1. ${what}: and a busiest window that holds more people`,
       peaks[peaks.length - 1] > peaks[0], SIZES.map((m, i) => `${m}m:${peaks[i]}`).join(" "));
  }

  // ── 2. …without changing the day's totals ──────────────────────────────
  //
  // These two are the figures she was watching, and they are RIGHT not to
  // move. Slicing a morning into different lengths cannot change how many
  // people came that morning.
  {
    const totals = runs.map((r) => r.s.totalArrived);
    ok(`2. ${what}: the day's arrivals are the same however it is sliced`,
       new Set(totals).size === 1, totals.join(" "));
    const out = runs.map((r) => r.s.totalLeft);
    ok(`2. ${what}: and so are the day's departures`, new Set(out).size === 1, out.join(" "));
  }

  // ── 3. Every window lands on its own hour ──────────────────────────────
  {
    const bad = runs.filter(({ m, s }) =>
      s.slots.some((sl) => { const d = new Date(sl.start); return (d.getHours() * 60 + d.getMinutes()) % m !== 0; }));
    ok(`3. ${what}: every slot starts on the window`, bad.length === 0,
       bad.map((b) => `${b.m}m`).join(" "));
  }
}

// ── 4. The card says which window it is showing ───────────────────────────
{
  const card = read("dashboard/src/components/ui/ArrivalTimes.tsx");
  ok("4. the window is named in words",
     /const windowName = minutes < 60 \? `\$\{minutes\} minutes` : minutes === 60 \? "hour" : `\$\{minutes \/ 60\} hours`;/.test(card));
  ok("4. and the busiest-window headings use it, so the button answers out loud",
     /label=\{`Busiest \$\{windowName\}`\}/.test(card)
     && /label=\{`Busiest \$\{windowName\} for leaving`\}/.test(card));
  ok("4. …which the fixed heading never did",
     !/label="Busiest arrival time"/.test(card) && !/label="Busiest exit time"/.test(card));
  // The two that cannot change still say they are the whole day.
  ok("4. and the two that cannot change still say they are the whole day",
     /Entries, all day/.test(card) && /Went out, all day/.test(card));
}

// ── 5. A figure and the words under it are one decision ───────────────────
//
// 7,393 over "Nobody counted yet" was two decisions disagreeing.
{
  const card = read("dashboard/src/components/ui/ArrivalTimes.tsx");
  ok("5. the Entries tile decides its figure and its words together",
     /const entries: \{ value: string; sub: string \}/.test(card)
     && /value=\{entries\.value\}/.test(card) && /sub=\{entries\.sub\}/.test(card));
  ok("5. and with nothing to show, shows nothing rather than a crossings tally",
     /: \{ value: "—", sub: "Nobody counted yet" \};/.test(card));
  // The note in that file has always said this. Now it is true.
  const decision = card.slice(card.indexOf("const entries:"), card.indexOf("Nobody counted yet\" };"));
  ok("5. crossings really are not in that tile any more",
     !/summary\.totalArrived/.test(decision), decision);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
