/**
 * "fix it, despite doing a hard refreash it will not lose the ID"
 *
 * A hard refresh invented hundreds of people.
 *
 * The faces themselves were never lost — they live on the website, in their
 * own table, and a browser reloading does not touch them. What is lost is
 * the browser's own numbering: a reloaded tracker takes a fresh block of
 * track numbers, so every person in the hall arrives at the register as a
 * sighting it has never seen before.
 *
 * The register cannot match such a sighting to anybody until that
 * sighting's face comes UP again — and the browser rations faces: twenty-
 * five per report, one report every five seconds. Three hundred people
 * therefore took a full minute, and for that minute the register was
 * matching people by the colour of their coat and making new ones out of
 * the ones it could not place.
 *
 * Two changes, each needed, neither enough alone:
 *
 *   · a face the website has never had jumps the queue, and a hundred go
 *     at once instead of twenty-five. A hall is on file in three reports
 *     rather than twelve. It costs a bigger report for those few seconds
 *     and nothing afterwards.
 *
 *   · and while faces are being used, a sighting that has not had one yet
 *     WAITS a few seconds rather than being called somebody new. Its
 *     evidence is kept meanwhile. Past FACE_GRACE_MS it is counted anyway,
 *     so somebody who keeps their back to the camera is never lost.
 *
 * Measured, a hard refresh of a hall whose faces are already on file:
 *
 *     people      invented before      invented after
 *        30                    0                    0
 *       120                   24                    2
 *       300                  195                   11
 *       600                  476                   23
 *
 *   node tests/test_a_reload_keeps_everybody.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry, FACE_GRACE_MS } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");

const face = (n) => {
  let s = (n * 2654435761) >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = r();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
/** A later reading of the SAME face: close, never identical. */
const faceAgain = (n, k = 1) => {
  const b = face(n), q = face(n * 7919 + k), v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = b[i] * 0.93 + q[i] * 0.07;
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
/** Each person their own coat, with a little camera wobble between readings. */
const look = (n, k = 0) => [
  0.30 + n * 0.0013 + k * 0.0004, 0.31 + n * 0.0009, 0.33 + n * 0.0005,
  0.22 + n * 0.0011, 0.23 + n * 0.0007 - k * 0.0003, 0.25 + n * 0.0004,
  2.5 + n * 0.004, 0.45 + n * 0.0008,
];
const REPORT_EVERY_MS = 5_000;

/**
 * A service, then a hard refresh.
 *
 * `perReport` is how many faces the browser sends at a time; `expectsFaces`
 * is whether the register waits for one before inventing somebody. Setting
 * both to how it was before gives the "before" column.
 */
function refresh(N, { perReport, expectsFaces, reload = true }) {
  const r = new IdentityRegistry({ zoneOf: (c) => c, createsIdentities: () => true, expectsFaces });
  let t = 0;
  for (let p = 1; p <= N; p++) {
    for (let k = 0; k < 5; k++) {
      t += 400;
      r.observe("hall", [{ track: p, look: look(p, k), face: faceAgain(p, k) }], t);
    }
  }
  const before = r.size;
  if (!reload) return { before, after: before, invented: 0 };
  // …the tab is hard-refreshed. Fresh track numbers for everybody, and the
  // faces go up `perReport` at a time, one report every five seconds.
  t += 3000;
  const faceAt = new Map();
  for (let p = 1; p <= N; p++) faceAt.set(p, t + Math.floor((p - 1) / perReport) * REPORT_EVERY_MS);
  for (let round = 0; round < 16; round++) {
    const at = t + round * REPORT_EVERY_MS;
    for (let p = 1; p <= N; p++) {
      r.observe("hall", [{ track: 10_000 + p, look: look(p, 5 + round),
        face: at >= faceAt.get(p) ? faceAgain(p, 5 + round) : null }], at + p);
    }
  }
  return { before, after: r.size, invented: r.size - before };
}

const NOW = { perReport: 100, expectsFaces: true };
const BEFORE_TODAY = { perReport: 25, expectsFaces: false };

// ── Is the harness itself sound? ──────────────────────────────────────────
// If the register cannot count these people correctly WITHOUT a refresh,
// nothing measured across one means anything. (It still merges some — look
// matching on made-up coats is not perfect — but it must be stable.)
{
  for (const N of [30, 120, 300]) {
    const o = refresh(N, { ...NOW, reload: false });
    ok(`${N} people with no refresh are counted steadily (${o.before})`,
       o.before >= N * 0.75, `${o.before} of ${N}`);
  }
}

// ── A hard refresh does not invent a congregation ─────────────────────────
{
  for (const N of [30, 120, 300, 600]) {
    const was = refresh(N, BEFORE_TODAY);
    const now = refresh(N, NOW);
    const allowed = Math.max(1, Math.round(N * 0.05));
    ok(`${String(N).padStart(3)} people survive a hard refresh ` +
       `(${was.invented} invented before, ${now.invented} now)`,
       now.invented <= allowed, `${now.invented} invented, allowing ${allowed}`);
    if (N >= 120) {
      ok(`   …and that is a real improvement, not a wash`,
         now.invented * 4 <= was.invented, `${now.invented} vs ${was.invented}`);
    }
  }
}

// ── Somebody who never shows their face is still counted ──────────────────
// The wait is a few seconds, not a condition. A person with their back to
// the camera all morning has no face to send and must still be a person.
{
  const r = new IdentityRegistry({ zoneOf: (c) => c, createsIdentities: () => true, expectsFaces: true });
  let t = 0;
  const seen = () => { t += 1000; r.observe("hall", [{ track: 1, look: look(42, t % 5), face: null }], t); };
  seen();
  ok("at first they are held rather than guessed at", r.size === 0, `${r.size}`);
  while (t < FACE_GRACE_MS + 2000) seen();
  ok("but past the grace they are counted anyway", r.size === 1, `${r.size}`);
}

// ── With face matching OFF, nothing waits ─────────────────────────────────
// There is nothing to wait FOR, and waiting would stop anybody being counted
// at all. This is the mistake that would turn one bug into a worse one.
{
  // Nobody is counted off a single sighting whatever the setting — the
  // register wants to see somebody more than once first. What matters here
  // is that it does not then sit on them for the length of the grace.
  const r = new IdentityRegistry({ zoneOf: (c) => c, createsIdentities: () => true, expectsFaces: false });
  let t = 0;
  while (r.size === 0 && t < FACE_GRACE_MS) {
    t += 1000;
    r.observe("hall", [{ track: 1, look: look(7, t % 5), face: null }], t);
  }
  ok("a venue with face matching off counts somebody without waiting",
     r.size === 1 && t < FACE_GRACE_MS / 2, `counted after ${t}ms, grace is ${FACE_GRACE_MS}ms`);
}

// ── Both halves are actually wired in ─────────────────────────────────────
{
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("a face nobody has sent yet jumps the queue",
     /const NEW_FACES_PER_REPORT = 100;/.test(ctx)
     && /const neverSent = !mine\.has\(track\);/.test(ctx)
     && /sentThisTime >= \(neverSent \? NEW_FACES_PER_REPORT : FACES_PER_REPORT\)/.test(ctx));
  ok("…and is not held back by the once-a-minute rule either",
     /if \(!neverSent && now - last < FACE_AGAIN_MS\) return false;/.test(ctx));
  ok("the register is told whether faces are being used at all",
     /expectsFaces: \(await this\.privacy\(\)\)\.face_matching,/.test(worker));
  ok("from the venue's setting, not from whether faces happen to be arriving",
     /looks exactly like a hall with face\n\s*\* matching switched off/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A hard refresh keeps everybody.");
process.exit(fails ? 1 : 0);
