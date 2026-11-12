/**
 * "Everyone is leaving now."
 *
 * Kyro works out which way somebody went by watching them move across the
 * doorway. That needs two clear sightings and a direction it can call — and a
 * crowded door at the end of a service, people shoulder to shoulder with half
 * of them hidden behind the rest, is the hardest moment to get it right. It is
 * also the moment the count matters most.
 *
 * At that moment the church already knows the answer. So an operator says so,
 * and every person the camera is sure of is counted that way. A fact from the
 * person standing there beats a guess from a camera.
 *
 *   node tests/test_everyone_leaving.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-leaving-"));
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
/** A face code: distinct people get codes that point in different directions. */
const face = (n) => { const v = new Float32Array(8); v[n % 8] = 1; return v; };
const look = (top, bottom, shape = 2.5, height = 0.5) => ({ top, bottom, shape, height });
const coat = (r, g, b) => look([r, g, b], [0.33, 0.33, 0.4]);

// 1. The case it exists for: a crush where nobody's direction can be called.
//    Six people cross, barely moving in the picture — too little to say which
//    way. Left to itself Kyro counts none of them.
{
  const guess = new PersonTracker();
  guess.watchesDoorway("closer");
  let t = 0;
  for (let i = 0; i < 6; i++) {
    const x = 50 + i * 90;
    see(guess, [box(x, 100, 60, 160)], (t += 400), [coat(0.3 + i * 0.01, 0.33, 0.2)]);
    see(guess, [box(x + 2, 101, 60, 158)], (t += 400), [coat(0.3 + i * 0.01, 0.33, 0.2)]);
    see(guess, [], (t += GONE_LONG_ENOUGH));
  }
  ok("left to guess, a crush counts nobody out", guess.exits === 0, `exits ${guess.exits}`);

  const told = new PersonTracker();
  told.watchesDoorway("closer", "out");
  t = 0;
  for (let i = 0; i < 6; i++) {
    const x = 50 + i * 90;
    see(told, [box(x, 100, 60, 160)], (t += 400), [coat(0.3 + i * 0.01, 0.33, 0.2)]);
    see(told, [box(x + 2, 101, 60, 158)], (t += 400), [coat(0.3 + i * 0.01, 0.33, 0.2)]);
    see(told, [], (t += GONE_LONG_ENOUGH));
  }
  ok("told they are leaving, all six are counted out", told.exits === 6, `exits ${told.exits}`);
  ok("and none as arriving", told.entries === 0, `entries ${told.entries}`);
}

// 2. The same, for the doors opening.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer", "in");
  let t = 0;
  for (let i = 0; i < 3; i++) {
    const x = 50 + i * 90;
    see(tr, [box(x, 100, 60, 160)], (t += 400), [coat(0.3 + i * 0.02, 0.33, 0.2)]);
    see(tr, [box(x + 2, 101, 60, 158)], (t += 400), [coat(0.3 + i * 0.02, 0.33, 0.2)]);
    see(tr, [], (t += GONE_LONG_ENOUGH));
  }
  ok("told they are arriving, they are counted in", tr.entries === 3 && tr.exits === 0,
     `in ${tr.entries} out ${tr.exits}`);
}

// 3. The usher is still protected: holding the door while everyone leaves
//    doesn't count them out again and again.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer", "out");
  const usher = look([0.5, 0.25, 0.4], [0.3, 0.33, 0.5], 2.6, 0.55);
  let t = 0;
  for (let trip = 0; trip < 4; trip++) {
    see(tr, [box(100, 100, 60, 160)], (t += 2000), [usher], [face(1)]);
    see(tr, [box(102, 101, 60, 158)], (t += 400), [usher], [face(1)]);
    see(tr, [], (t += GONE_LONG_ENOUGH));
  }
  ok("the usher is counted out once, not four times", tr.exits === 1, `exits ${tr.exits}`);
}

// 3b. Without a face — face matching switched off, or the usher never turned
//     towards the camera — Kyro cannot tell them from the next person through
//     the door, and counts them again. That is the honest limit, and it is
//     what face matching is for.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer", "out");
  const usher = look([0.5, 0.25, 0.4], [0.3, 0.33, 0.5], 2.6, 0.55);
  let t = 0;
  for (let trip = 0; trip < 3; trip++) {
    see(tr, [box(100, 100, 60, 160)], (t += 20000), [usher]);
    see(tr, [box(102, 101, 60, 158)], (t += 400), [usher]);
    see(tr, [], (t += GONE_LONG_ENOUGH));
  }
  ok("with no face to go on, a returning person is a new person", tr.exits === 3, `exits ${tr.exits}`);
}

// 4. Switching it on and off must not zero the morning's figures: it is a
//    change in what Kyro is being told, not a new camera.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  see(tr, [box(100, 120, 48, 124)], (t += 400), [coat(0.5, 0.25, 0.4)]);
  see(tr, [box(100, 60, 70, 200)], (t += 400), [coat(0.5, 0.25, 0.4)]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("somebody was counted in first", tr.entries === 1);
  tr.watchesDoorway("closer", "out");
  ok("turning it on keeps the arrivals", tr.entries === 1, `entries ${tr.entries}`);
  tr.watchesDoorway("closer", null);
  ok("and turning it off again keeps them too", tr.entries === 1, `entries ${tr.entries}`);
}

// 5. It reaches the counting computer from wherever it was pressed, and only
//    an administrator or operator may press it.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("the website takes the instruction", /p === "\/api\/live\/door-mode" && request\.method === "POST"/.test(worker));
  ok("only admins and operators may give it",
     /if \(role !== "admin" && role !== "operator"\) return json\(\{ error: "Only administrators and operators can change this" \}, 403\);\s*\n\s*const b = await request\.json/.test(worker));
  ok("and it is sent to the counting computer with every report", /door_mode: \(await this\.get\("door_mode", null\)\)\?\.mode \?\? "auto"/.test(worker));
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("which passes it to the counter", /c\.tracker\.watchesDoorway\(inward, inward \? doorMode : null\)/.test(ctx));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("the in/out card has the buttons", /Everyone is leaving/.test(card) && /Everyone is arriving/.test(card)
     && /Work it out/.test(card));
  ok("and says plainly what it does to anyone walking the other way",
     /Anyone walking back IN is counted as leaving too/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. When the church knows, Kyro doesn't have to guess.");
process.exit(fails ? 1 : 0);
