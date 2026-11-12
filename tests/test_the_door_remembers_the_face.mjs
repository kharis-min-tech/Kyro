/**
 * The face scanned at the door reaches the person in the hall.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "when someone comes in, take a picture of their face and clothes so that you
 * scan and remember what they look like so you dont over count."
 *
 * Kyro does read a face and an appearance at the entrance — it has all along.
 * What it then did with them was the problem.
 *
 * A doorway is not allowed to put anybody in the register: it sees one person
 * appear, disappear and reappear as they cross, and inventing somebody each
 * time is how a morning becomes a thousand people. So the entry is made in
 * the hall, and the door's evidence has to be CARRIED across to it.
 *
 * That carrying was done on the colour of their coat alone — which is the one
 * reading that differs most between two cameras looking at the same person
 * from two angles, at two distances, in two different lights. So the face
 * read at the door, in good light, a step from the lens, routinely never
 * reached the entry the hall made, and the hall went on recognising a
 * congregation by its coats. 114 chairs; 300 people counted.
 *
 * A face code holds up across cameras where a coat does not. Now it is tried
 * first.
 *
 *   node tests/test_the_door_remembers_the_face.mjs
 */
import { IdentityRegistry, FACE_SAME } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

/** look = [topR, topG, topBright, botR, botG, botBright, shape, height] */
const person = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [
    0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3),
  ];
};
/** The same coat, read by a different camera in different light. Far enough
 *  apart that appearance alone will NOT join the two sightings — which is the
 *  whole point, and is what a doorway and a hall camera really do to a coat. */
const otherCamera = (look) => look.map((v, i) => (i < 6 ? v * 0.82 + 0.05 : v + 0.25));
const face = (n) => {
  let seed = (n * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = rand();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
const reg = () => new IdentityRegistry({
  zoneOf: (c) => (c === "door" ? "Foyer" : "Main"),
  createsIdentities: (c) => c !== "door",       // a doorway never invents people
});

// ── One person: in at the door, then sitting in the hall ────────────────────
{
  const r = reg();
  let t = 0;
  // Crossing the entrance: close, lit, face readable. The door may not enrol
  // them, so nothing is in the register yet.
  for (let f = 0; f < 3; f++) {
    t += 400;
    r.observe("door", [{ track: 1, look: person(9), face: face(9) }], t);
  }
  ok("a doorway still puts nobody in the register", r.size === 0, `${r.size}`);

  // They walk in and sit down. Different camera, different light, and the
  // hall reads a face now and then.
  t += 20_000;
  for (let f = 0; f < 6; f++) {
    t += 5000;
    r.observe("room", [{ track: 500, look: otherCamera(person(9)), face: f === 0 ? face(9) : null }], t);
  }
  ok("the hall enrols them, once", r.size === 1, `${r.size}`);

  const p = [...r.people.values()][0];
  ok("and the face read at the door is on their entry", p.faces.length >= 1, `${p.faces.length} faces`);
  ok("so is the coat the door saw", p.looks.length >= 1, `${p.looks.length} looks`);
  ok("the register says it carried a face, not a coat",
     (r.stats.carriedByFace ?? 0) >= 1, JSON.stringify(r.stats.carriedByFace));
}

// ── …and it will not join two different people ──────────────────────────────
{
  const r = reg();
  let t = 0;
  // Two people cross the door, one after the other, dressed identically.
  for (let f = 0; f < 3; f++) { t += 400; r.observe("door", [{ track: 1, look: person(4), face: face(4) }], t); }
  t += 10_000;
  for (let f = 0; f < 3; f++) { t += 400; r.observe("door", [{ track: 2, look: person(4), face: face(77) }], t); }
  // Both sit down in the hall, with their own faces.
  t += 20_000;
  for (let f = 0; f < 6; f++) {
    t += 5000;
    r.observe("room", [
      { track: 500, look: otherCamera(person(4)), face: face(4) },
      { track: 501, look: otherCamera(person(4)), face: face(77) },
    ], t);
  }
  ok("two people dressed alike stay two people", r.size === 2, `${r.size}`);
  const faces = [...r.people.values()].map((p) => p.faces.length);
  ok("and each keeps their own face", faces.every((n) => n >= 1), JSON.stringify(faces));
}

// ── The thresholds are the ones a face answers to everywhere else ───────────
{
  const src = (await import("node:fs")).readFileSync(new URL("../worker/identity.js", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("A FACE first, when this sighting has one"));
  ok("a carried face has to be clearly this person",
     /bestScore >= FACE_SAME && bestScore - second >= FACE_MARGIN/.test(block));
  ok("and clearly not the next-best one", /bestScore - second >= FACE_MARGIN/.test(block));
  ok("it never takes over a sighting still being seen",
     /if \(now - v\.last < CO_SEEN_MS\) continue;/.test(block));
  ok("whether it was a face is a fact about this search, not a running total",
     /let byFace = false;/.test(src) && /if \(best && \(byFace \|\|/.test(src));
  ok("and a face is worth joining on at all", FACE_SAME > 0 && FACE_SAME < 1, `${FACE_SAME}`);
}

// ── The doorway writes a lot down, and it is bounded ────────────────────────
//
// A room makes tracks slowly; a doorway makes them as fast as people walk
// through it. Now that a doorway records what it saw, the waiting list has a
// source it never had, and it holds FACE CODES — so an unbounded one is
// megabytes of a congregation's faces kept past any use for them. It was
// tidied by age alone, which cannot help on a morning where five hundred
// sightings are all younger than the age limit at once.
{
  const { MOST_WAITING } = await import("../worker/identity.js");
  const r = reg();
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    t += 50;                                   // all of them fresh, none tidy-able by age
    r.observe("door", [{ track: 10_000 + i, look: person(1 + (i % 40)), face: face(1 + (i % 40)) }], t);
  }
  ok("a busy doorway cannot grow the waiting list without limit",
     r.waiting.size <= MOST_WAITING, `${r.waiting.size} waiting`);
  ok("and it still puts nobody in the register", r.size === 0, `${r.size}`);
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. The door's face reaches the register.");
process.exit(fails ? 1 : 0);
