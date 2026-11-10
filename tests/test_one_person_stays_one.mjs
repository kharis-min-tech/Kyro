/**
 * One person walking in and out of a camera is ONE person.
 *
 * What was reported: "there wasnt 4 different people, i was the only one, i
 * didnt not come in 4 times, nor did i leave once, i came in and left the
 * camera now its saying 7 different people".
 *
 * Attendance had just been moved onto the register of people, which is the
 * right place for it — and the register was inventing people. Each time she
 * walked back into shot the camera gave her a new track id, and the first
 * sighting of that track routinely arrives with NO FACE: a face is read every
 * four seconds, for the nearest few, and only when one is turned towards the
 * lens. So there was nothing to match on but the colour of her coat, which on
 * its own is not enough to be sure — and the register, finding no match,
 * created somebody new on the spot. A second later the face arrived and
 * matched the person it had just invented.
 *
 * Appearance is weak evidence in BOTH directions. It is not enough to say
 * "this is the same person" — that is what LOOK_ALONE is for — and it was
 * never enough to say "this is a DIFFERENT person" either. That half was the
 * one nobody had written down.
 *
 * So a sighting that matches nobody now waits. It is in the room from the
 * moment it is seen; it only becomes a different person in the register once
 * it has gone on not matching for several separate sightings — by which time
 * there has been a face to go on, if there was ever going to be one.
 *
 *   node tests/test_one_person_stays_one.mjs
 */
