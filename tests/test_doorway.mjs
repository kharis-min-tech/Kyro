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
const { wentIn, PersonTracker, DOOR_DECIDE_MS } = await import(path.join(tmp, "personTracker.js"));

/**
 * Long enough that a doorway has written down which way somebody went.
 *
 * It used to be a bare 16000 in every one of these files — one second past a
 * fifteen-second wait, repeated until the wait could not be changed without
 * seven test files calling it a bug. The church asked for longer: "it
 * shouldnt wait 15 seconds after someone has left, it should wait 5-10
 * minutes", because somebody who steps just inside the door and stands
 * talking is not an arrival until they stay.
 *
 * It follows the real number now, wherever that goes next.
 */
const GONE_LONG_ENOUGH = DOOR_DECIDE_MS + 1000;


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

// 5. A room camera counts NOBODY in or out.
//
//    This used to read "appearing is arriving", and it was the single thing
//    that produced "1 person on the camera and 6 came in". A room camera has
//    no line for anybody to cross: what it can honestly say is "I have become
//    sure there is a person here", and it says that again every time it loses
//    somebody and finds them — a detector dropping out, somebody hidden
//    behind the person in front, a browser reloaded. Every one of those
//    looked exactly like somebody walking in.
//
//    Arrivals now come from a doorway camera, or from the register of
//    people, which counts PEOPLE rather than moments of certainty.
{
  const tr = new PersonTracker();
  let t = 0;
  for (let i = 0; i < 4; i++) see(tr, [box(100, 100, 60, 150)], (t += 300));
  ok("a room camera counts nobody in", tr.entries === 0, `${tr.entries}`);
  ok("and nobody out", tr.exits === 0, `${tr.exits}`);
  // It still knows how many are there, which is the job it can actually do.
  ok("but it still says how many are in the room", see(tr, [box(100, 100, 60, 150)], (t += 300)) === 1);
  // And losing them and finding them again adds nothing, however often.
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < 60; i++) see(tr, [], (t += 1000));
    for (let i = 0; i < 6; i++) see(tr, [box(100, 100, 60, 150)], (t += 300));
  }
  ok("and five disappearances add nothing at all", tr.entries === 0 && tr.exits === 0,
     `${tr.entries} in, ${tr.exits} out`);
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

  see(tr, [], (t += GONE_LONG_ENOUGH));       // they have gone through, and the grace is up
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
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

  see(tr, [], (t += GONE_LONG_ENOUGH - 3000));
  ok("once the doorway has waited them out, they are counted", tr.entries === 1);
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
  walkOut(600);                 // a different person, elsewhere in the doorway
  see(tr, [], (t += GONE_LONG_ENOUGH));
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("the next person through the same door is a second departure", tr.exits === 2, `exits ${tr.exits}`);
}


// 14. Someone who steps out of view and comes back BEFORE they have been
//     counted is still the same person, and leaves once.
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
  see(tr, [], (t += 10000));     // ten seconds — not long enough to call it
  ok("nothing is counted while they might still be in the doorway", tr.exits === 0, `exits ${tr.exits}`);

  // Back where they were, at the same size: recognised, not a new person.
  see(tr, [box(100, 128, 46, 118)], (t += 300));
  see(tr, [box(100, 140, 40, 100)], (t += 300));
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("stepping back and going again is one departure, not two", tr.exits === 1, `exits ${tr.exits}`);
  ok("nor an arrival", tr.entries === 0, `entries ${tr.entries}`);
}

