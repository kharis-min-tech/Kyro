/**
 * Counting people in and out at a doorway.
 *
 * The thing being guarded against: Kyro counted someone as having arrived when
 * they appeared, and as having left when they went out of view. That works for
 * a camera on a room. At a door it is meaningless — everybody passing a door
 * both appears and disappears, whichever way they are walking. So a door camera
 * reported "12 in, 0 out" with people streaming past in both directions, and
 * the departures only arrived 45 seconds later, if at all.
 *
 * The direction someone travelled is the whole of the information, so that is
 * what gets counted.
 *
 *   node tests/test_doorway.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-door-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { wentIn, PersonTracker } = await import(path.join(tmp, "personTracker.js"));

/** A person's box: [left, top, right, bottom]. Taller = closer to the camera. */
const box = (left, top, w, h) => [left, top, left + w, top + h];

// ── Which way did they go? ───────────────────────────────────────────────────

// 1. Walking towards a camera makes a person taller in the picture.
{
  const far = box(100, 100, 40, 100), near = box(100, 60, 70, 180);
  ok("walking towards the camera is coming in", wentIn(far, near, "closer") === true);
  ok("walking away from it is going out", wentIn(near, far, "closer") === false);
}

// 2. A camera mounted the other way round, so the same walk means the opposite.
{
  const far = box(100, 100, 40, 100), near = box(100, 60, 70, 180);
  ok("the setting flips it", wentIn(far, near, "away") === false && wentIn(near, far, "away") === true);
}

// 3. A camera looking across the doorway instead of along it.
{
  const leftSide = box(50, 100, 60, 150), rightSide = box(400, 100, 60, 150);
  ok("moving left is coming in when left is in", wentIn(rightSide, leftSide, "left") === true);
  ok("moving right is going out then", wentIn(leftSide, rightSide, "left") === false);
  ok("and the other way round for right", wentIn(leftSide, rightSide, "right") === true);
}

// 3b. Her entrance camera: seen through a doorway, the walk in view is short
//     and someone already out in the lobby barely changes size. Height alone
//     said "can't tell" for all of them, so the camera reported nobody in and
//     nobody out while a room emptied. Their feet still say which way they went.
{
  // Walking away: barely any change in height, but the feet rise up the picture.
  const near = box(300, 240, 60, 150);         // feet at 390
  const away = box(300, 180, 55, 140);         // feet at 320 — risen most of a body
  ok("height alone could not call this", Math.abs(140 / 150 - 1) < 0.12);
  ok("but walking away is still counted as going out", wentIn(near, away, "closer") === false);
  ok("and the other way round is coming in", wentIn(away, near, "closer") === true);
  ok("the setting still flips it", wentIn(near, away, "away") === true);
}

// 3c. Someone milling about in the lobby, not going through the door, must
//     still count as nothing — the whole point of being strict.
{
  const stood = box(300, 240, 60, 150);
  const shuffled = box(316, 248, 61, 152);     // a step sideways and a sway
  ok("milling about in the lobby counts as neither", wentIn(stood, shuffled, "closer") === null);
}

// 4. Somebody standing in the doorway talking is neither, and must not be
//    counted at all. This is the one that inflates a morning's figures.
{
  const stood = box(100, 100, 60, 150);
  const shuffled = box(108, 100, 60, 156);   // a small shift of weight
  ok("standing still counts as neither", wentIn(stood, shuffled, "closer") === null);
  ok("nor does a small sideways shuffle", wentIn(stood, shuffled, "left") === null);
}

// ── The tracker, end to end ──────────────────────────────────────────────────

const see = (tracker, boxes, t) => tracker.update(boxes.map((b) => ({ box: b })), t);

// 5. A room camera is unchanged: appearing is arriving.
{
  const tr = new PersonTracker();
  let t = 0;
  for (let i = 0; i < 4; i++) see(tr, [box(100, 100, 60, 150)], (t += 300));
  ok("a room camera still counts an arrival when someone appears", tr.entries === 1 && tr.exits === 0);
}

// 6. The same walk past a door camera: nothing is counted until they have gone
//    and it is clear which way they went.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 140, 40, 100)], (t += 300));
  see(tr, [box(100, 120, 50, 130)], (t += 300));
  see(tr, [box(100, 100, 60, 160)], (t += 300));
  see(tr, [box(100, 60, 70, 200)], (t += 300));
  ok("nobody is counted while they are still in the doorway", tr.entries === 0 && tr.exits === 0);

  see(tr, [], (t += 310000));       // they have gone through, and the grace is up
  ok("walking in counts as one arrival", tr.entries === 1, `entries ${tr.entries}`);
  ok("and not as a departure", tr.exits === 0);
}

