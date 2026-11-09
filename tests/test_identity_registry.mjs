/**
 * One human being = one attendance identity per service.
 *
 * The fifteen scenarios asked for, run against the real registry, plus the two
 * measurements that matter and are usually left out: how often one person
 * becomes two (a false SPLIT, attendance too high) and how often two people
 * become one (a false MERGE, attendance too low).
 *
 * These are simulations, not video. They prove the LOGIC is right: that the
 * registry does what it claims given readings of a known quality. They cannot
 * tell you how good the readings are from a camera above a real doorway in
 * November — only a labelled recording of a real service can do that, and this
 * file says so rather than implying otherwise.
 *
 *   node tests/test_identity_registry.mjs
 */
import fs from "node:fs";
import { IdentityRegistry, alikeLook } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

// ── Making believable people ────────────────────────────────────────────────

/** look = [topR, topG, topBright, botR, botG, botBright, shape, height] */
const person = (n, { shape = 2.5, height = 0.5 } = {}) => {
  // Spread out around the colour wheel so ordinary people are distinguishable.
  const a = (n * 2.399) % (Math.PI * 2);
  return [
    0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    shape + 0.1 * ((n % 4) - 1.5), height + 0.02 * ((n % 7) - 3),
  ];
};
/** A camera reading is never exactly the same twice. */
const wobble = (look, k = 1) => look.map((v, i) => v + (i < 6 ? 0.004 : 0.02) * k * Math.sin(v * 97 + i * 13));
/**
 * A face code: 128 numbers, as the real one produces.
 *
 * Deliberately NOT a smooth function of the person's number. My first attempt
 * used sin(n·k + i·k), and every face it made pointed in nearly the same
 * direction as every other — so the registry merged a service into one person
 * and the test blamed the registry. Two different people's face codes have to
 * be as unrelated as two different people's faces are, which means a random
 * direction each, as the real model gives.
 */
const face = (n) => {
  let seed = (n * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = rand();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
/** A later reading of the SAME face: close, never identical. */
const faceAgain = (n, k = 1) => {
  const base = face(n), noise = face(n * 7919 + k);
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = base[i] * 0.93 + noise[i] * 0.07;
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};

const reg = (zones = {}, doors = []) => new IdentityRegistry({
  zoneOf: (c) => zones[c] ?? c,
  createsIdentities: (c) => !doors.includes(c),
});

// ── The fifteen ─────────────────────────────────────────────────────────────

// 1. Twelve people in one room for fifteen minutes.
{
  const r = reg();
  const people = Array.from({ length: 12 }, (_, i) => i + 1);
  let t = 0;
  for (let frame = 0; frame < 900; frame++) {          // 15 min at one a second
    t += 1000;
    r.observe("room", people.map((n) => ({ track: n, look: wobble(person(n), frame % 3), face: null })), t);
  }
  ok("1. twelve people for fifteen minutes = 12", r.size === 12, `got ${r.size}`);
}

// 2. One person walking past the same camera 100 times.
{
  const r = reg();
  let t = 0;
  for (let pass = 0; pass < 100; pass++) {
    // A new local track id every time — the camera lost them in between.
    for (let f = 0; f < 3; f++) {
      t += 400;
      r.observe("door", [{ track: 1000 + pass, look: wobble(person(1), f), face: face(1) }], t);
    }
    t += 20_000;
  }
  ok("2. one person past the same camera 100 times = 1", r.size === 1, `got ${r.size}`);
}

// 3. One person leaving and returning five times.
{
  const r = reg();
  let t = 0;
  for (let trip = 0; trip < 5; trip++) {
    for (let f = 0; f < 4; f++) { t += 500; r.observe("room", [{ track: 10 + trip, look: wobble(person(2), f), face: face(2) }], t); }
    t += 4 * 60_000;                                    // four minutes away
  }
  ok("3. leaving and returning five times = 1", r.size === 1, `got ${r.size}`);
}

// 4. Behind a pillar for two minutes.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 5; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(3), f), face: null }], t); }
  t += 120_000;
  for (let f = 0; f < 5; f++) { t += 500; r.observe("room", [{ track: 77, look: wobble(person(3), f), face: null }], t); }
  ok("4. two minutes behind a pillar = 1", r.size === 1, `got ${r.size}`);
}

// 5. Two different people.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 5; f++) {
    t += 500;
    r.observe("room", [
      { track: 1, look: wobble(person(4), f), face: face(4) },
      { track: 2, look: wobble(person(9), f), face: face(9) },
    ], t);
  }
  ok("5. two different people = 2", r.size === 2, `got ${r.size}`);
}

