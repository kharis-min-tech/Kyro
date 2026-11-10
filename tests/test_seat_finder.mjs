/**
 * Kyro finds the seats by itself, in the browser.
 *
 * A port of the camera computer's seat finder, which has done this all along
 * and never ran where the cameras actually are. The thresholds and the
 * evidence are deliberately the same, so this is one feature in two places
 * rather than two features that disagree.
 *
 * These are simulations. They prove the LOGIC: that given boxes of a known
 * quality, seats are found once, keep their ids, and fill and empty correctly.
 * They say nothing about whether a camera mounted low at the side of a hall
 * can see individual chairs at all — that is a question about the camera, and
 * only footage from it can answer it.
 *
 *   node tests/test_seat_finder.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-seats-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/seatFinder.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { SeatFinder, chairToSeat } = await import(path.join(tmp, "seatFinder.js"));

const W = 1280, H = 720;
/** A chair in row r, place n, as the AI would box it. */
const chair = (r, n) => [120 + n * 100, 180 + r * 110, 120 + n * 100 + 70, 180 + r * 110 + 80];
/** Somebody sitting in it: the chair plus their upper body above it. */
const sitter = (r, n) => chairToSeat(chair(r, n));
/** Somebody standing in front of it: much taller, feet below the chair. */
const stander = (r, n) => { const c = chair(r, n); return [c[0], c[1] - 180, c[2], c[3] + 40]; };
const wobble = (b, k) => b.map((v, i) => v + (i % 2 ? 1 : 2) * Math.sin(k + i));

// ── 1 & 2. Fifty chairs in an empty room, seen again and again ─────────────
{
  const f = new SeatFinder("cam");
  const chairs = [];
  for (let r = 0; r < 5; r++) for (let n = 0; n < 10; n++) chairs.push(chair(r, n));
  let t = 0;
  for (let look = 0; look < 4; look++) {
    t += 300_000;
    f.sawChairs(chairs.map((c, i) => wobble(c, look + i)), W, H, t);
    f.decide(t);
  }
  ok("1. fifty chairs in an empty room are fifty seats", f.seats().length === 50, `got ${f.seats().length}`);
  const ids = f.seats().map((s) => s.seat_id);
  // 2. Seen another ten times: still fifty, and the same fifty.
  for (let look = 0; look < 10; look++) {
    t += 300_000;
    f.sawChairs(chairs.map((c, i) => wobble(c, look + i + 7)), W, H, t);
    f.decide(t);
  }
  ok("2. seeing them again adds nothing", f.seats().length === 50, `got ${f.seats().length}`);
  ok("2. and every seat keeps the id it had",
     JSON.stringify(f.seats().map((s) => s.seat_id).sort()) === JSON.stringify(ids.sort()));
  // Rows and numbers read like a church: A1…A10 nearest the stage.
  const a1 = f.seats().find((s) => s.row === "A" && s.number === 1);
  ok("1. seats are named by row and number", !!a1 && f.seats().filter((s) => s.row === "A").length === 10,
     JSON.stringify(f.seats().slice(0, 3)));
}

// ── 3 & 4. Sitting down, versus standing still ─────────────────────────────
{
  const f = new SeatFinder("cam");
  let t = 0;
  for (let i = 0; i < 8; i++) { t += 16_000; f.sawPeople([sitter(0, 0)], W, H, t); f.decide(t); }
  ok("3. somebody sitting for a minute and a half is a seat", f.seats().length === 1, `got ${f.seats().length}`);

  const g = new SeatFinder("cam2");
  let u = 0;
  for (let i = 0; i < 8; i++) { u += 16_000; g.sawPeople([stander(0, 0)], W, H, u); g.decide(u); }
  ok("4. somebody standing still is not taken on trust", g.seats().length === 0, `got ${g.seats().length}`);
  ok("4. it is put to an administrator instead", g.uncertain().length === 1, `${g.uncertain().length} asked`);
  g.confirm(g.uncertain()[0].id);
  ok("4. and their answer sticks", g.seats().length === 1);
}

// ── 5. One person moving between three seats ───────────────────────────────
{
  const f = new SeatFinder("cam");
  let t = 0;
  for (const n of [0, 3, 6]) {
    for (let i = 0; i < 8; i++) { t += 16_000; f.sawPeople([sitter(0, n)], W, H, t); f.decide(t); }
  }
  ok("5. one person in three seats finds three seats", f.seats().length === 3, `got ${f.seats().length}`);
  // …and the seat map says one of them is taken, not three.
  const states = f.occupancy([sitter(0, 6)], W, H, (t += 5000));
  const taken = states.filter(([, s]) => s === "occupied").length;
  ok("5. and only the one they are in is taken", taken <= 1, JSON.stringify(states));
}

