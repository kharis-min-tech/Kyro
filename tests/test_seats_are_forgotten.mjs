/**
 * Three hundred and seven seats in a bedroom.
 *
 * "there was no seats in my bedroom what are you talking about, i was just
 * sitting on my bed."
 *
 * Not one reading going wrong. Measured: a bed whose box wobbles a hundred
 * pixels between looks makes five; a person moving about a bed all
 * afternoon makes fifteen. Three hundred is the accumulation of EVERY spot
 * that ever qualified, over every session, kept in that browser for ever —
 * because a place that became a seat was never forgotten whatever happened
 * afterwards, and the camera had been moved around a room for days.
 *
 * Only "maybe" places were ever tidied. Chairs get moved, rooms get
 * rearranged, and a camera gets pointed somewhere else entirely.
 *
 *   node tests/test_seats_are_forgotten.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-forget-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/seatFinder.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { SeatFinder, SEAT_W, SEAT_H, SEAT_FORGET_MS } = await import(path.join(tmp, "seatFinder.js"));

const DAY = 86_400_000;
/** A room with a few chairs the AI can see plainly. */
function room(n = 4) {
  const f = new SeatFinder("hall");
  let t = 1000;
  const chairs = Array.from({ length: n }, (_, i) => [200 + i * 160, 380, 200 + i * 160 + 110, 470]);
  for (let i = 0; i < 20; i++) { t += 1000; f.sawChairs(chairs, SEAT_W, SEAT_H, t); f.decide(t); }
  return { f, at: t };
}

// ── 1. A seat nothing has been seen in for weeks is let go ────────────────
{
  const { f, at } = room();
  ok("1. the chairs are found", f.seats().length === 4, `${f.seats().length}`);
  f.decide(at + 7 * DAY);
  ok("1. a week later they are still seats", f.seats().length === 4, `${f.seats().length}`);
  f.decide(at + 14 * DAY);
  ok("1. a fortnight later too — a church counts on Sundays", f.seats().length === 4);
  f.decide(at + SEAT_FORGET_MS + DAY);
  ok("1. after three weeks of nothing, they are let go", f.seats().length === 0, `${f.seats().length}`);
}

// ── 2. …but not while they are still being seen ───────────────────────────
{
  const { f } = room();
  let t = 1000 + 20_000;
  const chairs = Array.from({ length: 4 }, (_, i) => [200 + i * 160, 380, 200 + i * 160 + 110, 470]);
  for (let week = 0; week < 10; week++) {
    t += 7 * DAY;
    f.sawChairs(chairs, SEAT_W, SEAT_H, t);
    f.decide(t);
  }
  ok("2. ten Sundays of use and they are all still there", f.seats().length === 4, `${f.seats().length}`);
}

// ── 3. A person's answer is never thrown away ─────────────────────────────
//
// The whole point of being asked is that the answer sticks.
{
  const { f, at } = room();
  const kept = f.seats()[0].seat_id;
  f.confirm(Number(kept.slice(1)));
  f.decide(at + SEAT_FORGET_MS + 10 * DAY);
  ok("3. the one somebody confirmed survives", f.seats().length === 1, `${f.seats().length}`);
  ok("3. and it is that one", f.seats()[0].seat_id === kept);
}

// ── 4. There is a way to forget them now ──────────────────────────────────
//
// There was none at all: 307 found in a bedroom and nothing could clear
// them.
{
  const { f } = room(6);
  f.confirm(Number(f.seats()[0].seat_id.slice(1)));
  const before = f.seats().length;
  const gone = f.forgetFound();
  ok("4. forgetting lets go of Kyro's own guesses", gone === before - 1, `${gone} of ${before}`);
  ok("4. and keeps what a person decided", f.seats().length === 1, `${f.seats().length}`);
  ok("4. and saying so twice forgets nothing more", f.forgetFound() === 0);
}

// ── 5. A save from before this still loads ────────────────────────────────
//
// Nobody's seats may vanish the moment this ships because their places
// never recorded when they were last seen.
{
  const old = JSON.stringify({ places: [
    { id: 1, box: [10, 10, 60, 90], checks: [1000], chairs: 5, status: "seat", tall: 0, seen: 9 },
  ], nextId: 2, stage: "top" });
  const f = new SeatFinder("hall");
  f.load(old);
  f.decide(Date.now());
  ok("5. an old save is not emptied on sight", f.seats().length === 1, `${f.seats().length}`);
  ok("5. and its clock starts now", (f.places[0].at ?? 0) > Date.now() - 60_000);
}

// ── 6. The button is on the page, where the wrong number is ───────────────
{
  const page = read("dashboard/src/app/live-cameras/page.tsx");
  ok("6. there is a way to forget them", /Forget the seats Kyro found here/.test(page));
  ok("6. beside the guess it is about", /Kyro thinks it can see about/.test(page));
  ok("6. and it says what it did", /Forgotten \$\{forgot\.toLocaleString\(\)\} — it will look again/.test(page));
  // Only on the computer doing the counting: the seats live in that browser.
  ok("6. offered only where the seats actually are",
     /const forgetKey = tileCount\(/.test(page) && /\{forgetKey && \(/.test(page));
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("6. and it is written down at once, not at the next report",
     /const gone = c\.seatFinder\.forgetFound\(\);[\s\S]{0,260}localStorage\.setItem\(`kyro_seats_\$\{c\.key\}`/.test(ctx));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
