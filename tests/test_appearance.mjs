/**
 * Recognising someone by what they look like, so they aren't counted twice.
 *
 * Kyro follows a person by where they were a moment ago. That stops working
 * within seconds at a doorway: the patch of picture they stood in is the patch
 * the next person walks into. Past that, the same person coming back was a
 * stranger — and a stranger walking out is a departure that never happened.
 *
 * A face would settle it. Faces are biometric data under UK GDPR, off unless
 * the church has switched them on with a DPIA and notices at the doors. This
 * is the weaker thing that needs none of that: the colour of a coat, the
 * colour of trousers, how tall and wide the shape is. Never stored, never
 * sent, gone within minutes.
 *
 * The danger is the opposite of the one it fixes. A church doorway in November
 * is a row of dark coats, and merging two people loses a departure and
 * undercounts the room — worse than counting one person twice. So a match has
 * to be both strong AND a clear winner, or it is no match at all.
 *
 *   node tests/test_appearance.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-look-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { alikeLook, PersonTracker, DOOR_DECIDE_MS } = await import(path.join(tmp, "personTracker.js"));

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


/** Someone in a given pair of colours. Shares of red and green, then brightness. */
const look = (top, bottom, shape = 2.5, height = 0.5) => ({ top, bottom, shape, height });
const NAVY   = [0.26, 0.31, 0.18];
const GREY   = [0.33, 0.33, 0.45];
const RED    = [0.55, 0.22, 0.40];
const CREAM  = [0.36, 0.34, 0.85];

// ── Telling people apart ────────────────────────────────────────────────────

// 1. The same person, two counts apart: same clothes, nearly the same size.
{
  const a = look(NAVY, GREY, 2.5, 0.50);
  const b = look([0.27, 0.30, 0.20], [0.33, 0.34, 0.43], 2.4, 0.52);
  ok("the same person reads as the same person", alikeLook(a, b) >= 0.78,
     `scored ${alikeLook(a, b).toFixed(3)}`);
}

// 2. Different clothes: not the same person, however close they stood.
{
  const navy = look(NAVY, GREY);
  const red  = look(RED, CREAM);
  ok("a red coat is not a navy one", alikeLook(navy, red) < 0.78,
     `scored ${alikeLook(navy, red).toFixed(3)}`);
}

// 3. Same clothes, very different size — a child beside an adult, or someone
//    at the back of the hall rather than in the doorway.
{
  const near = look(NAVY, GREY, 2.5, 0.60);
  const far  = look(NAVY, GREY, 2.5, 0.20);
  ok("the same colours at a very different size is not a match",
     alikeLook(near, far) < 0.78, `scored ${alikeLook(near, far).toFixed(3)}`);
}

// 4. The light changes between the doorway and three steps inside it. The
//    colour of a coat shouldn't change with it.
{
  const bright = look([0.26, 0.31, 0.55], [0.33, 0.33, 0.60]);
  const dim    = look([0.26, 0.31, 0.22], [0.33, 0.33, 0.28]);
  ok("the same coat in dimmer light is still the same coat",
     alikeLook(bright, dim) >= 0.78, `scored ${alikeLook(bright, dim).toFixed(3)}`);
}

// ── What it does to counting ────────────────────────────────────────────────

const box = (left, top, w, h) => [left, top, left + w, top + h];
const see = (tr, boxes, t, looks, faces) => tr.update(boxes.map((b) => ({ box: b })), t, faces, looks);
/** A face code: distinct people get codes pointing in different directions. */
const face = (n) => { const v = new Float32Array(8); v[n % 8] = 1; return v; };

