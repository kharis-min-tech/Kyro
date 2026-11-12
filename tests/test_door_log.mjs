/**
 * "I don't know what you're counting — make sure you're not duplicating people."
 *
 * That deserves an answer that can be held up against the door itself, not a
 * reassurance. Every decision a doorway camera makes is written down in plain
 * words — counted in, counted out, recognised and not counted again, or at the
 * door and went back the way they came — with the time it was made.
 *
 * Nothing in it says who anyone is: a time, a camera, and one word.
 *
 *   node tests/test_door_log.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-log-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { PersonTracker, DOOR_DECIDE_MS } = await import(path.join(tmp, "personTracker.js"));

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


const box = (left, top, w, h) => [left, top, left + w, top + h];
const see = (tr, boxes, t, looks, faces) => tr.update(boxes.map((b) => ({ box: b })), t, faces, looks);
const face = (n) => { const v = new Float32Array(8); v[n % 8] = 1; return v; };
const look = (top, bottom, shape = 2.5, height = 0.5) => ({ top, bottom, shape, height });
const NAVY = [0.26, 0.31, 0.18], GREY = [0.33, 0.33, 0.45], RED = [0.55, 0.22, 0.40];

// 1. One person in, one person out: two decisions, in the right words.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 120, 48, 124)], (t += 400), [look(RED, GREY)]);
  see(tr, [box(100, 60, 70, 200)], (t += 400), [look(RED, GREY)]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  see(tr, [box(100, 60, 70, 200)], (t += 400), [look(NAVY, GREY, 2.4, 0.55)]);
  see(tr, [box(100, 120, 48, 124)], (t += 400), [look(NAVY, GREY, 2.4, 0.55)]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  const events = tr.drainEvents();
  ok("both decisions are written down", events.length === 2, JSON.stringify(events));
  ok("the first is an arrival", events[0].kind === "in", events[0]?.kind);
  ok("the second is a departure", events[1].kind === "out", events[1]?.kind);
  ok("each has the time it was decided", events.every((e) => typeof e.at === "number" && e.at > 0));
  ok("taking them clears them", tr.drainEvents().length === 0);
}

// 2. The usher. The decision not to count them is written down too — that is
//    the whole point: being able to see the duplicates being turned away.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  const usher = look(RED, GREY, 2.6, 0.55);
  const theirFace = face(1);     // face matching on, which is how one person
  let t = 0;                     // is told from the next at a quiet door
  for (let trip = 0; trip < 3; trip++) {
    see(tr, [box(100, 120, 48, 124)], (t += 3000), [usher], [theirFace]);
    see(tr, [box(100, 60, 70, 200)], (t += 400), [usher], [theirFace]);
    see(tr, [], (t += GONE_LONG_ENOUGH));
  }
  const events = tr.drainEvents();
  ok("the usher is counted in once", events.filter((e) => e.kind === "in").length === 1,
     JSON.stringify(events.map((e) => e.kind)));
  ok("and the repeats are shown as repeats",
     events.filter((e) => e.kind === "again-in").length === 2,
     JSON.stringify(events.map((e) => e.kind)));
}

// 3. Someone who steps to the door and goes back: counted as neither, and
//    said so, rather than silently vanishing.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 100, 50, 150)], (t += 400), [look(NAVY, GREY)]);
  see(tr, [box(101, 101, 50, 149)], (t += 400), [look(NAVY, GREY)]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  const events = tr.drainEvents();
  ok("going nowhere is recorded as unclear", events.length === 1 && events[0].kind === "unclear",
     JSON.stringify(events));
}

// 4. The log can't grow without limit.
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("there is a cap on what is kept in the browser", /const MOST_EVENTS = \d+;/.test(src));
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("and on the website", /const DOOR_LOG_KEEP = \d+;/.test(worker)
     && /this\.doorLog\.set\(camera_id, log\.slice\(-DOOR_LOG_KEEP\)\)/.test(worker));
}

// 5. It says nothing about who anyone is — no face, no look, no picture.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const fn = worker.slice(worker.indexOf("async doorLogFor()"), worker.indexOf("async venueTotal()"));
  ok("the log holds a time, a camera and one word",
     !/face/i.test(fn) && !/look/i.test(fn) && !/snapshot|image|photo/i.test(fn), fn.slice(0, 300));
  ok("and only words it recognises are stored",
     /\["in", "out", "again-in", "again-out", "unclear"\]\.includes\(e\.kind\)/.test(worker));
}

// 6. The tally answers the question that was actually asked.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("it adds up the repeats it turned away", /repeats_not_counted: count\("again-in"\) \+ count\("again-out"\)/.test(worker));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/DoorLog.tsx"), "utf8");
  ok("and the page shows that number", /Repeats turned away/.test(card));
  ok("the words are plain", /Counted IN/.test(card) && /Same person coming in again — not counted/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. Every decision is written down, in words.");
process.exit(fails ? 1 : 0);
