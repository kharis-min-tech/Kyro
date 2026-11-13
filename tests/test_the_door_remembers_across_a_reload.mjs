/**
 * Reloading the page does not make the doorway forget who it counted.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "if it reloads, does it mean face recognition will not know the previous?"
 * … "yes fix it, keep the list on the website."
 *
 * The faces themselves were always safe: they live on the website, in a table
 * belonging to the service. This did not. A doorway keeps its OWN record of
 * who it has already counted — that is what stops the usher holding the door
 * all morning from being counted forty times — and that record lived in the
 * browser and was rebuilt from nothing on every page load.
 *
 * So every reload emptied it, and the next time the usher stepped through
 * they were a new arrival. On a day of reloads that is a day of inflation
 * which looks exactly like a busy door.
 *
 *   node tests/test_the_door_remembers_across_a_reload.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-reload-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { PersonTracker, DOOR_DECIDE_MS } = await import(path.join(tmp, "personTracker.js"));

const box = (left, top, w, h) => [left, top, left + w, top + h];
const look = (n) => ({
  top: [0.33 + n * 0.02, 0.33, 0.35], bottom: [0.33, 0.33 + n * 0.02, 0.45],
  shape: 2.5, height: 0.5,
});
const face = (n) => {
  let seed = (n * 2654435761) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = rand();
  let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
  for (let i = 0; i < 128; i++) v[i] /= m;
  return v;
};
/** One person crossing the doorway, with their face and coat seen each time. */
const cross = (tr, who, t, from, to) => {
  for (let i = 0; i <= 6; i++) {
    const h = from + (to - from) * (i / 6);
    // update(people, now, faces, looks) — the face and the coat go in third
    // and fourth. Passing a frame size here instead, as some older tests do,
    // quietly means "no face, no coat", and then nothing can be recognised.
    tr.update([{ box: box(600 - h / 4, 400 - h, h / 2, h), score: 0.9 }], (t += 400),
      [face(who)], [look(who)]);
  }
  for (let i = 0; i < Math.ceil(DOOR_DECIDE_MS / 1000) + 2; i++) tr.update([], (t += 1000));
  return t;
};

// ── The usher, and a page reload ────────────────────────────────────────────
{
  const before = new PersonTracker();
  before.watchesDoorway("closer");
  let t = 0;
  t = cross(before, 7, t, 60, 200);                 // the usher comes in
  ok("the usher is counted once", before.people === 1, `${before.people}`);

  // What the browser hands to the website, and what the website hands back.
  const kept = before.takeNewlyRemembered();
  ok("and the doorway has something to keep", kept.length >= 1, `${kept.length}`);
  ok("taking it twice does not hand the same person over twice",
     before.takeNewlyRemembered().length === 0);

  // The page is reloaded: a brand new tracker, knowing nothing.
  const after = new PersonTracker();
  after.watchesDoorway("closer");
  let t2 = 0;
  t2 = cross(after, 7, t2, 60, 200);
  ok("without the list, the same usher is a new person all over again",
     after.people === 1, `${after.people}`);

  // …and with it.
  const withList = new PersonTracker();
  withList.watchesDoorway("closer");
  withList.restoreRemembered(kept);
  let t3 = 0;
  t3 = cross(withList, 7, t3, 60, 200);
  ok("given it back, the usher is recognised and nobody new is counted",
     withList.people === 0, `${withList.people}`);
  /**
   * …and they are not counted IN again either, which is the whole point.
   *
   * The usher holding the door goes in and out all morning. Kyro counts
   * their first crossing each way and no more — that is what countedIn and
   * countedOut are for — so a recognised returner adds nothing to either
   * figure. The crossing is still written in the door log, as "again", so
   * the record shows what happened without the number moving.
   */
  ok("…and the arrival is not counted a second time", withList.entries === 0, `${withList.entries}`);
  const log = withList.drainEvents();
  ok("but the door log still shows the crossing happened",
     log.some((e) => String(e.kind).startsWith("again")), JSON.stringify(log.map((e) => e.kind)));
}

// ── A face survives the journey ─────────────────────────────────────────────
{
  // It travels as the same half-size numbers every face here travels as, so
  // what comes back is a hair off what went — far, far closer than the line
  // for "the same person", which is what matters.
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("there is a way back from the form a face travels in", /function unpackFace\(s: string\)/.test(ctx));
  ok("and it is only used on what came back from the website",
     /face: k\.f \? unpackFace\(k\.f\) : null,/.test(ctx));
}

// ── Kept with the service, and only ever sent when it is needed ────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("the website keeps it against the service", /const key = `door_known:\$\{camera_id\}`;/.test(worker)
     && /had\.service === service \? had\.people : \[\]/.test(worker));
  // faceOn is report()'s own name for it; faceOk is the same question asked
  // in rememberPeople, and using that name here was a ReferenceError on
  // every report that carried one of these.
  ok("a face is only kept while face matching is on",
     /f: faceOn && typeof k\.f === "string" \? k\.f : null,/.test(worker));
  ok("…and only handed back while it still is",
     /had\.people\.map\(\(k\) => \(\{ \.\.\.k, f: null \}\)\)/.test(worker));
  ok("it is handed back when a browser has started again, not on every report",
     /handBackRemembered\.add\(camera_id\);/.test(worker)
     && /for \(const camera_id of handBackRemembered\)/.test(worker));
  ok("and only to the computer whose camera it is",
     /if \(!camera_id\.startsWith\(`\$\{device\.id\}:`\)\) continue;/.test(worker));
  ok("it cannot grow without limit", /const MOST_DOOR_REMEMBERED = 800;/.test(worker));
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("only a doorway sends one", /\.\.\.\(c\.isDoor \? \{ remembered: c\.tracker\.takeNewlyRemembered\(\)/.test(ctx));
  ok("and only the people it has newly learned", /takeNewlyRemembered\(\)\.slice\(0, 25\)/.test(ctx));
  ok("the browser takes it back exactly once", /if \(!back\?\.length \|\| c\.gotRemembered\) continue;/.test(ctx));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A reload does not forget the morning.");
process.exit(fails ? 1 : 0);