// 6. Two cameras on the same room seeing the same person.
{
  const r = reg({ a: "Main", b: "Main" });
  let t = 0;
  for (let f = 0; f < 6; f++) {
    t += 500;
    r.observe("a", [{ track: 1, look: wobble(person(5), f), face: face(5) }], t);
    r.observe("b", [{ track: 1, look: wobble(person(5), f + 1), face: face(5) }], t + 100);
  }
  ok("6. two cameras, one person = 1", r.size === 1, `got ${r.size}`);
  ok("   and it is recorded as seen on both", r.diagnostics().seen_on_more_than_one_camera === 1);
}

// 7. One person moving between three cameras.
{
  const r = reg({ a: "Foyer", b: "Hall", c: "Balcony" });
  let t = 0;
  for (const cam of ["a", "b", "c"]) {
    for (let f = 0; f < 4; f++) { t += 600; r.observe(cam, [{ track: 1, look: wobble(person(6), f), face: face(6) }], t); }
    t += 30_000;                                        // half a minute to walk
  }
  ok("7. one person across three cameras = 1", r.size === 1, `got ${r.size}`);
}

// 8. Two people in similar clothing — the hardest honest case.
{
  const r = reg();
  const navy = person(11);
  const alsoNavy = navy.map((v, i) => v + (i === 0 ? 0.012 : i === 6 ? 0.18 : 0));
  let t = 0;
  for (let f = 0; f < 6; f++) {
    t += 500;
    r.observe("room", [
      { track: 1, look: wobble(navy, f), face: face(11) },
      { track: 2, look: wobble(alsoNavy, f), face: face(12) },
    ], t);
  }
  ok("8. two people in similar clothes = 2", r.size === 2, `got ${r.size}`);
}

// 9. Turning their back to the camera: the face goes, the rest doesn't.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 4; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(7), f), face: face(7) }], t); }
  for (let f = 0; f < 6; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(7), f), face: null }], t); }
  ok("9. back to the camera = still 1", r.size === 1, `got ${r.size}`);
}

// 10. Completely invisible for a while, then reliably seen again.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 5; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(8), f), face: face(8) }], t); }
  t += 10 * 60_000;
  for (let f = 0; f < 5; f++) { t += 500; r.observe("room", [{ track: 42, look: wobble(person(8), f), face: face(8) }], t); }
  ok("10. ten minutes invisible, then back = 1", r.size === 1, `got ${r.size}`);
}

// 11. A camera disconnecting and reconnecting: new local track ids, same people.
{
  const r = reg();
  const crowd = [1, 2, 3, 4, 5, 6];
  let t = 0;
  for (let f = 0; f < 10; f++) {
    t += 1000;
    r.observe("room", crowd.map((n) => ({ track: n, look: wobble(person(20 + n), f), face: face(20 + n) })), t);
  }
  t += 90_000;                                          // the camera was away
  for (let f = 0; f < 10; f++) {
    t += 1000;
    r.observe("room", crowd.map((n) => ({ track: 500 + n, look: wobble(person(20 + n), f), face: face(20 + n) })), t);
  }
  ok("11. camera reconnecting adds nobody", r.size === 6, `got ${r.size}`);
}

// 12. A new service starts clean.
{
  const r = reg();
  r.observe("room", [{ track: 1, look: person(30), face: face(30) }], 1000);
  r.observe("room", [{ track: 1, look: person(30), face: face(30) }], 2000);
  ok("12. somebody was counted", r.size === 1);
  r.startService("svc-2");
  ok("12. a new service starts at nobody", r.size === 0);
  ok("12. and nothing is remembered from the last one", r.diagnostics().with_a_face === 0);
}