import fs from "node:fs";
import { IdentityRegistry, NEW_PERSON_WITH_FACE, NEW_PERSON_NO_FACE } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const person = (n, { shape = 2.5, height = 0.5 } = {}) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [
    0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    shape + 0.1 * ((n % 4) - 1.5), height + 0.02 * ((n % 7) - 3),
  ];
};
const wobble = (look, k = 1) => look.map((v, i) => v + (i < 6 ? 0.004 : 0.02) * k * Math.sin(v * 97 + i * 13));
const face = (n) => {
  let seed = (n * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = rand();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
const faceAgain = (n, k = 1) => {
  const base = face(n), noise = face(n * 7919 + k);
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = base[i] * 0.93 + noise[i] * 0.07;
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
const reg = () => new IdentityRegistry({ zoneOf: () => "room" });

const REPORT = 5_000;      // how often a counting computer reports
const FACE_EVERY = 4_000;  // how often it reads a face

/**
 * Her afternoon: one person, one camera, walking out of shot and back in
 * `trips` times. A new track id each return, and a face only on the reports
 * where the face AI happened to catch one.
 */
function inAndOut({ trips, stayReports = 3, faceLuck = () => true, lookDrift = 0 }) {
  const r = reg();
  let t = 1_000, track = 1, reads = 0;
  for (let trip = 0; trip < trips; trip++) {
    for (let i = 0; i < stayReports; i++) {
      t += REPORT;
      reads++;
      // A report comes every five seconds and a face is read every four, so a
      // report carries a face whenever there is one to read — which is only
      // when she is facing the camera. `faceLuck` decides that.
      const hasFace = REPORT >= FACE_EVERY && faceLuck(trip, i);
      r.observe("room", [{
        track,
        // Different distance, different light each time she comes back.
        look: wobble(person(1), trip * lookDrift + i),
        face: hasFace ? faceAgain(1, trip * 3 + i) : null,
      }], t);
    }
    t += 45_000;      // out of the room
    track += 1;       // and a brand new track id on the way back
  }
  return r;
}

// 1. The fault, exactly as reported. Four trips in and out; a face most of
//    the time, as it would be with face matching on.
{
  ok("four trips in and out is one person", inAndOut({ trips: 4 }).size === 1,
     `got ${inAndOut({ trips: 4 }).size}`);
  ok("seven trips is still one person", inAndOut({ trips: 7 }).size === 1,
     `got ${inAndOut({ trips: 7 }).size}`);
  ok("twenty trips is still one person", inAndOut({ trips: 20 }).size === 1,
     `got ${inAndOut({ trips: 20 }).size}`);
}

// 2. The hard version: she comes back facing away, so the FIRST report of
//    each return has no face at all. This is the exact moment a person used
//    to be invented.
{
  const r = inAndOut({ trips: 6, faceLuck: (trip, i) => i > 0 });
  ok("a return with no face on the first look is still one person", r.size === 1, `got ${r.size}`);
}

// 3. Face matching switched OFF entirely, and the light changing between
//    trips. Appearance alone, which is the weakest case there is.
{
  // Five reports a visit: with nothing but a coat to go on, four sightings
  // is what it takes to be called somebody new, so this is the case that
  // would break if the waiting were doing nothing.
  const r = inAndOut({ trips: 5, stayReports: 5, faceLuck: () => false, lookDrift: 1 });
  ok("with no faces at all, five trips is one person", r.size === 1, `got ${r.size}`);
}

// 4. A glance that never repeats is never a person. A reflection, a coat over
//    a chair, a detection that flickers once — none of them belongs in a
//    church's attendance figures for good.
{
  const r = reg();
  let t = 1_000;
  // Somebody real, sitting there.
  for (let i = 0; i < 6; i++) { t += REPORT; r.observe("room", [{ track: 1, look: wobble(person(1), i), face: faceAgain(1, i) }], t); }
  const real = r.size;
  // And one stray box, once.
  r.observe("room", [{ track: 1, look: wobble(person(1), 9), face: faceAgain(1, 9) },
                     { track: 777, look: person(55), face: null }], (t += REPORT));
  ok("one real person was counted", real === 1, `got ${real}`);
  ok("a single stray reading is not a person", r.size === 1, `got ${r.size}`);
}

// 5. But a real new person IS counted — the whole point is not to lose
//    anybody. Under-counting a congregation is the worse failure.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 8; i++) {
    t += REPORT;
    r.observe("room", [
      { track: 1, look: wobble(person(1), i), face: faceAgain(1, i) },
      { track: 2, look: wobble(person(30), i), face: faceAgain(30, i) },
      { track: 3, look: wobble(person(64), i), face: faceAgain(64, i) },
    ], t);
  }
  ok("three different people are three people", r.size === 3, `got ${r.size}`);
  // And one of them arriving later still gets counted.
  for (let i = 0; i < 8; i++) {
    t += REPORT;
    r.observe("room", [{ track: 9, look: wobble(person(91), i), face: faceAgain(91, i) }], t);
  }
  ok("a fourth arriving later is counted too", r.size === 4, `got ${r.size}`);
}

// 6. Somebody waiting to be placed is still IN THE ROOM. Being careful about
//    the register must never make the live figure too low.
{
  const r = reg();
  const cams = new Set(["room"]);
  r.observe("room", [{ track: 1, look: person(1), face: null }], 1_000);
  ok("the register has nobody yet", r.size === 0);
  ok("but the room has somebody in it", r.seenNow(cams, 1_500).people === 1);
  ok("and nothing is claimed as a duplicate", r.seenNow(cams, 1_500).duplicates === 0);
}

// 7. How much evidence it takes, written down rather than implied.
{
  ok("a face that matches nobody needs two sightings", NEW_PERSON_WITH_FACE === 2);
  ok("a coat that matches nobody needs four", NEW_PERSON_NO_FACE === 4);
  ok("so a face is worth more than a coat", NEW_PERSON_WITH_FACE < NEW_PERSON_NO_FACE);
}

// ── Putting it back to zero ────────────────────────────────────────────────
//
// "you know you can have the ability to change the data back to 0 if ever you
// made an error like this". When Kyro has got the register wrong there has to
// be a way to say so and begin again, without waiting for the service to end.
{
  const worker = fs.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  const card = fs.readFileSync(new URL("../dashboard/src/components/ui/ArrivalTimes.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../dashboard/src/lib/edgeVenue.ts", import.meta.url), "utf8");

  ok("a fresh start can also forget everyone",
     /async freshStart\(now = Date\.now\(\), forgetPeople = false\)/.test(worker));
  ok("the register itself is started again", /if \(this\.register\) this\.register\.startService\(service\);/.test(worker));
  ok("and the saved copy of it is removed", /await this\.ctx\.storage\.delete\("register"\);/.test(worker));
  // Nothing is destroyed. She has been through this before: "dont remove my
  // numbers i know there was about 900 in the room".
  ok("the record is put aside, not destroyed",
     /UPDATE people SET deleted_at = \? WHERE deleted_at IS NULL AND service = \?/.test(worker)
     && !/DELETE FROM people WHERE service = \?/.test(worker));
  ok("and what was put aside is written down",
     /people_resets/.test(worker) && /people: forgot/.test(worker));
  ok("the ordinary fresh start still leaves the register alone",
     /if \(!forgetPeople\) return \{ from: new Date\(now\)\.toISOString\(\), forgot: 0 \};/.test(worker));
  ok("it is asked for explicitly, never by accident",
     /return json\(await this\.freshStart\(Date\.now\(\), !!b\.forget_people\)\);/.test(worker));
  ok("the page offers it", /Start again from nobody/.test(card));
  ok("and says what it does and does not do",
     /aside for 30 days rather than destroyed/.test(card));
  ok("the two buttons do different things",
     /onFreshStart!\(false\)/.test(card) && /onFreshStart!\(true\)/.test(card));
  ok("and it reaches the website", /forget_people: forgetPeople/.test(api));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One person stays one person.");
process.exit(fails ? 1 : 0);
