/**
 * Two cameras pointed at one face is ONE person.
 *
 * What was reported: "[the Counting card] still duplicating" — "2 people now"
 * with one person sitting in front of two cameras.
 *
 * That card did the one thing a camera cannot do for itself. A camera knows
 * what is in front of it; the one thing it cannot know is whether the camera
 * beside it is looking at the same person. The card added them up, so two
 * cameras on one face read 2.
 *
 * The register (worker/identity.js) is the only part of Kyro that sees every
 * camera at once, so it is the only thing that can answer this. It now says
 * how many of the sightings at this moment are the same person seen twice,
 * and both the website's figure and the browser's card take it off.
 *
 * It works whether or not face matching is switched on — the register uses
 * whatever evidence it has, and a face is the strongest of several.
 *
 *   node tests/test_two_cameras_one_face.mjs
 */
import fs from "node:fs";
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

// Same people-making helpers as tests/test_identity_registry.mjs, so the two
// agree about what a person looks like.
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

/** Both cameras watch the same room, so they can see the same person. */
const reg = () => new IdentityRegistry({ zoneOf: () => "hall" });
const BOTH = new Set(["cam-a", "cam-b"]);

// 1. The reported fault: one person, two cameras, with face matching on.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 6; i++, t += 1_000) {
    r.observe("cam-a", [{ track: 1, look: wobble(person(1), i), face: faceAgain(1, i) }], t);
    r.observe("cam-b", [{ track: 9, look: wobble(person(1), i + 20), face: faceAgain(1, i + 20) }], t);
  }
  const now = r.seenNow(BOTH, t);
  ok("the register holds one person, not two", r.size === 1, `size ${r.size}`);
  ok("it sees two sightings", now.sightings === 2, `got ${now.sightings}`);
  ok("of one person", now.people === 1, `got ${now.people}`);
  ok("so one of them is a duplicate", now.duplicates === 1, `got ${now.duplicates}`);
  ok("the card would read 1, not 2", 2 - now.duplicates === 1);
}

// 2. With face matching OFF. This is the case sameFaces could never answer,
//    and it is the common one: face matching stays off until an administrator
//    switches it on.
//
//    Two cameras seeing one person from similar angles read their clothes
//    about 0.96 alike, which clears the bar for matching on appearance alone
//    (LOOK_ALONE, 0.92 — measured, not guessed).
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 6; i++, t += 1_000) {
    r.observe("cam-a", [{ track: 1, look: wobble(person(3), i), face: null }], t);
    r.observe("cam-b", [{ track: 9, look: wobble(person(3), i + 1), face: null }], t);
  }
  const now = r.seenNow(BOTH, t);
  ok("one person on two cameras, no faces at all, is still one person",
     now.people === 1 && now.duplicates === 1, `${now.people} people, ${now.duplicates} duplicates`);
}

// 3. The honest limit of doing it without faces.
//
//    Two cameras at very different angles, in different light, read the same
//    person's clothes only about 0.80 alike. On appearance alone that is not
//    enough, and the register refuses to merge them — so the person is
//    counted twice.
//
//    That is the right way to fail. Merging two people who merely look alike
//    deletes somebody from the attendance of a church service; counting one
//    person twice is a number that is too high, which is visible and can be
//    argued with. Face matching is what closes this gap, which is what it is
//    for.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 6; i++, t += 1_000) {
    r.observe("cam-a", [{ track: 1, look: wobble(person(3), i), face: null }], t);
    r.observe("cam-b", [{ track: 9, look: wobble(person(3), i + 5), face: null }], t);
  }
  ok("a very different view, with no face to go on, is not merged",
     r.seenNow(BOTH, t).people === 2);
  // With faces, the same pair IS one person.
  const r2 = reg();
  let u = 1_000;
  for (let i = 0; i < 6; i++, u += 1_000) {
    r2.observe("cam-a", [{ track: 1, look: wobble(person(3), i), face: faceAgain(3, i) }], u);
    r2.observe("cam-b", [{ track: 9, look: wobble(person(3), i + 5), face: faceAgain(3, i + 20) }], u);
  }
  ok("with face matching on, it is one person", r2.seenNow(BOTH, u).people === 1);
}

// 3. Two DIFFERENT people must not be merged. This is the direction that
//    matters: under-counting a congregation is worse than over-counting one.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 6; i++, t += 1_000) {
    r.observe("cam-a", [{ track: 1, look: wobble(person(11), i), face: faceAgain(11, i) }], t);
    r.observe("cam-b", [{ track: 9, look: wobble(person(42), i), face: faceAgain(42, i) }], t);
  }
  const now = r.seenNow(BOTH, t);
  ok("two different people on two cameras are two people", now.people === 2, `got ${now.people}`);
  ok("and nothing is taken off the total", now.duplicates === 0, `got ${now.duplicates}`);
}

// 4. One camera, several people — nothing to deduplicate, and nothing lost.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 5; i++, t += 1_000) {
    r.observe("cam-a", [1, 2, 3, 4, 5].map((n) => ({ track: n, look: wobble(person(n * 9), i), face: faceAgain(n * 9, i) })), t);
  }
  const now = r.seenNow(BOTH, t);
  ok("five people on one camera are five people", now.people === 5 && now.duplicates === 0,
     `${now.people} people, ${now.duplicates} duplicates`);
}