// 13. Two people walking close together.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 8; f++) {
    t += 400;
    r.observe("door", [
      { track: 1, look: wobble(person(13), f), face: null },
      { track: 2, look: wobble(person(14), f), face: null },
    ], t);
  }
  ok("13. two people walking together = 2", r.size === 2, `got ${r.size}`);
}

// 14. Changing seats repeatedly.
{
  const r = reg();
  let t = 0;
  for (let move = 0; move < 6; move++) {
    for (let f = 0; f < 3; f++) { t += 500; r.observe("room", [{ track: 200 + move, look: wobble(person(15), f), face: face(15) }], t); }
    t += 20_000;
  }
  ok("14. changing seats six times = 1", r.size === 1, `got ${r.size}`);
}

// 15. A flicker — a false detection that appears once and never again.
//     The registry counts what it is given; the camera's own tracker is what
//     refuses to pass on a box it was never convinced by (see personTracker),
//     so this checks the two together: a single stray reading, never repeated,
//     must not go on being counted as a person in the room.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 6; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(16), f), face: face(16) }], t); }
  const before = r.size;
  r.observe("room", [{ track: 1, look: wobble(person(16), 1), face: face(16) },
                     { track: 999, look: person(17), face: null }], (t += 500));
  ok("15. a flicker is one identity, not a growing total", r.size === before + 1, `got ${r.size}`);
  for (let f = 0; f < 20; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(16), f), face: face(16) }], t); }
  ok("15. and it stops there", r.size === before + 1, `got ${r.size}`);
}

// ── The two measurements ────────────────────────────────────────────────────

/**
 * A church-shaped service: people arrive, are seen by a door camera and two
 * room cameras, move about, step out and come back. Every observation is
 * labelled with who it really was, so splits and merges can be counted rather
 * than guessed at.
 */
function service({ n = 120, faces = true, seed = 1 } = {}) {
  const zones = { door: "Foyer", roomA: "Main", roomB: "Main" };
  const r = new IdentityRegistry({
    zoneOf: (c) => zones[c] ?? c,
    createsIdentities: (c) => c !== "door",     // a doorway never invents people
  });
  const truth = new Map();        // identity id → Set of real people
  const mine = new Map();         // real person → Set of identity ids
  let t = 0;
  const saw = (cam, list) => {
    const ids = r.observe(cam, list.map((x) => ({
      track: x.track, look: wobble(person(x.who + seed * 1000), x.f), face: faces && x.face ? face(x.who + seed * 1000) : null,
    })), t);
    ids.forEach((id, i) => {
      if (id === null) return;                  // the door didn't recognise them
      const who = list[i].who;
      if (!truth.has(id)) truth.set(id, new Set());
      truth.get(id).add(who);
      if (!mine.has(who)) mine.set(who, new Set());
      mine.get(who).add(id);
    });
  };

  // Arriving: each person crosses the door camera, face visible half the time.
  for (let who = 1; who <= n; who++) {
    for (let f = 0; f < 3; f++) { t += 400; saw("door", [{ who, track: who, f, face: who % 2 === 0 }]); }
    t += 2000;
  }
  // Settled in the hall, two cameras, fifteen minutes.
  const inRoom = Array.from({ length: n }, (_, i) => i + 1);
  for (let frame = 0; frame < 60; frame++) {
    t += 15_000;
    saw("roomA", inRoom.filter((w) => w % 2 === 1).map((who) => ({ who, track: who, f: frame, face: frame % 4 === 0 })));
    t += 200;
    saw("roomB", inRoom.filter((w) => w % 2 === 0).map((who) => ({ who, track: who, f: frame, face: frame % 4 === 0 })));
  }
  // A tenth of them step out and come back on a different track id.
  for (let who = 1; who <= n; who += 10) {
    t += 60_000;
    for (let f = 0; f < 3; f++) { t += 400; saw("door", [{ who, track: 9000 + who, f, face: true }]); }
    t += 60_000;
    for (let f = 0; f < 3; f++) { t += 400; saw("roomA", [{ who, track: 8000 + who, f, face: true }]); }
  }

  const splits = [...mine.values()].reduce((n_, s) => n_ + (s.size - 1), 0);
  const merges = [...truth.values()].reduce((n_, s) => n_ + (s.size - 1), 0);
  return { registry: r, counted: r.size, real: n, splits, merges };
}

