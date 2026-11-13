/**
 * "a person does not need to sit down to show that thats there seat"
 *
 * When two cameras may be looking at one chair, Kyro asks "is this the same
 * person?" and shows whoever is at each of the two seats. The first version
 * of that used the rule that decides whether a seat is TAKEN — which is
 * strict on purpose, and refuses anybody standing, because people walk past
 * rows all morning and a count that believes them is wrong.
 *
 * For a picture that is the wrong rule. Somebody standing at their place
 * with their coat half off is plainly the person at that seat, and waiting
 * for them to sit meant the question often went unasked.
 *
 * The one thing the looser rule must still refuse is somebody on their way
 * past, because a picture of them put to somebody as "is this the same
 * person?" gets an honest "no" — and two cameras looking at one chair are
 * then told to go on counting it twice.
 *
 *   node tests/test_standing_at_your_seat.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-standing-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/seatFinder.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { SeatFinder, SEAT_W, SEAT_H } = await import(path.join(tmp, "seatFinder.js"));

/** A hall with one row of chairs, found the way the camera finds them. */
function hall() {
  const f = new SeatFinder("cam");
  const chairs = [];
  for (let i = 0; i < 5; i++) chairs.push([200 + i * 160, 380, 200 + i * 160 + 110, 470]);
  // Seen often enough to be settled as chairs rather than guesses.
  for (let t = 0; t < 40; t++) f.sawChairs(chairs, SEAT_W, SEAT_H, 1000 + t * 1000);
  for (let t = 0; t < 40; t++) f.decide(1000 + t * 1000);
  return { f, chairs };
}

const { f, chairs } = hall();
const seats = f.seats();
ok("the row is found", seats.length === 5, `${seats.length} seats`);
const mid = seats[2];

/** Where a person's box falls, given the chair they are at. */
const seated = (c) => [c[0] - 5, c[1] - 55, c[2] + 5, c[3] - 5];
// Standing is taller than the seat's own box, which is why the strict rule
// refuses it — a person half again as tall as the seat is in front of it,
// not in it.
const standing = (c) => [c[0] - 5, c[1] - 290, c[2] + 5, c[3] - 2];
const midChair = chairs[seats.findIndex((s) => s.seat_id === mid.seat_id)];

// ── 1. Sitting in it ──────────────────────────────────────────────────────
{
  const who = f.whoIsAt(mid.seat_id, [seated(midChair)], SEAT_W, SEAT_H, [9_000]);
  ok("1. somebody sitting in the seat is its person", who === 0, `${who}`);
}

// ── 2. Standing at it ─────────────────────────────────────────────────────
{
  const who = f.whoIsAt(mid.seat_id, [standing(midChair)], SEAT_W, SEAT_H, [9_000]);
  ok("2. and so is somebody standing at it", who === 0, `${who}`);
  // The strict rule, which decides whether the seat is TAKEN, still says no
  // — and must, or everybody walking a row fills it.
  const taken = f.whoIsWhere([standing(midChair)], SEAT_W, SEAT_H).personOfSeat.get(mid.seat_id);
  ok("2. …without that making the seat count as taken", taken === undefined, `${taken}`);
}

// ── 3. Walking past it ────────────────────────────────────────────────────
{
  const who = f.whoIsAt(mid.seat_id, [standing(midChair)], SEAT_W, SEAT_H, [200]);
  ok("3. somebody on their way past is not its person", who === null, `${who}`);
  ok("3. …nor is somebody striding through a row of empty chairs",
     f.whoIsAt(mid.seat_id, [seated(midChair)], SEAT_W, SEAT_H, [0]) === null);
  ok("3. …and a moment later, having stopped, they are",
     f.whoIsAt(mid.seat_id, [standing(midChair)], SEAT_W, SEAT_H, [4_000]) === 0);
}

// ── 4. The person in it beats the person walking in front of it ───────────
{
  const walker = standing([midChair[0] - 20, midChair[1], midChair[2] - 20, midChair[3]]);
  const who = f.whoIsAt(mid.seat_id, [walker, seated(midChair)], SEAT_W, SEAT_H, [100, 30_000]);
  ok("4. the one actually in it is chosen", who === 1, `${who}`);
}