// 5. A moment ago is not now. Somebody the other camera saw a minute back and
//    has since lost is not standing in front of it.
{
  const r = reg();
  // Seen twice each, so both sightings have earned their place in the
  // register — one glance apiece and Kyro rightly says it doesn't know yet.
  r.observe("cam-a", [{ track: 1, look: person(5), face: face(5) }], 1_000);
  r.observe("cam-b", [{ track: 9, look: person(5), face: faceAgain(5, 2) }], 1_000);
  r.observe("cam-a", [{ track: 1, look: person(5), face: face(5) }], 1_500);
  r.observe("cam-b", [{ track: 9, look: person(5), face: faceAgain(5, 2) }], 1_500);
  ok("at the time, two sightings of one person", r.seenNow(BOTH, 2_000).duplicates === 1,
     `got ${JSON.stringify(r.seenNow(BOTH, 2_000))}`);
  ok("a minute later, nothing is in view", r.seenNow(BOTH, 61_000).sightings === 0);
}

// 6. Only the cameras asked about. The computer in the office must not have
//    the hall's overlap taken off its own figure.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 5; i++, t += 1_000) {
    r.observe("cam-a", [{ track: 1, look: wobble(person(7), i), face: faceAgain(7, i) }], t);
    r.observe("cam-b", [{ track: 9, look: wobble(person(7), i + 20), face: faceAgain(7, i + 20) }], t);
    r.observe("cam-c", [{ track: 3, look: wobble(person(70), i), face: faceAgain(70, i) }], t);
  }
  ok("asking about cam-c alone finds no duplicate", r.seenNow(new Set(["cam-c"]), t).duplicates === 0);
  ok("asking about the pair finds one", r.seenNow(BOTH, t).duplicates === 1);
}

// 7. A full hall, where each camera sends only the nearest forty it can see.
//    The register knows about fewer sightings than the cameras counted — so
//    duplicates it HAS found are subtracted from the cameras' own total, and
//    its people count is never used as the answer. Trusting the register's
//    count here would lose everybody it never heard about.
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 4; i++, t += 1_000) {
    r.observe("cam-a", Array.from({ length: 40 }, (_, n) => ({ track: n, look: wobble(person(n), i), face: faceAgain(n, i) })), t);
    // The second camera sees ten of the same people from the other side.
    r.observe("cam-b", Array.from({ length: 10 }, (_, n) => ({ track: 100 + n, look: wobble(person(n), i + 20), face: faceAgain(n, i + 20) })), t);
  }
  const now = r.seenNow(BOTH, t);
  ok("it finds the ten people both cameras can see", now.duplicates === 10, `got ${now.duplicates}`);
  // The cameras themselves counted 300 and 60 — far more than they sent.
  const cameras = 300 + 60;
  ok("300 and 60 with ten overlapping reads 350, not 50",
     cameras - now.duplicates === 350, `got ${cameras - now.duplicates}`);
}

// ── Wired up, rather than merely possible. ──────────────────────────────────
{
  const worker = fs.readFileSync(new URL("../worker/venue.js", import.meta.url), "utf8");
  const ctx = fs.readFileSync(new URL("../dashboard/src/lib/CountingContext.tsx", import.meta.url), "utf8");
  const card = fs.readFileSync(new URL("../dashboard/src/components/ui/CountingCard.tsx", import.meta.url), "utf8");
  const mode = fs.readFileSync(new URL("../dashboard/src/lib/cameraMode.ts", import.meta.url), "utf8");

  ok("the venue total uses the register's overlap",
     /const overlap = this\.register \? this\.register\.seenNow\(runningIds\)\.duplicates : 0;/.test(worker));
  ok("and keeps a clear face match as a floor",
     /let twice = Math\.max\(overlap, faceOn \? this\.sameFaces\(runningIds\) : 0\);/.test(worker));
  ok("the counting computer is told its own overlap", /seen_twice: this\.register/.test(worker));
  ok("only its own cameras, and not its doorway ones",
     /c\.device_id === device\.id && c\.location !== "entrance" && !c\.hidden/.test(worker));
  ok("the browser reads it", /seenTwice: Math\.max\(0, Number\(body\.seen_twice\) \|\| 0\)/.test(mode));
  ok("and takes it off its own total",
     /const total = Math\.max\(0, sum - Math\.min\(seenTwice, Math\.max\(0, sum - 1\)\)\);/.test(ctx));
  ok("the card says so, so a smaller figure is never a mystery",
     /in view of two cameras at once/.test(card));
  // The count can never be argued down to nothing by a bad match: something
  // is in shot, so the floor is one.
  const total = (sum, twice) => Math.max(0, sum - Math.min(twice, Math.max(0, sum - 1)));
  ok("two cameras, one face, reads 1", total(2, 1) === 1);
  ok("a wild overlap can never empty the room", total(5, 99) === 1);
  ok("nobody in shot is still nobody", total(0, 3) === 0);
  ok("and no overlap changes nothing", total(7, 0) === 7);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Two cameras, one face, one person.");
process.exit(fails ? 1 : 0);