// 5. The case this exists for. Someone walks out and is counted. Twenty
//    seconds later — too long for "they were standing there" to mean anything
//    — they come back and go out again. Recognised, so it is one journey back
//    in and one journey out, not two strangers leaving.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  const me = look(NAVY, GREY, 2.6, 0.5);
  let t = 0;
  see(tr, [box(100, 60, 70, 200)], (t += 400), [me]);
  see(tr, [box(100, 120, 48, 124)], (t += 400), [me]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("they are counted out", tr.exits === 1 && tr.entries === 0, `in ${tr.entries} out ${tr.exits}`);

  // Back into view, walking towards the camera again: an arrival.
  see(tr, [box(100, 120, 48, 124)], (t += 4000), [me]);
  see(tr, [box(100, 60, 70, 200)], (t += 400), [me]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("coming back in is counted in, not as a second departure",
     tr.entries === 1 && tr.exits === 1, `in ${tr.entries} out ${tr.exits}`);
}

// 6. A crowd of dark coats. Four people who look alike are in and out of view;
//    nobody may be merged on the strength of looking like everyone else.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  const coats = [
    look(NAVY, GREY, 2.5, 0.50),
    look([0.265, 0.305, 0.19], [0.33, 0.33, 0.44], 2.5, 0.50),
    look([0.255, 0.315, 0.18], [0.33, 0.34, 0.45], 2.5, 0.51),
    look([0.26, 0.31, 0.185], [0.335, 0.33, 0.44], 2.5, 0.49),
  ];
  // Four people, four places, walking out together.
  let t = 0;
  const wide = [box(20, 60, 70, 200), box(200, 60, 70, 200), box(380, 60, 70, 200), box(560, 60, 70, 200)];
  const far  = [box(20, 120, 48, 124), box(200, 120, 48, 124), box(380, 120, 48, 124), box(560, 120, 48, 124)];
  see(tr, wide, (t += 400), coats);
  see(tr, far, (t += 400), coats);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("four people in similar coats are four departures, not one",
     tr.exits === 4, `exits ${tr.exits}`);
}

// 6b. The usher.
//
//     Someone stands at that door all morning: holding it open, walking a
//     visitor to a seat, stepping back out. Every trip looked like a person
//     arriving, and the morning's figure climbed all day on one person doing
//     their job — which is exactly what was reported: "you could just be
//     counting them the whole time, that's why the number keeps increasing".
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  const usher = look(RED, GREY, 2.6, 0.55);     // same person throughout
  const theirFace = face(1);                   // face matching is on at Kharis
  let t = 0;
  // In, out, in, out, in — five trips through the door in two minutes.
  const inward  = [box(100, 120, 48, 124), box(100, 60, 70, 200)];
  const outward = [box(100, 60, 70, 200), box(100, 120, 48, 124)];
  for (const trip of [inward, outward, inward, outward, inward]) {
    see(tr, [trip[0]], (t += 3000), [usher], [theirFace]);
    see(tr, [trip[1]], (t += 400), [usher], [theirFace]);
    see(tr, [], (t += GONE_LONG_ENOUGH));
  }
  ok("the usher is counted in once, not three times", tr.entries === 1, `in ${tr.entries}`);
  ok("and out once, not twice", tr.exits === 1, `out ${tr.exits}`);

  // Half an hour later, still the same service, still the same usher: still
  // once. Remembering them for three minutes only moved the problem.
  see(tr, [box(100, 60, 70, 200)], (t += 1_800_000), [usher], [theirFace]);
  see(tr, [box(100, 120, 48, 124)], (t += 400), [usher], [theirFace]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("and still once half an hour into the service", tr.exits === 1, `out ${tr.exits}`);

  // The service ends. Everybody is forgotten, and the next one starts clean.
  tr.forgetPeople();
  see(tr, [box(100, 60, 70, 200)], (t += 5000), [usher], [theirFace]);
  see(tr, [box(100, 120, 48, 124)], (t += 400), [usher], [theirFace]);
  see(tr, [], (t += GONE_LONG_ENOUGH));
  ok("after the service ends they are somebody new again", tr.exits === 2, `out ${tr.exits}`);
}

// 6c. Everyone else is still counted. The cooling-off only ever applies to
//     somebody Kyro recognises — a stranger walking through is a stranger.
{
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  const people = [look(RED, CREAM, 2.5, 0.5), look(NAVY, GREY, 2.4, 0.52), look(CREAM, NAVY, 2.6, 0.48)];
  for (const who of people) {
    see(tr, [box(100, 120, 48, 124)], (t += 2000), [who]);
    see(tr, [box(100, 60, 70, 200)], (t += 400), [who]);
    see(tr, [], (t += GONE_LONG_ENOUGH));
  }
  ok("three different people coming in are three arrivals", tr.entries === 3, `in ${tr.entries}`);
}

