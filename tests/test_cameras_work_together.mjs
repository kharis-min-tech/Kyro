/**
 * The cameras share one register — and when the coats fail, they still do.
 *
 * Asked outright: "is the cameras even working together or seperately,
 * because if there working seperatly, THEY NEED TO WORK TOGETHER!! ... if
 * for example one person goes to the other camera, they need to have the
 * same id and not double count or triple count or quatriple count".
 *
 * They do share one register — one entry per human being, whichever camera
 * sees them, and that has always been the design. The gap was in how the
 * sharing is actually made to work.
 *
 * A face joins two sightings properly. A coat is the weakest evidence there
 * is, and it is at its very weakest in exactly this case: two cameras see
 * one person from two angles, at two distances, in two patches of light, so
 * the two readings of them are the least alike they will ever be. When the
 * coat failed, a second entry was made — one person counted twice, for ever,
 * with nothing left that could join them up.
 *
 * There is evidence here that has nothing to do with clothing: WHO ELSE IS
 * IN THE ROOM THIS SECOND. If a camera that can see the same place has
 * exactly one person in view that this camera has not accounted for, that is
 * almost certainly who this is.
 *
 * What this guards:
 *
 *   - two cameras on one computer are one place, so a person on both is one
 *     entry even when the coats disagree;
 *   - two cameras Kyro has no reason to think overlap are still two places,
 *     and a person on each is still two people — because they might be;
 *   - it only fires in a quiet room, where "the only one" is a statement
 *     about a person rather than arithmetic about a crowd. Measured: without
 *     that cap it merged eight people at a 120-person service;
 *   - a face that says otherwise still vetoes it;
 *   - and whenever it fires it ASKS, because a wrong join is exactly what a
 *     person settles from two pictures.
 *
 *   node tests/test_cameras_work_together.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry, QUIET_ENOUGH_TO_JOIN, CO_SEEN_MS } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "dashboard/src/components/ui/DoorLog.tsx"), "utf8");

const base = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3)];
};
/** The same person as a camera at a very different angle and distance sees them. */
const fromOver = (l, k) => {
  const v = l.slice();
  v[7] = l[7] * k; v[6] = l[6] * (1 + 0.3 * k); v[2] = l[2] + 0.08 * k;
  return v;
};
const face = (n) => {
  let seed = (n * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = rand();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};

/** Two cameras, each given a room named after itself — what Kyro does when a
 *  camera adds itself. `together` is whether Kyro knows they overlap. */
function twoCameras({ together, trips = 20 }) {
  const r = new IdentityRegistry({
    zoneOf: (c) => c,
    overlapping: (a, b) => a === b || together,
  });
  const me = base(1);
  let t = 1_000, track = 1;
  for (let trip = 0; trip < trips; trip++) {
    for (let i = 0; i < 5; i++) {
      t += 5_000;
      r.observe("cam1", [{ track, look: fromOver(me, 1 + 0.02 * i), face: null }], t);
      r.observe("cam2", [{ track: 100 + track, look: fromOver(me, 0.55 + 0.02 * i), face: null }], t);
    }
    t += 60_000;
    track++;
  }
  return r;
}

// ── One person, two cameras, twenty trips ──────────────────────────────────
{
  const together = twoCameras({ together: true });
  ok("two cameras on one computer: one person is ONE person",
     together.size === 1, `${together.size}`);
  ok("and it was the other camera that joined them up",
     (together.stats.joinedAcrossCameras ?? 0) > 0);
  ok("the register says both cameras saw them",
     [...together.people.values()][0].cameras.size === 2);

  // And the opposite, which must NOT change: two cameras Kyro has no reason
  // to think overlap are two places, and a person on each might be two
  // people. Guessing otherwise would merge a balcony into a main floor.
  const apart = twoCameras({ together: false });
  ok("two cameras that might be different rooms are left alone",
     apart.size === 2, `${apart.size}`);
}

// ── Only in a quiet room ───────────────────────────────────────────────────
{
  // Five people between two overlapping cameras. "The only one they haven't
  // accounted for" is now arithmetic about a crowd, and must not be acted on.
  const r = new IdentityRegistry({ zoneOf: (c) => c, overlapping: () => true });
  let t = 1_000;
  const who = [1, 9, 20, 33, 47];
  for (let i = 0; i < 10; i++) {
    t += 5_000;
    r.observe("cam1", who.map((n) => ({ track: n, look: base(n), face: null })), t);
  }
  ok("five different people are five people", r.size === 5, `${r.size}`);
  const before = r.size;
  // A sixth appears on the other camera, dressed like none of them. (Checked:
  // base(100) scores at most 0.37 against the five, so nothing here is a
  // near-miss on appearance — the only thing that could join them up is the
  // cross-camera rule, and in a room this busy it must not.)
  for (let i = 0; i < 8; i++) {
    t += 5_000;
    r.observe("cam1", who.map((n) => ({ track: n, look: base(n), face: null })), t);
    r.observe("cam2", [{ track: 500, look: base(100), face: null }], t);
  }
  ok("a new person in a busy room is still a new person", r.size === before + 1, `${r.size}`);
  ok("and nothing was joined up on arithmetic", (r.stats.joinedAcrossCameras ?? 0) === 0);
  ok("the limit is written down, and small", QUIET_ENOUGH_TO_JOIN === 4);
}

// ── A face still has the last word ─────────────────────────────────────────
{
  const r = new IdentityRegistry({ zoneOf: (c) => c, overlapping: () => true });
  let t = 1_000;
  // One person on camera 1, with a face.
  for (let i = 0; i < 8; i++) {
    t += 5_000;
    r.observe("cam1", [{ track: 1, look: base(1), face: face(1) }], t);
  }
  // Somebody else walks in front of camera 2 — different coat, different
  // face. The other camera can "account for" only one person, but the face
  // says plainly that this is not them.
  for (let i = 0; i < 8; i++) {
    t += 5_000;
    r.observe("cam1", [{ track: 1, look: base(1), face: face(1) }], t);
    r.observe("cam2", [{ track: 2, look: base(55), face: face(55) }], t);
  }
  ok("a face that says 'not them' still wins", r.size === 2, `${r.size}`);
}

// ── And it asks, every time it fires ───────────────────────────────────────
{
  const r = twoCameras({ together: true, trips: 2 });
  const asks = r.takeAsks();
  ok("joining across cameras is asked about", asks.some((a) => /another camera is looking at the same room/.test(a.reason)));
  ok("with the guess it made", asks.every((a) => ["same", "different"].includes(a.guess)));
  ok("and the sighting and person to correct",
     asks.every((a) => typeof a.camera === "string" && typeof a.track === "number"));
}

// ── Two cameras on one computer really are one place ───────────────────────
{
  ok("the website says so", /if \(ca\.device_id && ca\.device_id === cb\.device_id\) return true;/.test(worker));
  ok("and two cameras told to watch one room, too",
     /return \(ca\.zone_name \|\| ca\.name \|\| a\) === \(cb\.zone_name \|\| cb\.name \|\| b\);/.test(worker));
  ok("a sighting must be from the same moment to count",
     new RegExp(`now - at > CO_SEEN_MS`).test(fs.readFileSync(path.join(root, "worker/identity.js"), "utf8"))
     && CO_SEEN_MS === 6_000);
}

// ── The question is answered on the page, in the cameras' own terms ────────
{
  ok("the page says how many cameras feed one register", /Cameras feeding one register/.test(panel));
  ok("and how many people have been recognised across them",
     /people have"\} been recognised on more than one of them, and counted once/.test(panel.replace(/\s+/g, " "))
     || /been recognised on more than one of them, and counted once/.test(panel));
  ok("and when the other camera did the joining", /Joined up by the other camera/.test(panel));
  ok("the website sends the camera list", /cameras: \[\.\.\.new Set\(people\.flatMap\(\(p\) => \[\.\.\.p\.cameras\]\)\)\],/.test(fs.readFileSync(path.join(root, "worker/identity.js"), "utf8")));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The cameras work together.");
process.exit(fails ? 1 : 0);