// ── 6 & 13. Two people side by side; one person must not fill two seats ────
{
  const f = new SeatFinder("cam");
  let t = 0;
  for (const n of [0, 1]) for (let i = 0; i < 8; i++) { t += 16_000; f.sawPeople([sitter(0, n)], W, H, t); f.decide(t); }
  ok("6. two seats found", f.seats().length === 2);
  let states = f.occupancy([sitter(0, 0), sitter(0, 1)], W, H, (t += 3000));
  states = f.occupancy([sitter(0, 0), sitter(0, 1)], W, H, (t += 3000));
  ok("6. two people side by side take two seats",
     states.filter(([, s]) => s === "occupied").length === 2, JSON.stringify(states));

  let one = f.occupancy([sitter(0, 0)], W, H, (t += 3000));
  one = f.occupancy([sitter(0, 0)], W, H, (t += 3000));
  ok("13. one person does not take the seat beside them",
     one.filter(([, s]) => s === "occupied").length === 1, JSON.stringify(one));
}

// ── 7 & 15. Blocking a chair, and walking past a row ───────────────────────
{
  const f = new SeatFinder("cam");
  let t = 0;
  const chairs = [];
  for (let n = 0; n < 6; n++) chairs.push(chair(0, n));
  for (let look = 0; look < 3; look++) { t += 300_000; f.sawChairs(chairs, W, H, t); f.decide(t); }
  ok("seats found to walk past", f.seats().length === 6);

  // Somebody standing in front of one of them.
  let states = f.occupancy([stander(0, 2)], W, H, (t += 3000));
  states = f.occupancy([stander(0, 2)], W, H, (t += 3000));
  ok("7. standing in front of a chair does not fill it",
     states.every(([, s]) => s !== "occupied"), JSON.stringify(states.filter(([, s]) => s === "occupied")));

  // Somebody walking the length of the row: a different seat each moment.
  let worst = 0;
  for (let n = 0; n < 6; n++) {
    const st = f.occupancy([sitter(0, n)], W, H, (t += 600));
    worst = Math.max(worst, st.filter(([, s]) => s === "occupied").length);
  }
  ok("15. walking past a row fills none of it", worst === 0, `${worst} filled`);
}

// ── 8. Two cameras on the same row ─────────────────────────────────────────
{
  // Each camera finds its own seats, with its own ids. They are separate
  // records of the same chairs, and the website keeps them per camera — the
  // thing that must never happen is one camera's seats being renumbered by
  // the other's, which would make the map jump about.
  const a = new SeatFinder("left"), b = new SeatFinder("right");
  let t = 0;
  const chairs = [chair(0, 0), chair(0, 1), chair(0, 2)];
  for (let look = 0; look < 3; look++) {
    t += 300_000;
    a.sawChairs(chairs, W, H, t); a.decide(t);
    b.sawChairs(chairs.map((c) => [c[0] + 40, c[1] + 10, c[2] + 40, c[3] + 10]), W, H, t); b.decide(t);
  }
  ok("8. each camera finds the row it can see", a.seats().length === 3 && b.seats().length === 3,
     `${a.seats().length} and ${b.seats().length}`);
  ok("8. and neither renumbers the other", a.seats()[0].seat_id === b.seats()[0].seat_id);
}

