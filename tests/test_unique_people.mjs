/**
 * Counting people, not sightings.
 *
 * Everything Kyro counted was a count of events: a room camera's "entries" is
 * every person it becomes sure of, so the same congregation was counted over
 * and over all service — 1,538 at a service of about 900, and 171 people
 * "arriving" at the moment the hall emptied. A doorway camera counts
 * crossings, and one person stepping out for a phone call crosses four times.
 *
 * None of those is attendance. This is: how many DIFFERENT people were seen,
 * counted once each, for as long as Kyro can recognise them.
 *
 *   node tests/test_unique_people.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-unique-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const box = (left, top, w, h) => [left, top, left + w, top + h];
const see = (tr, boxes, t, faces) => tr.update(boxes.map((b) => ({ box: b })), t, faces);
const face = (n) => { const v = new Float32Array(8); v[n % 8] = 1; return v; };
/** Someone sitting still in the room, seen for a while. */
const settle = (tr, boxes, t, faces, times = 4) => {
  for (let i = 0; i < times; i++) t = see(tr, boxes, (t += 400), faces) && t;
  return t;
};

// 1. Twelve people in a room, seen for a quarter of an hour. Twelve people —
//    not twelve a minute.
{
  const tr = new PersonTracker();
  const boxes = Array.from({ length: 12 }, (_, i) => box(40 + i * 70, 100, 50, 150));
  const faces = boxes.map((_, i) => face(i));
  let t = 0;
  for (let count = 0; count < 120; count++) { see(tr, boxes, (t += 400), faces); }
  ok("twelve people seen for a quarter of an hour are twelve people",
     tr.people === 12, `got ${tr.people}`);
  ok("while 'entries' counts sightings and is not attendance", tr.entries === 12, `entries ${tr.entries}`);
}

// 2. Someone hidden behind a pillar for two minutes and seen again is still
//    one person — the case that made a room camera's figure climb all day.
{
  const tr = new PersonTracker();
  const me = [box(100, 100, 50, 150)];
  const myFace = [face(3)];
  let t = 0;
  for (let i = 0; i < 5; i++) see(tr, me, (t += 400), myFace);
  ok("one person is one person", tr.people === 1, `got ${tr.people}`);
  see(tr, [], (t += 120_000));                       // gone two minutes
  for (let i = 0; i < 5; i++) see(tr, me, (t += 400), myFace);
  ok("and still one when they come back", tr.people === 1, `got ${tr.people}`);
  ok("even though the old count called that a second arrival", tr.entries === 2, `entries ${tr.entries}`);
}

// 3. Somebody genuinely new is new.
{
  const tr = new PersonTracker();
  let t = 0;
  for (let i = 0; i < 5; i++) see(tr, [box(100, 100, 50, 150)], (t += 400), [face(1)]);
  for (let i = 0; i < 5; i++) see(tr, [box(400, 100, 50, 150)], (t += 400), [face(2)]);
  ok("two different people are two people", tr.people === 2, `got ${tr.people}`);
}

// 4. A flicker that was never a person counts as nobody.
{
  const tr = new PersonTracker();
  see(tr, [box(100, 100, 50, 150)], 400);
  see(tr, [], 800);
  see(tr, [box(100, 100, 50, 150)], 1200);
  see(tr, [], 1600);
  ok("a flicker is not a person", tr.people === 0, `got ${tr.people}`);
}

// 5. The service ends: everybody is forgotten and the next one starts at
//    nobody. This is a count within a service, never a register of people.
{
  const tr = new PersonTracker();
  let t = 0;
  for (let i = 0; i < 5; i++) see(tr, [box(100, 100, 50, 150)], (t += 400), [face(1)]);
  ok("somebody was counted", tr.people === 1);
  tr.forgetPeople();
  ok("the next service starts at nobody", tr.people === 0, `got ${tr.people}`);
  tr.resetCounts();
  ok("and so does a fresh start", tr.people === 0);
}

// 6. It travels: the camera reports it, the website adds it up across
//    restarts, two cameras on one room don't double it, and two rooms do add.
{
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("the camera reports it", /people_seen: c\.tracker\.people,/.test(ctx));
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("a reloaded browser's register isn't lost",
     /seen\.people = \(seen\.people \|\| 0\) \+/.test(worker)
     && /seen\.lastPeople === null \|\| rPeople < seen\.lastPeople \? rPeople : rPeople - seen\.lastPeople/.test(worker));
  ok("two cameras on one room take the fullest view", /r\.people = take\(r\.people, z\.people\);/.test(worker));
  // The attendance figure is the SIZE OF THE REGISTER — not a counter kept
  // beside it, which is how two numbers for one thing start disagreeing. Each
  // camera's own tally is still published for comparison, never added up.
  ok("attendance is the register itself", /people_seen: this\.register\?\.size \?\? sum\("people"\),/.test(worker));
  ok("and the page is told which it is", /people_from_register: !!this\.register\?\.size,/.test(worker));
  ok("each camera's own tally is kept for comparison", /people_seen_by_camera: sum\("people"\),/.test(worker));
  ok("a doorway's own register is offered, not added", /people_seen_at_door: sumDoors\("people"\),/.test(worker));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("and the page leads with it", /Different people, this service/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. People, counted once each.");
process.exit(fails ? 1 : 0);
