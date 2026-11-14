/**
 * Ten people through one doorway came out as two.
 *
 * Reported as: "still a lot of hiiden bugs even when testing people and
 * counting in and out".
 *
 * A doorway is the one place in a church where everybody stands in the same
 * patch of picture, one after another, a few seconds apart. The tracker
 * claimed a new box for an existing person on position alone for fifteen
 * seconds — so the second person through the door inherited the first
 * person's track, and the first person's appearance was written over by the
 * second. Ten people in, two counted.
 *
 * Measured, ten people walking in one at a time:
 *
 *                              before      after
 *     head-on, dressed differently   2/10      10/10
 *     head-on, identical robes       2/10      10/10
 *     side-on, identical robes       3/10      10/10
 *
 * Two things fixed it, and this test holds both:
 *
 *   · a plainly different coat refuses a claim made on position alone;
 *   · and at a DOORWAY the position window is two seconds, not fifteen.
 *     Two seconds is what it is actually for — the detector losing somebody
 *     for a frame or two mid-crossing. Fifteen is a queue.
 *
 * The window is shortened ONLY at a door, and only on the pairing step. A
 * room camera keeps fifteen seconds, because there "the same place" really
 * does mean the same person bending down to pick up a hymn book. The other
 * positional path — reviving a track whose person was lost and found again
 * in the same spot — keeps fifteen seconds everywhere: shortening that one
 * was tried and counted a lone person lost for three seconds as two people.
 *
 *   node tests/test_a_queue_through_one_door.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-queue-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const lookOf = (i) => ({ top: [(i * 53 % 255) / 255, (i * 97 % 255) / 255, (i * 29 % 255) / 255],
  bottom: [(i * 131 % 255) / 255, (i * 17 % 255) / 255, (i * 211 % 255) / 255],
  shape: 2.2 + (i % 7) * 0.12, height: 0.4 + (i % 5) * 0.05 });
const robes = () => ({ top: [0.12, 0.14, 0.28], bottom: [0.10, 0.11, 0.22], shape: 2.5, height: 0.45 });
const see = (tr, boxes, t, looks) =>
  tr.update(boxes.map((b) => ({ box: b, score: 0.9 })), t, undefined, looks);

/** Walking towards the camera: the box grows and comes down the picture. */
function walkIn(tr, look, startT, lane) {
  let time = startT;
  for (let f = 0; f < 7; f++) {
    const k = f / 6, h = 400 * (0.35 + k * 0.5), w = h * 0.4, cy = 360 + k * 80;
    time += 1000 / 6;
    see(tr, [[lane - w / 2, cy - h / 2, lane + w / 2, cy + h / 2]], time, [look]);
  }
  return time;
}

/** Walking across the doorway: never changes size, only where it is. */
function walkAcross(tr, look, startT) {
  let time = startT, h = 380, w = h * 0.4;
  for (let f = 0; f < 20; f++) {
    const cx = 380 + (f / 19) * 520;
    time += 1000 / 6;
    see(tr, [[cx - w / 2, 360 - h / 2, cx + w / 2, 360 + h / 2]], time, [look]);
  }
  return time;
}

function queue({ gapS, uniform, sideOn }) {
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway(sideOn ? "right" : "closer");
  let time = 1000;
  for (let i = 0; i < 10; i++) {
    const look = uniform ? robes() : lookOf(i);
    time = sideOn ? walkAcross(tr, look, time) : walkIn(tr, look, time, 640);
    time += gapS * 1000;
    see(tr, [], time, []);
  }
  time += 20_000;             // past DOOR_DECIDE_MS, so everybody is tallied
  see(tr, [], time, []);
  return tr.entries;
}

// ── Ten people, one at a time, through the same doorway ───────────────────
for (const gapS of [2, 5, 10]) {
  ok(`ten walk in ${gapS}s apart, dressed differently → all ten counted`,
     queue({ gapS }) === 10, `counted ${queue({ gapS })}`);
  ok(`ten walk in ${gapS}s apart in identical robes → all ten counted`,
     queue({ gapS, uniform: true }) === 10, `counted ${queue({ gapS, uniform: true })}`);
  ok(`ten cross the door sideways ${gapS}s apart in identical robes → all ten`,
     queue({ gapS, uniform: true, sideOn: true }) === 10,
     `counted ${queue({ gapS, uniform: true, sideOn: true })}`);
}

// ── …without losing the thing the window is FOR ───────────────────────────
// One person walks in and the detector drops them for a few seconds while
// they stand in the doorway, then finds them again in the same spot. That is
// one person, however long the gap.
{
  const blink = (outFor) => {
    const tr = new PersonTracker("door", true);
    tr.watchesDoorway("closer");
    const coat = robes(), h = 400 * 0.85, w = h * 0.4;
    let time = walkIn(tr, coat, 1000, 640);
    const box = [640 - w / 2, 440 - h / 2, 640 + w / 2, 440 + h / 2];
    time += outFor;
    see(tr, [], time, []);
    for (let f = 0; f < 4; f++) { time += 166; see(tr, [box], time, [coat]); }
    time += 20_000;
    see(tr, [], time, []);
    return tr.people;
  };
  for (const s of [0.5, 1, 3, 8, 14]) {
    ok(`lost in the doorway for ${s}s and found again → still one person`,
       blink(s * 1000) === 1, `counted ${blink(s * 1000)}`);
  }
}

// ── And a room camera is untouched ────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("the short window is asked for only at a doorway",
     /this\.inward \? RETURN_BY_PLACE_DOOR_MS : RETURN_BY_PLACE_MS/.test(src));
  ok("and only on the pairing step — the revive path keeps fifteen seconds",
     (src.match(/RETURN_BY_PLACE_DOOR_MS : RETURN_BY_PLACE_MS/g) || []).length === 1
     && /\/\/ Only recently\. See RETURN_BY_PLACE_MS\.\n\s*if \(now - t\.lastSeen > RETURN_BY_PLACE_MS\) return;/.test(src));
  ok("a plainly different coat refuses a claim made on position",
     /alikeLook\(t\.look, looks\[bi\]!\) < PLAINLY_SOMEBODY_ELSE\) return;/.test(src));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A queue through one door is a queue.");
process.exit(fails ? 1 : 0);
