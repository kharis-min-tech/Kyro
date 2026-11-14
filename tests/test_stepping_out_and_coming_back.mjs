/**
 * Five people nip out during the notices, all five come back, and the hall
 * reads fifteen instead of twenty — for the rest of the morning.
 *
 * Reported as: "still hidden bus with counting".
 *
 * How many people are in the hall is arrivals minus departures. Both of
 * those were being counted ONCE PER PERSON rather than once per crossing:
 * somebody who had already been counted walking in had their next walk in
 * refused, because they were already "counted in". Their walk OUT was not
 * refused — that was a direction they had not been counted in yet.
 *
 * So every person who stepped out and came back took one off the hall
 * permanently. It never came back, because their return could never be
 * counted. Measured, twenty people in and five stepping out and returning:
 *
 *                          face matching OFF   face matching ON
 *     before   in the hall        18                  15        (truth 20)
 *     after    in the hall        20                  20
 *
 * The once-per-person rule was there for a real reason — an usher in and
 * out of the door all morning used to climb the morning's figure all day.
 * But that figure is the ATTENDANCE, and it is protected somewhere else
 * entirely (countPerson, which asks `returning`). Holding the crossings to
 * one as well bought nothing and cost the hall.
 *
 * What replaces it: a crossing counts when it REVERSES the last one. In,
 * out, in is three crossings. In, in, in is one — nothing said they ever
 * went out in between, so the second and third are the same person being
 * seen near the door again.
 *
 *   node tests/test_stepping_out_and_coming_back.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-stepout-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const lookOf = (i) => ({ top: [(i * 53 % 255) / 255, (i * 97 % 255) / 255, (i * 29 % 255) / 255],
  bottom: [(i * 131 % 255) / 255, (i * 17 % 255) / 255, (i * 211 % 255) / 255],
  shape: 2.2 + (i % 7) * 0.12, height: 0.4 + (i % 5) * 0.05 });
const faceOf = (i) => {
  const v = new Float32Array(128);
  let s = 0;
  for (let k = 0; k < 128; k++) {
    const x = Math.sin((i + 1) * (k + 1) * 12.9898) * 43758.5453;
    v[k] = x - Math.floor(x) - 0.5; s += v[k] * v[k];
  }
  s = Math.sqrt(s);
  for (let k = 0; k < 128; k++) v[k] /= s;
  return v;
};
const see = (tr, boxes, t, faces, looks) =>
  tr.update(boxes.map((b) => ({ box: b, score: 0.9 })), t, faces, looks);

/** dir +1 walks towards the camera (in), -1 walks away (out). */
function walk(tr, look, face, dir, startT) {
  let time = startT;
  for (let f = 0; f < 7; f++) {
    const k = f / 6, sc = dir > 0 ? 0.35 + k * 0.5 : 0.85 - k * 0.5;
    const h = 400 * sc, w = h * 0.4, cy = 360 + (dir > 0 ? k * 80 : -k * 80);
    time += 1000 / 6;
    see(tr, [[640 - w / 2, cy - h / 2, 640 + w / 2, cy + h / 2]], time, [face], [look]);
  }
  return time;
}

function service(withFaces) {
  const F = (i) => (withFaces ? faceOf(i) : null);
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway("closer");
  let time = 1000;
  for (let i = 0; i < 20; i++) {
    time = walk(tr, lookOf(i), F(i), +1, time);
    time += 4000;
    see(tr, [], time, [], []);
  }
  time += 20_000;
  see(tr, [], time, [], []);
  for (const i of [2, 5, 9, 13, 17]) {        // out during the notices
    time = walk(tr, lookOf(i), F(i), -1, time);
    time += 6000;
    see(tr, [], time, [], []);
  }
  time += 60_000;                              // a couple of minutes away
  see(tr, [], time, [], []);
  for (const i of [2, 5, 9, 13, 17]) {        // and back
    time = walk(tr, lookOf(i), F(i), +1, time);
    time += 6000;
    see(tr, [], time, [], []);
  }
  time += 20_000;
  see(tr, [], time, [], []);
  return { inHall: tr.entries - tr.exits, came: tr.people, in: tr.entries, out: tr.exits };
}

// ── The hall adds up, with faces and without ──────────────────────────────
for (const faces of [false, true]) {
  const r = service(faces);
  ok(`face matching ${faces ? "on" : "off"}: twenty are in the hall, not fifteen`,
     r.inHall === 20, `hall ${r.inHall} (in ${r.in}, out ${r.out})`);
  ok(`face matching ${faces ? "on" : "off"}: five went out and five came back`,
     r.out === 5 && r.in === 25, `in ${r.in} out ${r.out}`);
}
// Attendance still needs faces to be exactly right — that is the honest
// limit and it is unchanged by any of this.
ok("with faces on, twenty people came, not twenty-three",
   service(true).came === 20, `came ${service(true).came}`);

// ── Going the same way twice over is still one crossing ───────────────────
{
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway("closer");
  const coat = lookOf(4), theirFace = faceOf(4);
  let time = 1000;
  for (let trip = 0; trip < 3; trip++) {      // in, in, in — never out
    time = walk(tr, coat, theirFace, +1, time);
    time += 30_000;
    see(tr, [], time, [], []);
  }
  time += 20_000;
  see(tr, [], time, [], []);
  ok("walking in three times with no departure between is one arrival",
     tr.entries === 1 && tr.exits === 0, `in ${tr.entries} out ${tr.exits}`);
  ok("and one person", tr.people === 1, `people ${tr.people}`);
}

// ── A fresh start forgets the direction too ───────────────────────────────
// Somebody standing in the doorway when the next service begins is new
// again: their first crossing counts, and so do they.
{
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway("closer");
  const coat = lookOf(6), theirFace = faceOf(6);
  let time = walk(tr, coat, theirFace, +1, 1000);
  time += 20_000;
  see(tr, [], time, [], []);
  tr.forgetPeople();
  time = walk(tr, coat, theirFace, +1, time + 5000);
  time += 20_000;
  see(tr, [], time, [], []);
  ok("their first crossing of the new service is counted",
     tr.entries === 2, `in ${tr.entries}`);
  ok("and they are the new service's first person",
     tr.people === 1, `people ${tr.people}`);
}

// ── The rule is written down where it is used ─────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("a crossing counts when it reverses the last one",
     /if \(t\.lastWay !== "in"\)/.test(src) && /if \(t\.lastWay !== "out"\)/.test(src));
  ok("and a fresh start clears the direction with everything else",
     /t\.countedIn = false; t\.countedOut = false; t\.lastWay = null;/.test(src));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Out and back in is out and back in.");
process.exit(fails ? 1 : 0);