// ── 5. Nobody there is nobody, not the nearest body in the hall ───────────
{
  const faraway = seated(chairs[0]);
  const who = f.whoIsAt(seats[4].seat_id, [faraway], SEAT_W, SEAT_H, [30_000]);
  ok("5. an empty seat has no person", who === null, `${who}`);
  ok("5. …and a seat Kyro has never heard of has none either",
     f.whoIsAt("K9999", [faraway], SEAT_W, SEAT_H, [30_000]) === null);
}

// ── 6. The church stands up to sing ───────────────────────────────────────
//
// "so what if somone is standing in from of their chair and there like
// worshipping for example"
//
// Everybody on their feet at their own chair, for half an hour. The rule
// that decides whether somebody is SITTING in a chair says no to every one
// of them — rightly, it has to — and the seat the person stood up from was
// held for forty-five seconds and then went green. So the seat map emptied
// the hall at the moment it was fullest.
{
  const { f: g, chairs: cs } = hall();
  const row = g.seats();
  const now = 100_000;
  const seatedAll = cs.map(seated);
  const standingAll = cs.map(standing);
  const still = cs.map(() => 30_000);

  // Sitting down: the hall fills.
  g.occupancy(seatedAll, SEAT_W, SEAT_H, now, still);
  const sat = g.occupancy(seatedAll, SEAT_W, SEAT_H, now + 5_000, still);
  ok("6. with everybody seated, every seat is taken",
     sat.filter(([, st]) => st === "occupied").length === row.length,
     JSON.stringify(sat.map(([, st]) => st)));

  // Everybody stands to sing, and stays up well past the forty-five seconds
  // a seat used to be held for.
  let up = g.occupancy(standingAll, SEAT_W, SEAT_H, now + 20_000, still);
  up = g.occupancy(standingAll, SEAT_W, SEAT_H, now + 10 * 60_000, still);
  ok("6. ten minutes into the singing, the hall is not empty",
     up.filter(([, st]) => st === "available").length === 0,
     JSON.stringify(up.map(([, st]) => st)));
  ok("6. every chair is still its person's",
     up.filter(([, st]) => st === "occupied").length === row.length,
     JSON.stringify(up.map(([, st]) => st)));

  // They sit back down. Nothing has been lost.
  const back = g.occupancy(seatedAll, SEAT_W, SEAT_H, now + 11 * 60_000, still);
  ok("6. and they are still there when they sit down again",
     back.filter(([, st]) => st === "occupied").length === row.length);
}

// ── 7. One person standing does not hold the whole row ────────────────────
{
  const { f: g, chairs: cs } = hall();
  const one = [standing(cs[2])];
  const now = 100_000;
  g.occupancy(one, SEAT_W, SEAT_H, now, [30_000]);
  const st = g.occupancy(one, SEAT_W, SEAT_H, now + 5_000, [30_000]);
  const held = st.filter(([, x]) => x === "occupied");
  ok("7. one person standing holds one chair", held.length === 1, JSON.stringify(st.map(([, x]) => x)));
  ok("7. and the rest of the row is free",
     st.filter(([, x]) => x === "available").length === g.seats().length - 1);
}

// ── 8. Somebody walking the row still empties nothing and fills nothing ───
{
  const { f: g, chairs: cs } = hall();
  const now = 100_000;
  const passer = [standing(cs[1])];
  g.occupancy(passer, SEAT_W, SEAT_H, now, [100]);
  const st = g.occupancy(passer, SEAT_W, SEAT_H, now + 5_000, [100]);
  ok("8. somebody on their way past fills nothing",
     st.every(([, x]) => x === "available"), JSON.stringify(st.map(([, x]) => x)));
}

// ── 9. The camera asks for the person at the seat, not the seat ───────────
{
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("9. the chair question crops whoever is at the seat",
     /if \(want\.seat && want\.who\)/.test(ctx) && /c\.seatFinder\.whoIsAt\(`K\$\{want\.seat\}`/.test(ctx));
  ok("9. telling it how long each person has stood still",
     /seen\.map\(\(x\) => x\.stillFor\)/.test(ctx));
  ok("9. and it is a kept picture of a person, not a crop of furniture",
     /const kept = c\.crops\.get\(seen\[pi\]\.track\);/.test(ctx));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
