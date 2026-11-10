/**
 * People and seats, joined up — and the choir.
 *
 * The case that makes this hard, and that was asked for by name: the choir
 * wear the same robes and the ushers wear the same jackets. Appearance
 * matching, which is what Kyro falls back on when it cannot see a face, is
 * worth exactly nothing there — and worse than nothing, because "they look the
 * same" is TRUE of twenty different people. Left alone it would quietly merge
 * a choir into three or four people and report an attendance that is wrong
 * downwards with nothing on the screen to show for it.
 *
 * So appearance is refused outright when too many known people look alike, and
 * the seat somebody was sitting in can only ever support a match, never make
 * one — because a choir stand is a row of identical people where the seat is
 * doing all the work, which is exactly when it is least safe to trust it.
 *
 *   node tests/test_people_and_seats.mjs
 */
import fs from "node:fs";
import { IdentityRegistry, UNIFORM_CROWD } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

// ── People ─────────────────────────────────────────────────────────────────
const person = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3)];
};
/** A choir robe: everybody in it reads almost exactly the same. */
const robe = (n) => [0.30, 0.30, 0.22, 0.30, 0.30, 0.24, 2.5 + 0.01 * (n % 3), 0.50 + 0.002 * (n % 4)];
/**
 * A reading of the same garment is never identical twice — but the variation
 * does not GROW the longer you look at it, which is what my first version did:
 * multiplying the noise by the frame number made two readings of one choir
 * robe differ more than two different people's coats, so the uniform the whole
 * test is about stopped looking like a uniform.
 */
const wobble = (l, k = 1) => l.map((v, i) => v + (i < 6 ? 0.004 : 0.02) * Math.sin(v * 97 + i * 13 + k));
const face = (n) => {
  let seed = (n * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = rand();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
const reg = (zones = {}) => new IdentityRegistry({ zoneOf: (c) => zones[c] ?? c });

// ── 1. Sitting down and standing up, over and over ─────────────────────────
{
  const r = reg();
  let t = 0;
  let id = null;
  for (let go = 0; go < 6; go++) {
    // Sitting in A4.
    for (let f = 0; f < 3; f++) {
      t += 1000;
      const got = r.observe("room", [{ track: 1, look: wobble(person(1), f), face: face(1), seat: "K4" }], t);
      id ??= got[0];
      if (got[0] !== id) ok("1. the same person throughout", false, `became ${got[0]}`);
    }
    // Standing up: still there, no seat.
    for (let f = 0; f < 3; f++) {
      t += 1000;
      r.observe("room", [{ track: 1, look: wobble(person(1), f), face: face(1), seat: null }], t);
    }
  }
  ok("1. standing up and sitting down six times is one person", r.size === 1, `got ${r.size}`);
  ok("1. and their seat is let go when they stand", r.diagnostics().seated_now === 0);
}

// ── 2. Moving between several seats ────────────────────────────────────────
{
  const r = reg();
  let t = 0;
  for (const seat of ["K1", "K7", "K12"]) {
    for (let f = 0; f < 3; f++) {
      t += 2000;
      r.observe("room", [{ track: 1, look: wobble(person(2), f), face: face(2), seat }], t);
    }
  }
  ok("2. three seats, one person", r.size === 1, `got ${r.size}`);
  ok("2. only the last seat is theirs", r.diagnostics().seated_now === 1, `${r.diagnostics().seated_now} seats held`);
  ok("2. and the moves are recorded as moves", r.diagnostics().changed_seats === 2, `${r.diagnostics().changed_seats}`);
}

// ── 3. Disappearing from view for a while ──────────────────────────────────
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 3; f++) { t += 1000; r.observe("room", [{ track: 1, look: wobble(person(3), f), face: face(3), seat: "K2" }], t); }
  t += 5 * 60_000;                                      // five minutes out of sight
  for (let f = 0; f < 3; f++) { t += 1000; r.observe("room", [{ track: 99, look: wobble(person(3), f), face: face(3), seat: "K2" }], t); }
  ok("3. gone five minutes and back is one person", r.size === 1, `got ${r.size}`);
}