// 15. The honest limit, written down so nobody promises more than this.
//
//     Once someone has been counted out they are, by definition, at least
//     fifteen seconds out of view — longer than a position stays believable as
//     identity (RETURN_BY_PLACE_MS). So if they walk back in and out again,
//     Kyro counts a second departure. It cannot do otherwise: a person
//     returning to the same patch of doorway and a different person walking
//     into it look exactly alike to a camera. Case 13 relies on that very
//     thing — the next person through the same door IS a second departure.
//
//     Face matching is the only thing that can tell those two apart, and it is
//     off unless an administrator switches it on. Keeping the track for five
//     minutes is what lets a face claim it back.
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
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("counted out promptly", tr.exits === 1, `exits ${tr.exits}`);
  walkOut();
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("a second trip out of the door is a second departure", tr.exits === 2, `exits ${tr.exits}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
// 16. A slow camera. Her entrance camera reported "0 in, 1 out" with people
//     streaming through it, because at two or three counts a second a person
//     crossing a doorway is seen twice in total and three sightings were
//     needed before Kyro would believe in them.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  // Seen exactly twice, walking away from the camera (getting smaller).
  see(tr, [box(100, 60, 70, 200)], (t += 400));
  see(tr, [box(100, 120, 48, 124)], (t += 400));
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("two sightings at a doorway are enough to count someone", tr.exits === 1, `exits ${tr.exits}`);
  ok("and in the right direction", tr.entries === 0, `entries ${tr.entries}`);
}

// 17. Two sightings is not enough on a ROOM camera, where someone is in view
//     for minutes and a box seen twice is far more likely to be a flicker.
//
//     Measured on what the room camera DOES answer, now that it answers
//     nothing about arrivals: how many people are in the room. The threshold
//     is the same one; it simply decides whether somebody is counted as being
//     there rather than as having walked in.
{
  const tr = new PersonTracker();                     // no watchesDoorway → a room
  let t = 0;
  ok("a room still wants three sightings",
     see(tr, [box(100, 100, 50, 150)], (t += 400)) === 0
     && see(tr, [box(101, 101, 50, 150)], (t += 400)) === 0);
  ok("and counts them on the third", see(tr, [box(102, 102, 50, 150)], (t += 400)) === 1);
  ok("and still never as an arrival", tr.entries === 0, `entries ${tr.entries}`);
}

// 18. A box that flickers in the doorway and goes nowhere still counts for
//     nothing — the direction test is what makes two sightings safe here.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 100, 50, 150)], (t += 400));
  see(tr, [box(101, 101, 50, 149)], (t += 400));      // same place, same size
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("a flicker that travels nowhere counts for nothing",
     tr.entries === 0 && tr.exits === 0, `in ${tr.entries} out ${tr.exits}`);
}

// ── Remembered for the whole service, not for minutes ──────────────────────
//
// "it shouldnt remember who has been counted for 5 minutes, it should
// remember for hourssss, i said up until the service sessions ends and thats
// like 4-5 hours."
//
// It already does, and the five minutes she was told about was my description
// rather than the behaviour: five minutes is how long the live TRACK is kept,
// after which the person moves into the remembered list — which has no clock
// on it at all and is emptied only when the service changes. This pins that
// down so a tidy-up can never quietly put a timer on it.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  for (let i = 0; i <= 6; i++) {
    const h = 60 + (200 - 60) * (i / 6);
    see(tr, [box(600 - h / 4, 400 - h, h / 2, h)], (t += 400));
  }
  for (let i = 0; i < 400; i++) see(tr, [], (t += 1000));
  const after = tr.entries;
  ok("somebody walks in and is counted once", after === 1, `${after}`);
  // Four hours of nothing at all — a long service, with the camera running.
  for (let i = 0; i < 4 * 60; i++) see(tr, [], (t += 60_000));
  ok("four hours later, nobody has been counted again", tr.entries === after, `${tr.entries}`);

  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("the remembered list has no clock on it, only a size",
     /const MOST_REMEMBERED = \d+;/.test(src)
     && !/known.*filter.*now - .*\.at/.test(src));
  /**
   * Every place the memory is emptied is an EVENT, never a clock.
   *
   * There are four, and each one is somebody doing something: the service
   * changing, a fresh start being pressed, a new day, or the camera being
   * repurposed from a room to a doorway. That is the property worth pinning
   * — not how many there are, but that not one of them is "and after a
   * while, forget".
   */
  const clears = [...src.matchAll(/this\.known = \[\];/g)];
  ok("the memory is emptied in a handful of places", clears.length === 4, `${clears.length}`);
  for (const c of clears) {
    const around = src.slice(Math.max(0, c.index - 400), c.index);
    ok("…and that one is an event, not a clock",
       !/now - |Date\.now\(\) -|_MS\b/.test(around.split("\n").slice(-6).join("\n")),
       around.split("\n").slice(-3).join("\n"));
  }
  ok("ending the service is one of them",
     /forgetPeople\(\): void \{[\s\S]{0,60}this\.known = \[\];/.test(src));
}

console.log(fails
  ? `\n${fails} failed`
  : "\nAll good. Walking in counts in, walking out counts out, hovering counts neither.");
process.exit(fails ? 1 : 0);
