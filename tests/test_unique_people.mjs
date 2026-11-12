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
  // "entries" used to count sightings here — every person this camera became
  // sure of — and was shown on the page as arrivals. It is the thing that
  // made "1 person on the camera and 6 came in". A room camera has no line
  // for anybody to cross, so it no longer answers that question at all.
  ok("while a room camera answers nothing about arrivals", tr.entries === 0, `entries ${tr.entries}`);
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
  // The old count called that a second arrival — two "entries" for one
  // person who never went anywhere. That is the fault, named, and the room
  // camera no longer produces the figure that carried it.
  ok("and the old second arrival is not produced at all", tr.entries === 0, `entries ${tr.entries}`);
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
  // This used to carry the WHOLE of a restarted browser's tally across, on
  // the reasoning that it was all new since the restart. It is not: a fresh
  // tracker confirms everybody already standing there within a second, and
  // those people did not arrive. Reload twice with one person in shot and
  // "came in" went up by two with nobody moving. Only forward steps now, and
  // nothing at all across a restart. See tests/test_no_false_entries.mjs.
  ok("a reloaded browser never has its tally counted again",
     /const restarted = seen\.lastIn !== null && \(rIn < seen\.lastIn \|\| rOut < seen\.lastOut\);/.test(worker)
     && /const step = \(now, last\) => \(first \|\| restarted \|\| now < last \? 0 : now - last\);/.test(worker));
  ok("and what was not counted is written down", /trail\.unshift\(\{ \.\.\.r, at: new Date\(r\.at\)\.toISOString\(\) \}\);/.test(worker));
  ok("two cameras on one room take the fullest view", /r\.people = take\(r\.people, z\.people\);/.test(worker));
  // The attendance figure is the SIZE OF THE REGISTER — not a counter kept
  // beside it, which is how two numbers for one thing start disagreeing. Each
  // camera's own tally is still published for comparison, never added up.
  /**
   * ── The doorway answers this now ────────────────────────────────────────
   *
   * "because the room camera cannot see the whole room, the door camera
   * basically needs to do the counting too to be honest."
   *
   * Attendance came from the register, which is fed by the ROOM cameras — a
   * doorway is not allowed to put anybody in it. In a wide hall a camera
   * sees its own corner, so the register was answering "how many different
   * people have been in that corner" under the name attendance, for a
   * building where most of the congregation is never in shot.
   *
   * A doorway is the one camera every person passes, close and face-on, and
   * it keeps its own count of DIFFERENT people — it remembers the ones it
   * has counted, so the usher holding the door is one person. That is an
   * attendance figure measured where attendance can be measured.
   *
   * The register's figure is kept beside it under its own name, never added
   * to it: everybody the door sees also walks into a room.
   */
  ok("attendance is the doorway's count when a doorway is counting",
     /const attendance = doorPeople > 0 \? doorPeople : roomPeople;/.test(worker)
     && /people_seen: attendance,/.test(worker));
  ok("two doorways take the fullest view, never the sum",
     /const doorPeople = doors\.reduce\(\(n, r\) => Math\.max\(n, r\.people \|\| 0\), 0\);/.test(worker));
  ok("and the rooms' own figure is kept beside it, never added to it",
     /people_seen_in_rooms: this\.register\?\.size \?\? sum\("people"\),/.test(worker));
  ok("the page is told which of the two it is reading", /attendance_from: attendanceFrom,/.test(worker));
  ok("and the page is told which it is", /people_from_register: !!this\.register\?\.size,/.test(worker));
  ok("each camera's own tally is kept for comparison", /people_seen_by_camera: sum\("people"\),/.test(worker));
  ok("a doorway's own register is offered, not added", /people_seen_at_door: sumDoors\("people"\),/.test(worker));
  // The arrivals card used to repeat it in a tile of its own. Removed at the
  // church's request: two places showing one figure means that when the
  // register is wrong it is wrong twice, with nothing to say which to
  // believe. It is shown once, as the attendance headline.
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
  ok("and the page shows it as the attendance headline", /people_seen/.test(page));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("and not a second time on the arrivals card", !/Different people, this service/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. People, counted once each.");
process.exit(fails ? 1 : 0);