// ── 4 & 5. Two cameras, one person, one row of seats ───────────────────────
{
  const r = reg({ left: "Main", right: "Main" });
  let t = 0;
  for (let f = 0; f < 4; f++) {
    t += 1000;
    r.observe("left", [{ track: 1, look: wobble(person(4), f), face: face(4), seat: "K3" }], t);
    r.observe("right", [{ track: 8, look: wobble(person(4), f + 1), face: face(4), seat: "K9" }], t + 100);
  }
  ok("4. two cameras seeing one person is one person", r.size === 1, `got ${r.size}`);
  // 5. The same physical chair has a different seat id on each camera, because
  //    each camera finds its own seats. One person is in one of them at a
  //    time: whichever camera saw them last. What must never happen is the
  //    person being split in two by the disagreement.
  ok("5. and they hold one seat, not two", r.diagnostics().seated_now === 1, `${r.diagnostics().seated_now}`);
}

// ── 6. Two different people in similar seats ───────────────────────────────
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 4; f++) {
    t += 1000;
    r.observe("room", [
      { track: 1, look: wobble(person(5), f), face: face(5), seat: "K1" },
      { track: 2, look: wobble(person(6), f), face: face(6), seat: "K2" },
    ], t);
  }
  ok("6. two people in neighbouring seats are two people", r.size === 2, `got ${r.size}`);
  ok("6. in two seats", r.diagnostics().seated_now === 2);
}

// ── 7. Walking past a seat ─────────────────────────────────────────────────
{
  const r = reg();
  let t = 0;
  // The seat finder decides whether somebody is IN a seat; by the time the
  // register hears about it, a passer-by has no seat at all.
  for (let f = 0; f < 4; f++) { t += 500; r.observe("room", [{ track: 1, look: wobble(person(7), f), face: face(7), seat: null }], t); }
  ok("7. walking past takes no seat", r.diagnostics().seated_now === 0);
  ok("7. and they are still counted as a person", r.size === 1);
}

// ── 8 & 9. Leaving a seat but not the building; leaving and coming back ────
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 3; f++) { t += 1000; r.observe("room", [{ track: 1, look: wobble(person(8), f), face: face(8), seat: "K5" }], t); }
  // Up and wandering about for ten minutes — in the building, in no seat.
  for (let f = 0; f < 10; f++) { t += 60_000; r.observe("room", [{ track: 1, look: wobble(person(8), f), face: face(8), seat: null }], t); }
  ok("8. leaving a seat is not leaving the building", r.size === 1, `got ${r.size}`);
  ok("8. and the seat is free for somebody else", r.diagnostics().seated_now === 0);
  // Out of the room altogether, then back, on a new track id.
  t += 20 * 60_000;
  for (let f = 0; f < 3; f++) { t += 1000; r.observe("room", [{ track: 404, look: wobble(person(8), f), face: face(8), seat: "K5" }], t); }
  ok("9. leaving and returning is still one person", r.size === 1, `got ${r.size}`);
}

// ── 10. The counting browser restarting ────────────────────────────────────
{
  const r = reg();
  let t = 0;
  for (let who = 1; who <= 12; who++) {
    for (let f = 0; f < 3; f++) {
      t += 400;
      r.observe("room", [{ track: who, look: wobble(person(20 + who), f), face: face(20 + who), seat: `K${who}` }], t);
    }
  }
  ok("10. twelve people, twelve seats", r.size === 12 && r.diagnostics().seated_now === 12,
     `${r.size} people, ${r.diagnostics().seated_now} seats`);
  const back = reg();
  back.restore(JSON.parse(JSON.stringify(r.snapshot())));
  ok("10. a restart keeps every person", back.size === 12, `${back.size}`);
  ok("10. and who was sitting where", back.diagnostics().seated_now === 12, `${back.diagnostics().seated_now}`);
  // Everyone seen again on new track ids after the restart: nobody is added.
  for (let who = 1; who <= 12; who++) {
    for (let f = 0; f < 3; f++) {
      t += 400;
      back.observe("room", [{ track: 5000 + who, look: wobble(person(20 + who), f), face: face(20 + who), seat: `K${who}` }], t);
    }
  }
  ok("10. and seeing them all again adds nobody", back.size === 12, `${back.size}`);
}

