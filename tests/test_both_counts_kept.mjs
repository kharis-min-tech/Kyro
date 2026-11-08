/**
 * Nobody's numbers get deleted to make a point.
 *
 * What was reported: "it went from 811 to 824 to 831 — people that have been
 * here for more than 2 hours have been duplicated, it's as if when one person
 * comes in you count +10."
 *
 * Nobody was being counted ten times at the door. The arrivals figure was
 * adding up EVERY camera's "entries", and a room camera's entries are not
 * arrivals at all: that number counts each person the room camera becomes sure
 * of, and over two hours of people standing up, turning round, leaning
 * forward, and being hidden behind whoever is in front of them, it becomes
 * sure of the same congregation again and again. A camera watching two hundred
 * seated people will happily produce eight hundred "entries" in an afternoon
 * without a single new person walking in.
 *
 * With a camera on the door, only the door's count means "somebody arrived".
 *
 *   node tests/test_arrivals_from_door.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// 1. No camera's figure is thrown away.
//
//    I narrowed arrivals to the door cameras, on the reasoning that a room
//    camera's "entries" counts people it becomes sure of rather than people
//    arriving. The reasoning may still be right. The effect was not: on an
//    afternoon when about 900 people were in the building, it replaced the
//    room camera's 843 with the doorway camera's 106 — the doorway camera
//    being the one known to be too slow to follow anybody through a door.
//
//    Deciding which of a church's own numbers to delete is not mine to make
//    quietly. Every counting camera is included, and each one's figures are
//    shown beside the total.
{
  ok("every counting camera is included",
     /const ids = new Set\(cameras\.filter\(\(c\) => c\.location !== "queue"\)\.map\(\(c\) => c\.camera_id\)\);/.test(page));
  ok("each camera's own figures are worked out", /edgeCounterSeriesByCamera\(mine, true\)/.test(page));
  ok("and handed to the card", /byCamera=\{arrivalByCamera\}/.test(page));
}

// 2. The card shows them camera by camera, saying which is on the door.
{
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("the breakdown is shown when there is more than one camera",
     /byCamera && byCamera\.length > 1/.test(card));
  ok("it says where each camera is pointed", /on the entrance/.test(page) && /on the room/.test(page));
  ok("and says the two measure different things",
     /they measure different things/.test(card));
}

// 3. Analytics keeps what the cameras saw, and offers the door's net beside
//    it rather than instead of it.
{
  ok("the day's attendance is still what the cameras saw",
     /if \(!cur \|\| total > cur\.peak\) byDay\.set\(d, \{ peak: total, capacity: cap, at: r\.ts, door: doorNet \}\)/.test(worker));
  ok("the door's own figure is carried alongside", /door_attendance: v\.door \|\| 0,/.test(worker));
  ok("and the hour-by-hour arrivals use every camera again",
     !/const movementCam = /.test(worker));
}

// ── Why the door camera was too slow to be used at all ──────────────────────

const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const engine = fs.readFileSync(path.join(root, "dashboard/src/lib/countEngine.ts"), "utf8");
const wrk = fs.readFileSync(path.join(root, "dashboard/src/lib/countWorker.ts"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");

// 4. Every per-camera setting was being dropped on the way to the worker, so
//    "don't split a doorway picture into tiles" quietly did nothing.
{
  ok("the page sends how many tiles to use", /worker\.postMessage\(\{ type: "count", id, tiles, fast,/.test(cam));
  ok("and the worker uses it", /countWith\(engine, m\.px, m\.tiles, m\.fast\)/.test(wrk));
}

// 5. A doorway camera uses the quicker AI. The accurate one looks at 1280
//    pixels square and takes about half a second a look — one or two counts a
//    second, and a person crosses a door in less than that.
{
  ok("the engine can hold the quick AI alongside the accurate one",
     /fast\?: \{ run: RunModel; tiles: number \| "auto"; size: number \};/.test(engine));
  ok("it is kept when the accurate AI takes over", /fast: \{ run: l\.run, tiles: l\.m\.tiles, size: l\.m\.size \},/.test(engine));
  ok("and loaded on demand for a computer that went straight to the accurate one",
     /export async function ensureFast/.test(engine) && /ensureFast\(engine\)/.test(wrk));
  ok("counting never waits for that download", /count with what we have meanwhile/.test(wrk));
  ok("a doorway camera asks for it", /countPeople\(engine\.current, px, useTiles \? undefined : 1, c\.isDoor\)/.test(ctx));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Every camera's figure is kept, and named.");
process.exit(fails ? 1 : 0);