// 7. Someone leaving the building — the case that used to read as an arrival.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 60, 70, 200)], (t += 300));
  see(tr, [box(100, 100, 60, 160)], (t += 300));
  see(tr, [box(100, 120, 50, 130)], (t += 300));
  see(tr, [box(100, 140, 40, 100)], (t += 300));
  see(tr, [], (t += 310000));
  ok("walking out counts as a departure", tr.exits === 1, `exits ${tr.exits}`);
  ok("and not as an arrival", tr.entries === 0, `entries ${tr.entries} — the old way said 1`);
}

// 8. Someone who stands in the doorway and goes back the way they came is
//    neither an arrival nor a departure.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  for (let i = 0; i < 4; i++) see(tr, [box(100, 100, 60, 150)], (t += 300));
  see(tr, [], (t += 310000));
  ok("hovering in the doorway counts as nothing", tr.entries === 0 && tr.exits === 0);
}

// 9. A doorway doesn't wait 45 seconds to notice someone has gone through.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 140, 40, 100)], (t += 300));
  see(tr, [box(100, 100, 60, 160)], (t += 300));
  see(tr, [box(100, 60, 70, 200)], (t += 300));
  see(tr, [], (t += 3000));
  ok("three seconds later they are still being given a chance", tr.entries === 0);
  see(tr, [], (t += 60000));
  ok("a minute later they are still being given a chance", tr.entries === 0);
  see(tr, [], (t += 250000));
  ok("once the five minutes are up they are counted", tr.entries === 1);
}

// 10. One person, counted once — the thing the grace period is for.
//     Someone walks out, is briefly hidden behind the person behind them,
//     comes back into view and carries on out. That is one departure.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 60, 70, 200)], (t += 300));
  see(tr, [box(100, 100, 60, 160)], (t += 300));
  see(tr, [box(100, 120, 50, 130)], (t += 300));
  see(tr, [], (t += 4000));                       // hidden for four seconds
  ok("nothing is counted while they might still come back", tr.exits === 0);
  see(tr, [box(100, 125, 48, 125)], (t += 300));  // back, near where they were, soon
  see(tr, [box(100, 140, 40, 100)], (t += 300));  // and carrying on out
  see(tr, [], (t += 310000));
  ok("they are counted once, not twice", tr.exits === 1, `exits ${tr.exits}`);
  ok("and not as an arrival on the way back", tr.entries === 0, `entries ${tr.entries}`);
}

// 11. Two different people leaving one after the other are two departures —
//     the grace period must not swallow the second one.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  const walkOut = (left) => {
    see(tr, [box(left, 60, 70, 200)], (t += 300));
    see(tr, [box(left, 100, 60, 160)], (t += 300));
    see(tr, [box(left, 130, 45, 115)], (t += 300));
  };
  walkOut(100);
  see(tr, [], (t += 310000));
  walkOut(600);                 // a different person, elsewhere in the doorway
  see(tr, [], (t += 310000));
  ok("two people leaving are two departures", tr.exits === 2, `exits ${tr.exits}`);
}

// 12. Changing the setting starts the figures again rather than mixing two
//     meanings of the same number.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  // Gradual steps: a person who jumps across the picture between two counts is
  // correctly treated as a different person, which is not what this is testing.
  see(tr, [box(100, 140, 40, 100)], (t += 300));
  see(tr, [box(100, 120, 50, 130)], (t += 300));
  see(tr, [box(100, 100, 60, 160)], (t += 300));
  see(tr, [box(100, 60, 70, 200)], (t += 300));
  see(tr, [], (t += 310000));
  const had = tr.entries;
  tr.watchesDoorway("away");
  ok("it had counted something first", had >= 1);
  ok("changing which way is in starts afresh", tr.entries === 0 && tr.exits === 0);
}


// 13. The guard that makes a five-minute grace safe: after a quarter of a
//     minute, somebody appearing in the same patch of doorway is the next
//     person through it, not the last one coming back. Merging them would lose
//     a departure that really happened.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  const walkOut = () => {
    see(tr, [box(100, 60, 70, 200)], (t += 300));
    see(tr, [box(100, 100, 60, 160)], (t += 300));
    see(tr, [box(100, 130, 45, 115)], (t += 300));
  };
  walkOut();
  see(tr, [], (t += 40000));    // gone 40 seconds — longer than a place is believable
  walkOut();                    // the next person, through the same doorway
  see(tr, [], (t += 310000));
  ok("the next person through the same door is a second departure", tr.exits === 2, `exits ${tr.exits}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails
  ? `\n${fails} failed`
  : "\nAll good. Walking in counts in, walking out counts out, hovering counts neither.");
process.exit(fails ? 1 : 0);