// ── The choir ──────────────────────────────────────────────────────────────

// 11. Twenty people in identical robes, no faces readable (they are facing the
//     congregation, the camera is behind them). Appearance must be refused:
//     twenty people must stay twenty people.
{
  const r = reg();
  let t = 0;
  const choir = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let f = 0; f < 10; f++) {
    t += 2000;
    r.observe("choir", choir.map((n) => ({ track: n, look: wobble(robe(n), f), face: null, seat: `K${n}` })), t);
  }
  ok("11. twenty in identical robes are twenty people", r.size === 20, `got ${r.size}`);
  // Nothing has been asked of appearance yet: the camera has been following
  // all twenty without a break, which is the strongest evidence there is and
  // the reason this looks easy. The test that matters is what happens when
  // that breaks.
  ok("11. so far it is the camera's tracking doing the work",
     r.diagnostics().matched_by_track > 0 && r.diagnostics().in_a_uniform === 0);

  // One of them steps out and comes back on a new track. Without a face there
  // is nothing to recognise them by, so they are counted again — the honest
  // cost of refusing to merge. It must be ONE extra, not a collapse.
  //
  // Four sightings, because a sighting with no face has to keep not matching
  // anybody for that long before Kyro will call it somebody new — see
  // NEW_PERSON_NO_FACE. Fewer than that and they cost nothing at all, which
  // is better still, but this is the case that has to be bounded.
  t += 3 * 60_000;
  for (let f = 0; f < 4; f++) {
    t += 1000;
    r.observe("choir", [{ track: 900, look: wobble(robe(7), f), face: null, seat: "K7" }], t);
  }
  ok("11. appearance was refused, because they are all dressed alike",
     r.diagnostics().in_a_uniform > 0, `${r.diagnostics().in_a_uniform}`);
  ok("11. one unrecognised return costs one person, not twenty", r.size === 21, `got ${r.size}`);
}

// 11b. The worst case, measured rather than assumed: the camera drops and
//      reconnects, so all twenty robed singers arrive with new track numbers
//      at once and nothing but their robes to go on.
//
//      Kyro has two ways to be wrong here and they are not equal. Merging them
//      would report a choir of three or four and look perfectly calm. Refusing
//      to merge counts some of them twice, which is visible, checkable, and
//      the direction the church can correct for. It takes the second.
{
  const noFaces = reg();
  let t = 0;
  const choir = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let f = 0; f < 6; f++) {
    t += 2000;
    noFaces.observe("choir", choir.map((n) => ({ track: n, look: wobble(robe(n), f), face: null, seat: `K${n}` })), t);
  }
  t += 2 * 60_000;                                     // the camera was away
  for (let f = 0; f < 6; f++) {
    t += 2000;
    noFaces.observe("choir", choir.map((n) => ({ track: 700 + n, look: wobble(robe(n), f), face: null, seat: `K${n}` })), t);
  }
  const withFaces = reg();
  let u = 0;
  for (let f = 0; f < 6; f++) {
    u += 2000;
    withFaces.observe("choir", choir.map((n) => ({ track: n, look: wobble(robe(n), f), face: face(600 + n), seat: `K${n}` })), u);
  }
  u += 2 * 60_000;
  for (let f = 0; f < 6; f++) {
    u += 2000;
    withFaces.observe("choir", choir.map((n) => ({ track: 700 + n, look: wobble(robe(n), f), face: face(600 + n), seat: `K${n}` })), u);
  }
  console.log(`\n  A choir of 20 in identical robes, camera drops and reconnects:`
    + ` without faces Kyro counts ${noFaces.size}, with faces ${withFaces.size}\n`);
  ok("11b. without faces, nobody is merged away", noFaces.size >= 20, `got ${noFaces.size}`);
  ok("11b. with faces, it is exactly right", withFaces.size === 20, `got ${withFaces.size}`);
  ok("11b. so faces are what make a choir countable", withFaces.size < noFaces.size);
}