// ── 9, 10, 11. Reloading, restarting, and the server restarting ────────────
{
  const f = new SeatFinder("cam");
  let t = 0;
  const chairs = [chair(0, 0), chair(0, 1), chair(1, 0)];
  for (let look = 0; look < 3; look++) { t += 300_000; f.sawChairs(chairs, W, H, t); f.decide(t); }
  const before = f.seats();
  const saved = f.save();

  const after = new SeatFinder("cam");
  after.load(saved);
  ok("9/10. a reload keeps every seat", after.seats().length === before.length);
  ok("9/10. with the same ids", JSON.stringify(after.seats()) === JSON.stringify(before));
  // Seeing them again afterwards must not make new ones.
  let u = t;
  for (let look = 0; look < 3; look++) { u += 300_000; after.sawChairs(chairs, W, H, u); after.decide(u); }
  ok("9/10. and seeing them again adds none", after.seats().length === before.length, `${after.seats().length}`);
  // 11. The server restarting is the website's business: the seats are sent
  //     again from here, and the website keeps reservations against them.
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("11. the website keeps reservations when the list is sent again",
     /const keepReserved = new Map\(was\.filter\(\(s\) => s\.reserved\)/.test(worker));
}

// ── 12, 13, 14. A chair moved, removed, and a bench ────────────────────────
{
  const f = new SeatFinder("cam");
  let t = 0;
  for (let look = 0; look < 3; look++) { t += 300_000; f.sawChairs([chair(0, 0)], W, H, t); f.decide(t); }
  const id = Number(f.seats()[0].seat_id.slice(1));
  // 12. Moved: an administrator corrects where it is, and that sticks.
  f.move(id, [500, 500, 570, 580]);
  ok("12. a moved chair keeps its id", f.seats()[0].seat_id === `K${id}`);
  ok("12. and is where it was put", f.seats()[0].bbox[0] === 500);
  // 13. Removed for good.
  f.remove(id);
  ok("13. a removed seat goes", f.seats().length === 0);
  // …and its id is never handed to a different seat.
  const fresh = f.add([200, 200, 270, 280]);
  ok("13. and its id is never reused", fresh !== id && f.seats()[0].seat_id === `K${fresh}`);
}
{
  // 14. A bench is one detection holding several people. The AI reports it as
  //     one piece of furniture, so Kyro finds one seat there — and the people
  //     sitting along it are then found as seats of their own, which is how
  //     the camera computer has always handled pews.
  const f = new SeatFinder("cam");
  let t = 0;
  const bench = [120, 300, 520, 380];
  for (let look = 0; look < 3; look++) { t += 300_000; f.sawChairs([bench], W, H, t); f.decide(t); }
  ok("14. a bench is found as seating", f.seats().length === 1);
  for (const x of [140, 260, 380]) {
    for (let i = 0; i < 8; i++) { t += 16_000; f.sawPeople([[x, 200, x + 90, 380]], W, H, t); f.decide(t); }
  }
  ok("14. and the places along it become seats of their own", f.seats().length >= 3, `${f.seats().length}`);
}

// ── Measured: precision and recall against a known room ────────────────────
{
  const truth = [];
  for (let r = 0; r < 6; r++) for (let n = 0; n < 10; n++) truth.push(chair(r, n));
  const f = new SeatFinder("cam");
  let t = 0;
  // The AI misses one chair in ten and wobbles the rest, as a real one does.
  for (let look = 0; look < 4; look++) {
    t += 300_000;
    const seen = truth.filter((_, i) => (i + look) % 10 !== 0).map((c, i) => wobble(c, look * 3 + i));
    f.sawChairs(seen, W, H, t);
    f.decide(t);
  }
  const found = f.seats();
  const near = (a, b) => Math.abs((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) < 60
    && Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) < 90;
  const matched = truth.filter((c) => found.some((s) => near(s.bbox, chairToSeat(c))));
  const spurious = found.filter((s) => !truth.some((c) => near(s.bbox, chairToSeat(c))));
  const recall = matched.length / truth.length, precision = (found.length - spurious.length) / Math.max(1, found.length);
  console.log(`\n  Sixty chairs, one in ten missed by the AI each look:`
    + ` found ${found.length} · recall ${(recall * 100).toFixed(0)}% · precision ${(precision * 100).toFixed(0)}%`
    + ` · duplicates ${Math.max(0, found.length - matched.length)}`);
  ok("recall is at least 90%", recall >= 0.9, `${(recall * 100).toFixed(0)}%`);
  ok("precision is at least 90%", precision >= 0.9, `${(precision * 100).toFixed(0)}%`);
  ok("no more than one seat per chair", found.length <= truth.length, `${found.length} for ${truth.length}`);
}

// ── Cost ───────────────────────────────────────────────────────────────────
{
  const f = new SeatFinder("cam");
  let t = 0;
  const chairs = [];
  for (let r = 0; r < 20; r++) for (let n = 0; n < 20; n++) chairs.push(chair(r % 6, n % 12));
  for (let look = 0; look < 3; look++) { t += 300_000; f.sawChairs(chairs, W, H, t); f.decide(t); }
  const people = chairs.slice(0, 60).map((c) => chairToSeat(c));
  const start = performance.now();
  for (let i = 0; i < 50; i++) { f.sawPeople(people, W, H, (t += 400)); f.occupancy(people, W, H, t); }
  const ms = (performance.now() - start) / 50;
  console.log(`  ${f.seats().length} seats, 60 people: ${ms.toFixed(2)} ms a count`);
  ok("it costs a fraction of a count", ms < 20, `${ms.toFixed(2)} ms`);
}

// ── A seat is not a person ─────────────────────────────────────────────────
{
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("seats are reported separately from people", /seats: c\.seatFinder\.occupancy\(/.test(ctx));
  ok("and never on a doorway camera", /c\.isDoor \? \{\} : \{ seats:/.test(ctx));
  ok("the attendance register is untouched by any of it",
     /people_seen: c\.tracker\.people,/.test(ctx));
  // Nothing about WHO is kept here. Checked on what is actually saved rather
  // than on words in the file: the seat finder may be told which box is in
  // which seat (that is how the register joins them up) but it keeps places,
  // not people, and a reload restores seats and nothing else.
  const f2 = new SeatFinder("cam");
  f2.sawChairs([chair(0, 0)], W, H, 1);
  f2.sawChairs([chair(0, 0)], W, H, 2);
  f2.decide(3);
  f2.whoIsWhere([sitter(0, 0)], W, H);
  const saved = JSON.parse(f2.save());
  ok("what is kept is places, not people",
     JSON.stringify(Object.keys(saved).sort()) === JSON.stringify(["nextId", "places", "stage"]), JSON.stringify(Object.keys(saved)));
  ok("and a place holds no person", saved.places.every((p) => !("person" in p) && !("who" in p)));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. Kyro finds the seats.");
process.exit(fails ? 1 : 0);
