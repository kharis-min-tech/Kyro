/**
 * One person, sitting still, alone in a room, counted as 45.
 *
 * "dont think this is very accurate" — a list reading Person 239, 240,
 * 241 … every one "still here", a minute or two apart, all of them her.
 *
 * ── What happens ──────────────────────────────────────────────────────────
 *
 * The camera loses somebody for a moment and gives them a new track number
 * when it finds them again. Their coat reads a little differently each time
 * — the light shifts, they turn — and once a reading falls below the bar
 * for recognising somebody with nobody else to compare against, a second
 * entry is filed. From there it feeds itself: two entries that look alike
 * cannot be told apart, so the margin rule refuses to match either, and a
 * third is filed, and a fourth.
 *
 * ── Why it is not "fixed" here ────────────────────────────────────────────
 *
 * Because the obvious fix is worse. Kyro already has an escape hatch for
 * this runaway: when several people on file look alike and NONE OF THEM IS
 * HERE, it attaches to the best of them rather than inventing another. The
 * trouble is "here", which it reads as "seen in the last minute" — and a
 * copy of herself was seen seconds ago, so the hatch never opened.
 *
 * Making "here" mean "in shot at this moment" does fix her case: one person
 * for an hour went from 45 entries to 2. It also merges a congregation.
 * Measured on the 900-person register in test_identity_registry.mjs:
 *
 *     the escape hatch, loosened ....... 900 different people → 291
 *     and the uniform rule with it ..... 900 different people →  50
 *
 * A doorway camera sees one person at a time, and the next person through
 * is a different person. There is nothing in a wobbling coat that separates
 * "her again" from "somebody new", and any rule blunt enough to fix the
 * first wrecks the second. Trading a count that is too high for one that is
 * far too low is not a fix.
 *
 * ── What does fix it ──────────────────────────────────────────────────────
 *
 * A face. Measured, the same hour:
 *
 *     face matching off ... 45 different people
 *     face matching on .... 1
 *
 * So this test holds the thing that works. If faces ever stop rescuing it,
 * this fails, and the limit above stops being a limit and becomes a bug.
 *
 *   node tests/test_one_person_alone_needs_a_face.mjs
 */
import { IdentityRegistry, alikeLook, LOOK_ALONE } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

/** One coat, read slightly differently each time. */
const look = (k, wobble) => [
  0.30 + Math.sin(k * 1.7) * wobble, 0.31 + Math.cos(k * 2.3) * wobble, 0.33 + Math.sin(k) * wobble * 0.5,
  0.22 + Math.cos(k * 1.1) * wobble, 0.23 + Math.sin(k * 2.9) * wobble, 0.25 + Math.cos(k) * wobble * 0.5,
  2.5 + Math.sin(k * 0.7) * wobble * 2, 0.45 + Math.cos(k * 1.3) * wobble,
];
/** The same face, read again: close, never identical. */
const faceOf = (n, k) => {
  const seeded = (s) => { let x = (s * 2654435761) >>> 0;
    return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296 - 0.5; }; };
  const a = seeded(n), b = seeded(n * 7919 + k), v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = a() * 0.93 + b() * 0.07;
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};

/** Alone in a room, lost and re-found once a minute. */
function alone(minutes, wobble, faces) {
  const r = new IdentityRegistry({ zoneOf: (c) => c, createsIdentities: () => true, expectsFaces: faces });
  let t = 0, track = 1;
  for (let m = 0; m < minutes; m++) {
    const mine = track++;
    for (let f = 0; f < 12; f++) {           // a report every five seconds
      t += 5000;
      r.observe("room", [{ track: mine, look: look(m * 12 + f, wobble),
                           face: faces ? faceOf(1, m * 12 + f) : null }], t);
    }
  }
  return r.size;
}

// ── The harness is measuring the hard case ────────────────────────────────
{
  const shifty = alikeLook(look(3, 0.025), look(16, 0.025));
  ok("the coat reads well below the bar for somebody on their own",
     shifty < LOOK_ALONE - 0.1, `${shifty.toFixed(3)} against ${LOOK_ALONE}`);
}

// ── With a face, one person is one person ─────────────────────────────────
{
  for (const minutes of [5, 20, 60]) {
    const n = alone(minutes, 0.025, true);
    ok(`face matching on, ${minutes} minutes alone → ${n} counted`, n === 1, `${n}`);
  }
  ok("and a steady-looking coat needs no face at all",
     alone(60, 0.004, false) === 1, `${alone(60, 0.004, false)}`);
}

// ── Without one, this is the known limit ──────────────────────────────────
// Not asserted as a target — it is recorded, so that if it ever gets WORSE
// somebody finds out here rather than from a church's screen.
{
  const n = alone(60, 0.025, false);
  console.log(`   (face matching off, the same hour: ${n} entries from one person — the limit this test exists to document)`);
  ok("…and face matching is worth that whole difference",
     alone(60, 0.025, true) === 1 && n > 5, `on: 1, off: ${n}`);
}

// ── The escape hatch is still the careful version ─────────────────────────
// If somebody loosens this to fix the case above, test_identity_registry.mjs
// fails on 900 people. Both tests have to pass, which is the point.
{
  const src = (await import("node:fs")).readFileSync(
    new URL("../worker/identity.js", import.meta.url), "utf8");
  ok("the merge only runs when no look-alike has been seen lately",
     /const anyHere = rivals\.some\(\(x\) => now - x\.p\.lastAt <= UNIFORM_SEEN_MS\);/.test(src));
  ok("and the uniform rule counts everybody seen lately, in shot or not",
     /const uniform = alike >= UNIFORM_CROWD;/.test(src));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. With a face, one person is one person.");
process.exit(fails ? 1 : 0);
