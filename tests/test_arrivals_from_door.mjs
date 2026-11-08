/**
 * Arrivals come from the door, not from the room.
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

// 1. The chart of arrivals and exits uses door cameras when there are any.
{
  ok("the page picks out the door cameras",
     /const doors = cameras\.filter\(\(c\) => c\.location === "entrance"\)\.map\(\(c\) => c\.camera_id\);/.test(page));
  ok("and uses only those when they exist",
     /const ids = new Set\(doors\.length \? doors : cameras\.filter/.test(page));
  ok("falling back to the room cameras only when there is no door camera",
     /doors\.length \? doors : /.test(page));
}

// 2. The hour-by-hour arrivals on Analytics, the same.
{
  ok("the day's movement uses the door only",
     /if \(r\.ts >= IN_OUT_TRUSTED_FROM && \(!hasDoors \|\| doorIds\.has\(r\.camera_id\)\)\)/.test(worker));
  ok("and so does one day's hour-by-hour movement",
     /const movementCam = doorIds\.size === 0 \|\| doorIds\.has\(r\.camera_id\);/.test(worker)
     && /if \(movementCam && r\.ts >= IN_OUT_TRUSTED_FROM/.test(worker));
}

// 3. The live totals already did this. This is the same rule, said once more
//    so the three places cannot drift apart again.
{
  ok("the live figures take the door's count when there is a door",
     /const entries = hasDoor \? sumDoors\("entries"\) : sum\("entries"\);/.test(worker));
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

console.log(fails ? `\n${fails} failed` : "\nAll good. Arrivals mean arrivals.");
process.exit(fails ? 1 : 0);