// 6d. Remembering has a limit, and forgetting has an order: the oldest go
//     first, because the person who walked in two hours ago and hasn't been
//     seen since is the one least likely to be about to walk through again.
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("there is a cap on how many people are remembered", /const MOST_REMEMBERED = \d+;/.test(src));
  ok("and the oldest are dropped first",
     /this\.known\.splice\(0, this\.known\.length - MOST_REMEMBERED\)/.test(src));
  ok("nobody is remembered who was never counted",
     /if \(!t\.countedIn && !t\.countedOut && !t\.uniqued\) return;/.test(src));
  ok("a fresh start counts everybody again at the door",
     /this\.known = \[\];\s*\n(?:.*\n)*?\s*for \(const t of this\.tracks\) \{ t\.countedIn = false; t\.countedOut = false; t\.arrived = false; \}/.test(src));
  // And a room camera is in neither figure at all now. It has no line for
  // anybody to cross, and the thing it used to call an arrival — "I have
  // become sure there is a person here" — it says again every time it loses
  // somebody and finds them. That is what produced "1 person on the camera
  // and 6 came in". See tests/test_no_false_entries.mjs.
  ok("and a room camera produces neither figure",
     /private cameInRoom\(_t: Track\): void \{\s*\n\s*\/\/ Deliberately nothing\./.test(src)
     && /if \(t\.arrived\) this\.exits\+\+;/.test(src));
  ok("and the live count never blinks to nothing to achieve it",
     /counted: boolean;\s+\/\/ confirmed to be a person/.test(src)
     && !/for \(const t of this\.tracks\) t\.counted = false;/.test(src));

  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("the end of a service reaches the counting browser",
     /if \(service !== serviceRef\.current\)/.test(ctx) && /c\.tracker\.forgetPeople\(\)/.test(ctx));
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("and the website tells it which service is running",
     /service: \(await this\.get\("service_live", null\)\)\?\.id \?\? null/.test(worker));
}

// 7. And the margin is what does that: when several people fit about equally
//    well, "looks the same" is worth nothing.
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("a match must be strong", /const SAME_LOOK = 0\.\d+;/.test(src));
  ok("and a clear winner", /const LOOK_MARGIN = 0\.\d+;/.test(src)
     && /best - second >= LOOK_MARGIN/.test(src));
  ok("and recent", /const RETURN_BY_LOOK_MS = /.test(src));
}

// 8. What leaves the browser.
//
//    This changed, and it is worth being exact about. Appearance readings used
//    to stay in the browser entirely. They now travel to the website, because
//    the register of people lives there — it is the only place one camera's
//    sighting can be compared with another's, which is the whole of
//    cross-camera identity.
//
//    What travels is eight numbers: two colours as a share of the light, two
//    brightnesses, a shape and a height. Never a picture, never a crop of
//    anybody, nothing that could be turned back into one. A face code travels
//    only while face matching is switched on, as it already did, and the
//    website refuses to put one in the register otherwise.
{
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  const reports = ctx.slice(ctx.indexOf("const reports: CameraReport[]"), ctx.indexOf("try {", ctx.indexOf("const reports")));
  /**
   * The check used to ban the WORD "canvas" from this block, which is not the
   * same thing as banning a picture. The report now carries the size of the
   * picture the AI was given — grabCanvas.width — because a box only means
   * something alongside the picture it was measured in, and getting that
   * wrong drew five green boxes on a ceiling. A width is a number.
   *
   * So the ban is on the things that actually turn a canvas into a picture.
   */
  ok("what is sent is numbers, not a picture",
     /l: x\.look \? \[x\.look\.top\[0\]/.test(reports)
     && !/toDataURL|toBlob|getImageData|convertToBlob|jpeg|png|base64/i.test(reports));
  ok("and a canvas is only ever asked how big it is",
     [...reports.matchAll(/grabCanvas\.(\w+)/g)].every(([, m]) => m === "width" || m === "height"),
     [...reports.matchAll(/grabCanvas\.\w+/g)].map((m) => m[0]).join(", "));
  ok("a face only travels while face matching is on", /f: faceOnRef\.current && x\.face \? packFace/.test(reports));
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("and the website refuses to register one otherwise",
     /face: faceOk && typeof x\.f === "string" \? unpackFace\(x\.f\) : null,/.test(worker));
  ok("faces are never written to storage", /leaves every face code behind on purpose/.test(worker));
  const identity = fs.readFileSync(path.join(root, "worker/identity.js"), "utf8");
  const snap = identity.slice(identity.indexOf("  snapshot() {"), identity.indexOf("  restore(snap)"));
  ok("the saved register holds no face data", !/faces:/.test(snap), snap.slice(0, 160));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. Recognised when it is sure, and a stranger when it isn't.");
process.exit(fails ? 1 : 0);