// 12. The same choir WITH faces: the robes say nothing, the faces say
//     everything, and stepping out and back costs nothing.
{
  const r = reg();
  let t = 0;
  const choir = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let f = 0; f < 10; f++) {
    t += 2000;
    r.observe("choir", choir.map((n) => ({ track: n, look: wobble(robe(n), f), face: face(500 + n), seat: `K${n}` })), t);
  }
  ok("12. twenty robed singers with faces are twenty people", r.size === 20, `got ${r.size}`);
  t += 3 * 60_000;
  for (let f = 0; f < 3; f++) {
    t += 1000;
    r.observe("choir", [{ track: 900, look: wobble(robe(7), f), face: face(507), seat: "K7" }], t);
  }
  ok("12. and one of them coming back is recognised", r.size === 20, `got ${r.size}`);
}

// 13. Ushers in identical jackets, moving about the building between cameras.
//     Nothing may merge them, and nothing may let the seat they once sat in
//     stand in for knowing who they are.
{
  const r = reg({ foyer: "Foyer", hall: "Main" });
  let t = 0;
  const ushers = [1, 2, 3, 4, 5];
  for (let f = 0; f < 6; f++) {
    t += 3000;
    r.observe("hall", ushers.map((n) => ({ track: n, look: wobble(robe(n + 40), f), face: null, seat: null })), t);
  }
  ok("13. five ushers dressed alike are five people", r.size === 5, `got ${r.size}`);
  const seatHelped = r.diagnostics().helped_by_their_seat;
  ok("13. and no match was made on a seat alone", seatHelped === 0, `${seatHelped}`);
}

// 14. The rule itself: a seat can lift a nearly-good match over the line, and
//     can never make one on its own.
{
  const src = fs.readFileSync(new URL("../worker/identity.js", import.meta.url), "utf8");
  ok("14. a seat only ever adds to an appearance match", /const help = best\.sameSeat \? SEAT_HELPS : 0;/.test(src));
  ok("14. and what it adds is small", /export const SEAT_HELPS = 0\.0\d;/.test(src));
  ok("14. appearance is refused outright in a uniform", /const looks = uniform \? \[\] : scored/.test(src));
  ok("14. which cancels the seat's help with it", /const alike = scored\.filter\(\(x\) => x\.look >= LOOK_SAME\)\.length;/.test(src));
  ok("14. a uniform is more than two people looking alike", UNIFORM_CROWD >= 3, `${UNIFORM_CROWD}`);
}

// 15. Seats never touch attendance. A person with no seat counts; a seat with
//     no person counts for nothing.
{
  const r = reg();
  let t = 0;
  for (let f = 0; f < 4; f++) { t += 1000; r.observe("room", [{ track: 1, look: wobble(person(9), f), face: face(9), seat: null }], t); }
  ok("15. somebody standing all service is still counted", r.size === 1);
  // The same person in a seat, then out of it, then in another: still one.
  for (const seat of ["K1", null, "K2", null]) {
    for (let f = 0; f < 2; f++) { t += 1000; r.observe("room", [{ track: 1, look: wobble(person(9), f), face: face(9), seat }], t); }
  }
  ok("15. and moving in and out of seats never changes attendance", r.size === 1, `got ${r.size}`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One person, whichever seat they are in.");
process.exit(fails ? 1 : 0);