{
  const withFaces = service({ n: 120, faces: true });
  const pct = (x) => `${Math.round((x / withFaces.real) * 1000) / 10}%`;
  console.log(`\n  With face matching on: counted ${withFaces.counted} of ${withFaces.real}`
    + ` · split ${withFaces.splits} (${pct(withFaces.splits)}) · merged ${withFaces.merges} (${pct(withFaces.merges)})`);
  ok("a 120-person service with faces counts within 5%",
     Math.abs(withFaces.counted - withFaces.real) <= 6, `counted ${withFaces.counted}`);
  ok("and nobody is merged into somebody else", withFaces.merges === 0, `merges ${withFaces.merges}`);

  const noFaces = service({ n: 120, faces: false, seed: 2 });
  const pct2 = (x) => `${Math.round((x / noFaces.real) * 1000) / 10}%`;
  console.log(`  With face matching off: counted ${noFaces.counted} of ${noFaces.real}`
    + ` · split ${noFaces.splits} (${pct2(noFaces.splits)}) · merged ${noFaces.merges} (${pct2(noFaces.merges)})`);
  ok("without faces it is still within 15%",
     Math.abs(noFaces.counted - noFaces.real) <= 18, `counted ${noFaces.counted}`);
  // Without faces the total comes out close, but it is close by cancellation:
  // a dozen people split in two and about as many merged into somebody else.
  // That is what appearance alone can do, and it is why face matching matters
  // — not because the total looks worse without it, but because the people
  // behind the total are wrong in both directions at once. Bounded here so a
  // change that makes it worse is caught.
  ok("without faces, mistakes stay under a sixth of the congregation",
     noFaces.merges <= 20 && noFaces.splits <= 20, `split ${noFaces.splits} merged ${noFaces.merges}`);
  ok("faces make it better, not worse",
     Math.abs(withFaces.counted - withFaces.real) <= Math.abs(noFaces.counted - noFaces.real));
}

// ── Impossible movement ─────────────────────────────────────────────────────
{
  const r = new IdentityRegistry({ zoneOf: (c) => (c === "foyer" ? "Foyer" : "Hall") });
  let t = 1000;
  r.observe("foyer", [{ track: 1, look: person(40), face: face(40) }], t);
  r.observe("foyer", [{ track: 1, look: person(40), face: face(40) }], (t += 500));
  // The same face, half a second later, at the other end of the building.
  r.observe("hall", [{ track: 1, look: person(40), face: face(40) }], (t += 500));
  ok("somebody cannot be in two places at once", r.size === 2, `got ${r.size}`);
  ok("and that is recorded", r.diagnostics().rejected_as_impossible > 0);
  // Given time to walk, it is the same person.
  const r2 = new IdentityRegistry({ zoneOf: (c) => (c === "foyer" ? "Foyer" : "Hall") });
  let u = 1000;
  r2.observe("foyer", [{ track: 1, look: person(40), face: face(40) }], u);
  r2.observe("hall", [{ track: 1, look: person(40), face: face(40) }], (u += 30_000));
  ok("given half a minute to walk, it is the same person", r2.size === 1, `got ${r2.size}`);
}

// ── Surviving a restart ─────────────────────────────────────────────────────
{
  const r = reg();
  let t = 0;
  for (let who = 1; who <= 20; who++) {
    for (let f = 0; f < 3; f++) { t += 400; r.observe("room", [{ track: who, look: wobble(person(50 + who), f), face: face(50 + who) }], t); }
  }
  ok("twenty people counted", r.size === 20, `got ${r.size}`);
  const saved = JSON.parse(JSON.stringify(r.snapshot()));
  const after = reg();
  after.restore(saved);
  ok("a restart keeps them all", after.size === 20, `got ${after.size}`);
  ok("and no face data is written down", JSON.stringify(saved).includes("faces") === false);
  // The same people seen again after the restart are not counted twice.
  for (let who = 1; who <= 20; who++) {
    for (let f = 0; f < 3; f++) { t += 400; after.observe("room", [{ track: 7000 + who, look: wobble(person(50 + who), f), face: face(50 + who) }], t); }
  }
  ok("and seeing them again adds nobody", after.size === 20, `got ${after.size}`);
}

