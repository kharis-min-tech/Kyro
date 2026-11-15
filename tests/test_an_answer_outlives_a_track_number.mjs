/**
 * "you also keep giving me the same person — questions are being repeated"
 *
 * The same two faces, over and over, and answering changed nothing.
 *
 * Every question Kyro asks is remembered so it is not asked twice. It was
 * remembered under a key naming a CAMERA'S TRACK NUMBER — "camera#7|12" —
 * and a track number is not a person. It changes every time the detector
 * loses somebody for a moment, which at a door is every crossing and in a
 * hall is all morning. So the same two people came back under a new key
 * each time, and the answer given five minutes ago keyed nothing.
 *
 * The note on answerAsk has always said "either way the pair is remembered,
 * so the same two are never asked about again for the rest of the service".
 * It was describing what it meant to do.
 *
 * A ruling is now also recorded against the two PEOPLE, whose numbers do
 * not change for the length of a service. The track-number key stays — it
 * is the one that stops the SAME sighting being asked about twice in a row
 * — but the people key is what makes an answer last.
 *
 *   node tests/test_an_answer_outlives_a_track_number.mjs
 */
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const reg = () => new IdentityRegistry({ zoneOf: (c) => c, createsIdentities: () => true });

// ── The key names two people, and names them the same way round ───────────
{
  const r = reg();
  r.byTrack.set("hall#7", { id: 3, at: Date.now() });
  r.byTrack.set("hall#99", { id: 3, at: Date.now() });   // same person, new number
  ok("a sighting with an identity makes a key",
     r.pairOfPeople("hall", 7, 12) === "p3|p12", r.pairOfPeople("hall", 7, 12));
  ok("and the same two always make the SAME key, whichever way round",
     r.pairOfPeople("hall", 7, 12) === r.pairOfPeople("hall", 7, 12)
     && r.pairOfPeople("hall", 7, 2) === "p2|p3", r.pairOfPeople("hall", 7, 2));
  ok("the camera's number for them does not come into it",
     r.pairOfPeople("hall", 99, 12) === r.pairOfPeople("hall", 7, 12));
  ok("a sighting Kyro has not placed yet makes no key — that question is worth asking",
     r.pairOfPeople("hall", 404, 12) === null);
  ok("and nobody is paired with themselves", r.pairOfPeople("hall", 7, 3) === null);
}

// ── An answer sticks to the people, not to the sighting ───────────────────
{
  const r = reg();
  const now = Date.now();
  r.people.set(3, { id: 3, looks: [], faces: [], lastCamera: "hall", lastTrack: 7 });
  r.people.set(12, { id: 12, looks: [], faces: [], lastCamera: "hall", lastTrack: 8 });
  r.byTrack.set("hall#7", { id: 3, at: now });

  // Somebody answers "no, different people" about this pair.
  r.answerAsk({ pair: "hall#7|12", camera: "hall", track: 7, person: 12, guess: "same" }, false, now);

  ok("the sighting's own key is settled", r.ruled.get("hall#7|12") === false);
  ok("and so is the pair of people", r.ruled.get("p3|p12") === false);

  // …and five minutes later the detector loses them and gives them a new
  // number. It is the same two people, so there is nothing left to ask.
  r.byTrack.set("hall#812", { id: 3, at: now + 300_000 });
  ok("the same two under a new track number are already settled",
     r.ruled.has(r.pairOfPeople("hall", 812, 12)));
  ok("…which is the whole point: the new sighting's own key is NOT settled",
     !r.ruled.has("hall#812|12"));
}

// ── A different pair is still a question ──────────────────────────────────
{
  const r = reg();
  const now = Date.now();
  r.byTrack.set("hall#7", { id: 3, at: now });
  r.ruled.set("p3|p12", false);
  ok("person 3 against somebody else has not been asked",
     !r.ruled.has(r.pairOfPeople("hall", 7, 44)));
}

// ── And it is written down with everything else ───────────────────────────
// A people key is no use if it dies when the website goes to sleep. See
// tests/test_what_was_asked_is_remembered.mjs.
{
  const before = reg();
  before.ruled.set("p3|p12", false);
  before.ruled.set("hall#7|12", false);
  const after = reg();
  after.restoreRulings(before.rulings());
  ok("the people key survives the website being put to sleep",
     after.ruled.get("p3|p12") === false);
  ok("and a new service forgets it, because the numbers mean somebody else",
     (() => { after.startService("next"); return after.ruled.size === 0; })());
}

console.log(fails ? `\n${fails} failed` : "\nAll good. An answer outlives a track number.");
process.exit(fails ? 1 : 0);