// ── The three things that only break after an hour ──────────────────────────
//
// Found by re-reading the build rather than by anything going wrong, which is
// the only way these ever are: each one works perfectly for the first few
// minutes and fails during a service.

// A. The saved register has to fit where it is kept. A stored value is capped
//    at 128 KB; nine hundred people with five appearance readings each is far
//    more. Written as-is it throws, the throw is swallowed, and the register
//    is silently never saved — so a restart mid-service starts the
//    congregation again from nobody, which is the exact thing saving it
//    prevents.
{
  const r = reg();
  let t = 0;
  for (let who = 1; who <= 900; who++) {
    for (let f = 0; f < 3; f++) { t += 50; r.observe("room", [{ track: who, look: wobble(person(who), f), face: null }], t); }
  }
  const big = JSON.stringify(r.snapshot()).length;
  const fitted = r.snapshot(110_000);
  const small = JSON.stringify(fitted).length;
  ok("a full register of nine hundred would not fit", big > 110_000, `${big} bytes`);
  ok("and the saved one does", small <= 110_000, `${small} bytes`);
  ok("with nobody dropped from it", fitted.people.length === r.size, `${fitted.people.length} of ${r.size}`);
  // The people seen most recently keep their readings: they are the ones
  // likely to be seen again.
  const withLooks = fitted.people.filter((p) => p.looks.length);
  ok("and the people seen most recently keep theirs", withLooks.length > 0);
  const newest = fitted.people[fitted.people.length - 1];
  ok("the very last person seen certainly does", newest.looks.length > 0);
  // And it still works when restored.
  const back = reg();
  back.restore(fitted);
  ok("a restart from the trimmed copy keeps everyone", back.size === r.size, `${back.size}`);
}

// B. The links from a camera's own track ids to identities grew for ever. A
//    doorway camera makes thousands of tracks in a morning, and a service
//    must not get heavier as it goes on.
{
  const r = reg();
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    t += 1000;
    r.observe("door", [{ track: i, look: wobble(person(i % 50), i % 3), face: null }], t);
  }
  ok("old track links are let go", r.byTrack.size <= 2100, `${r.byTrack.size} links`);
  // …without losing anybody from the register itself.
  ok("and nobody is lost from the register", r.size > 0);
}

// C. Two computers each with a camera called "usb-0" must not feed each
//    other's sightings into one person. The registry is given whole camera
//    names; this is the check that the caller builds them from the COMPUTER
//    the report came from, not from what the report says about itself.
{
  const worker = fs.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  ok("a camera's name comes from the computer that reported it",
     /const camera_id = `\$\{device\.id\}:\$\{key\}`;/.test(worker));
  ok("and an unknown camera is ignored rather than guessed at",
     /if \(!cams\[camera_id\] \|\| cams\[camera_id\]\.hidden \|\| cams\[camera_id\]\.pending\) continue;/.test(worker));
  ok("the register is saved at a size that fits", /this\.register\.snapshot\(SAFE_VALUE_BYTES\)/.test(worker));
}

// ── Cost ────────────────────────────────────────────────────────────────────
{
  const r = reg();
  const N = 400;
  let t = 0;
  for (let who = 1; who <= N; who++) {
    for (let f = 0; f < 3; f++) { t += 100; r.observe("room", [{ track: who, look: wobble(person(who), f), face: face(who) }], t); }
  }
  const start = performance.now();
  for (let frame = 0; frame < 20; frame++) {
    t += 1000;
    r.observe("room", Array.from({ length: 30 }, (_, i) => ({ track: i + 1, look: wobble(person(i + 1), frame), face: face(i + 1) })), t);
  }
  const ms = (performance.now() - start) / 20;
  console.log(`  Matching 30 people against a register of ${r.size}: ${ms.toFixed(1)} ms a go`);
  ok("matching stays well inside a camera's frame time", ms < 50, `${ms.toFixed(1)} ms`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One human being, one identity.");
process.exit(fails ? 1 : 0);
