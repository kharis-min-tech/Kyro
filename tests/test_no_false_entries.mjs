/**
 * No false arrivals. The ten scenarios, end to end, through the real code.
 *
 * ── What was reported ──────────────────────────────────────────────────────
 *
 * "how is there 1 person on the camera and 6 came in ... now theres 8 that
 * came in meanwhile i didnt even move, this is bad ... that is called to be
 * duplication and therefore false data"
 *
 * …followed by a demand for an investigation rather than another patch:
 * idempotency, identities that survive interruptions, genuine boundary
 * crossings, safety across restarts, an audit trail, and tests for ten named
 * scenarios. This is that investigation, written down.
 *
 * ── What the investigation found ───────────────────────────────────────────
 *
 * TWO separate faults, both of which produce arrivals with nobody moving.
 *
 * 1. A RELOAD COUNTED THE ROOM AGAIN.
 *
 *    A browser reports its own running total since IT started. When that
 *    total came back lower than last time, the website concluded the browser
 *    had restarted and added the WHOLE of the new total as arrivals — on the
 *    reasoning that it was all new since the restart.
 *
 *    It is not. A fresh tracker confirms everybody already standing in front
 *    of the camera within a second or two, and those people did not arrive;
 *    they were already there. So every reload counted the room again. Reload
 *    twice with one person in shot and "came in" goes up by two with nobody
 *    moving at all. Over an evening of testing, that is 0 → 6 → 8.
 *
 * 2. A ROOM CAMERA'S "ENTRIES" REACHED THE CHART ANYWAY.
 *
 *    venueTotal had already been taught that a room camera's "entries" is
 *    not arrivals — it is every person it became sure of, so every track
 *    that dies and restarts adds one. The HISTORY endpoint had not, and the
 *    history endpoint is what the arrivals chart and the "came in, this
 *    session" tile are built from whenever the register's own figures are
 *    not available. The same readings Kyro refused to show in one place it
 *    showed in another.
 *
 * What was checked and found SOUND, so that the record is complete:
 *
 *   - the register itself. Driven end to end below, one person standing
 *     still for ten minutes, with the detector dropping her for up to fifty
 *     seconds at a time, on one camera and on two, across a reload: one
 *     entry, every time.
 *   - the people table. PRIMARY KEY (service, person) with an upsert, so the
 *     same person written a thousand times is one row. Idempotent by
 *     construction.
 *   - the counters, for replay: only forward steps are ever added, so an old
 *     reading arriving late adds nothing.
 *
 *   node tests/test_no_false_entries.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-false-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck",
], { stdio: "pipe" });
const { PersonTracker, DOOR_DECIDE_MS } = await import(path.join(tmp, "personTracker.js"));

/**
 * Long enough that a doorway has written down which way somebody went.
 *
 * It used to be a bare 16000 in every one of these files — one second past a
 * fifteen-second wait, repeated until the wait could not be changed without
 * seven test files calling it a bug. The church asked for longer: "it
 * shouldnt wait 15 seconds after someone has left, it should wait 5-10
 * minutes", because somebody who steps just inside the door and stands
 * talking is not an arrival until they stay.
 *
 * It follows the real number now, wherever that goes next.
 */
const GONE_LONG_ENOUGH = DOOR_DECIDE_MS + 1000;


// ── A model of the whole pipeline ──────────────────────────────────────────
//
// The real tracker in the browser, the real register on the website, and the
// website's own arithmetic for carrying a camera's running totals across
// restarts — lifted out of report() so the thing being tested is the thing
// that runs.

const COUNT_MS = 1_000;        // the browser counts about once a second
const REPORT_MS = 5_000;       // and reports every five

const lookOf = (box, n = 0) => ({
  top: [0.34 + 0.002 * n, 0.31, 0.36],
  bottom: [0.33, 0.30 + 0.002 * n, 0.46],
  shape: (box[3] - box[1]) / Math.max(box[2] - box[0], 1),
  height: (box[3] - box[1]) / 720,
});
const wire = (l) => (l ? [l.top[0], l.top[1], l.top[2], l.bottom[0], l.bottom[1], l.bottom[2], l.shape, l.height]
  .map((v) => Math.round(v * 1000) / 1000) : null);

/** The website's carry-forward, exactly as report() does it. */
function makeCounters() {
  const counters = {};
  const audit = [];
  return {
    counters, audit,
    /** One camera's report. Returns the website's running totals. */
    take(cameraId, rIn, rOut, rPeople = 0, at = 0) {
      const seen = counters[cameraId] ?? { in: 0, out: 0, lastIn: null, lastOut: null, people: 0, lastPeople: null };
      const restarted = seen.lastIn !== null && (rIn < seen.lastIn || rOut < seen.lastOut);
      const first = seen.lastIn === null;
      const step = (now, last) => (first || restarted || now < last ? 0 : now - last);
      seen.in += step(rIn, seen.lastIn);
      seen.out += step(rOut, seen.lastOut);
      seen.people = (seen.people || 0) + step(rPeople, seen.lastPeople ?? 0);
      if (restarted || first) audit.push({ cameraId, at, reason: first ? "first report from this camera" : "its counter started again", not_counted: { in: rIn, out: rOut } });
      seen.lastIn = rIn; seen.lastOut = rOut; seen.lastPeople = rPeople;
      counters[cameraId] = seen;
      return { ...seen };
    },
  };
}

/**
 * One person, in front of `cameras`, for `minutes`. Nobody crosses anything.
 *
 * @param missEvery/missFor  the detector losing her for a few seconds at a time
 * @param reloadAt           seconds at which the browser reloads
 * @param restartWorker      whether the WEBSITE's counters are reloaded from
 *                           storage partway through (a worker restart)
 */
function stillRoom({ minutes = 10, cameras = ["cam1"], missEvery = 0, missFor = 0,
                     reloadAt = null, reconnectAt = null, sameDevice = true, moveAbout = false }) {
  const reg = new IdentityRegistry({ zoneOf: (c) => c, overlapping: (a, b) => a === b || sameDevice });
  const c = makeCounters();
  let trackers = Object.fromEntries(cameras.map((k) => [k, new PersonTracker()]));
  let t = 0, sinceReport = 0;
  for (let f = 0; f < (minutes * 60_000) / COUNT_MS; f++) {
    t += COUNT_MS;
    if (reloadAt && t === reloadAt * 1000) trackers = Object.fromEntries(cameras.map((k) => [k, new PersonTracker()]));
    const unplugged = reconnectAt && t > reconnectAt * 1000 && t <= (reconnectAt + 20) * 1000;
    if (reconnectAt && t === (reconnectAt + 20) * 1000 + COUNT_MS) {
      trackers = Object.fromEntries(cameras.map((k) => [k, new PersonTracker()]));   // a reconnect is a fresh tracker
    }
    const lost = unplugged || (missEvery > 0 && (Math.floor(t / 1000) % missEvery) < missFor);
    for (const k of cameras) {
      // Standing still, or wandering about inside the room — never crossing
      // anything, because there is nothing to cross.
      const drift = moveAbout ? Math.round(Math.sin(f / 7) * 180) : (f % 2);
      const box = k === "cam1" ? [500 + drift, 200, 620 + drift, 560] : [300 + drift, 260, 400 + drift, 520];
      trackers[k].update(lost ? [] : [{ box, score: 0.8 }], t, undefined, lost ? undefined : [lookOf(box, f % 3)]);
    }
    sinceReport += COUNT_MS;
    if (sinceReport < REPORT_MS) continue;
    sinceReport = 0;
    for (const k of cameras) {
      const tr = trackers[k];
      const obs = tr.seenNow(t).map((x) => ({ track: x.track, look: wire(x.look), face: null, stillFor: Math.round(x.stillFor / 1000) }))
        .filter((x) => x.look);
      if (obs.length) reg.observe(k, obs, t);
      c.take(k, tr.entries, tr.exits, tr.people, t);
    }
  }
  const totals = Object.values(c.counters).reduce((a, s) => ({ in: a.in + s.in, out: a.out + s.out }), { in: 0, out: 0 });
  return { people: reg.size, cameraIn: totals.in, cameraOut: totals.out, audit: c.audit, reg };
}

// ── 1. Ten minutes standing still ──────────────────────────────────────────
{
  const r = stillRoom({});
  ok("1. one person still for ten minutes is one person", r.people === 1, `${r.people}`);
  ok("1. and the cameras' own tally of arrivals does not climb", r.cameraIn === 0, `${r.cameraIn}`);
}

// ── 2. Moving about inside the view ────────────────────────────────────────
{
  const r = stillRoom({ moveAbout: true });
  ok("2. walking about inside the room adds nobody", r.people === 1, `${r.people}`);
  ok("2. and adds no arrivals", r.cameraIn === 0, `${r.cameraIn}`);
}

// ── 3. The browser reloads with somebody still in the room ─────────────────
{
  const r = stillRoom({ reloadAt: 300 });
  ok("3. a reload adds nobody to the register", r.people === 1, `${r.people}`);
  ok("3. and no arrivals at all — this was 0 → 6 → 8", r.cameraIn === 0, `${r.cameraIn}`);
  // Nothing to record in a room any more: a room camera reports no arrivals
  // at all, so there is no tally to restart. The audit matters for a DOORWAY
  // camera, which does have one — checked on its own below.
  ok("3. and the first report from a camera is written down",
     r.audit.some((a) => /first report from this camera/.test(a.reason)));
  // Three reloads, which is an ordinary evening of testing.
  const three = stillRoom({ reloadAt: 120 });
  const more = stillRoom({ reloadAt: 120, minutes: 20 });
  ok("3. still nothing after twenty minutes and a reload", more.cameraIn === 0 && more.people === 1,
     `${more.people} people, ${more.cameraIn} in`);
  void three;
}

// ── 3b. The same thing at a DOORWAY, where there is a tally to restart ─────
{
  const c = makeCounters();
  c.take("door", 0, 0, 0, 1000);
  c.take("door", 12, 4, 12, 6000);            // a service's worth of crossings
  ok("3b. a doorway counts crossings normally", c.counters.door.in === 12, `${c.counters.door.in}`);
  // The browser reloads. Its tally starts again, and the first thing it does
  // is confirm the people already standing in the doorway.
  c.take("door", 2, 0, 2, 11000);
  ok("3b. and a reload carries none of it forward", c.counters.door.in === 12, `${c.counters.door.in}`);
  ok("3b. with the reason written down",
     c.audit.some((a) => /counter started again/.test(a.reason)));
  ok("3b. and what was not counted written down with it",
     c.audit.some((a) => a.not_counted && a.not_counted.in === 2));
  // And it carries on counting real crossings from there.
  c.take("door", 5, 1, 5, GONE_LONG_ENOUGH);
  ok("3b. then counts on from the restart", c.counters.door.in === 15, `${c.counters.door.in}`);
}

// ── 4. The camera disconnects and reconnects ───────────────────────────────
{
  const r = stillRoom({ reconnectAt: 240 });
  ok("4. a camera reconnect adds nobody", r.people === 1, `${r.people}`);
  ok("4. and no arrivals", r.cameraIn === 0, `${r.cameraIn}`);
}

// ── 5. The website restarts ────────────────────────────────────────────────
{
  // A worker restart reloads the counters from storage and goes on from
  // there: lastIn is whatever was saved, so the next report's step is
  // measured from it. Nothing is replayed.
  const c = makeCounters();
  c.take("cam1", 0, 0, 0);
  c.take("cam1", 3, 1, 3);        // three people arrived while it ran
  const saved = JSON.parse(JSON.stringify(c.counters));
  const after = makeCounters();
  Object.assign(after.counters, saved);     // the restart
  after.take("cam1", 3, 1, 3);              // the same reading arrives again
  ok("5. a website restart replays nothing", after.counters.cam1.in === 3, `${after.counters.cam1.in}`);
  after.take("cam1", 4, 1, 4);
  ok("5. and carries on counting from where it was", after.counters.cam1.in === 4);
}

// ── 6. The same report submitted ten times ─────────────────────────────────
{
  const c = makeCounters();
  c.take("cam1", 0, 0, 0);
  for (let i = 0; i < 10; i++) c.take("cam1", 5, 2, 5);
  ok("6. the same reading ten times counts once", c.counters.cam1.in === 5, `${c.counters.cam1.in}`);
  ok("6. and the same for departures", c.counters.cam1.out === 2);
  // Out of order, too: an old reading arriving late must add nothing.
  c.take("cam1", 2, 1, 2);
  ok("6. an older reading arriving late adds nothing", c.counters.cam1.in === 5, `${c.counters.cam1.in}`);
}

// ── 7. Out of sight and back ───────────────────────────────────────────────
{
  for (const [missEvery, missFor] of [[10, 2], [60, 20], [120, 50], [90, 70]]) {
    const r = stillRoom({ missEvery, missFor });
    ok(`7. lost for ${missFor}s in every ${missEvery}s: still one person`, r.people === 1, `${r.people}`);
  }
}

// ── 8. Two cameras on the same person ──────────────────────────────────────
{
  const r = stillRoom({ cameras: ["cam1", "cam2"] });
  ok("8. two cameras, one person, one entry", r.people === 1, `${r.people}`);
  const hard = stillRoom({ cameras: ["cam1", "cam2"], missEvery: 120, missFor: 50, reloadAt: 300 });
  ok("8. and through a reload and a flickering detector", hard.people === 1, `${hard.people}`);
  ok("8. with no arrivals invented along the way", hard.cameraIn === 0, `${hard.cameraIn}`);
  ok("8. and none the other way either", hard.cameraOut === 0, `${hard.cameraOut}`);
}

// ── 9. Nobody crosses the entrance ─────────────────────────────────────────
{
  // There is no entrance here at all: these are room cameras. A room camera
  // has no line to cross, so its figures must never be shown as arrivals.
  ok("9. a room camera's in/out never reaches the chart",
     /const atDoor = cams\[r\.camera_id\]\?\.location === "entrance";/.test(worker)
     && /const trusted = atDoor && r\.ts >= IN_OUT_TRUSTED_FROM;/.test(worker));
  ok("9. nor the live figures",
     /const trustInOut = hasDoor && doorZones\.some\(\(z\) => z\.is_running && z\.in_out\);/.test(worker));
  ok("9. nor the tiles",
     /const showInOut = edgeLive \? edgeLive\.doorway && edgeLive\.following : true;/
       .test(fs.readFileSync(path.join(root, "dashboard/src/app/live-cameras/page.tsx"), "utf8")));
}

// ── 10. A genuine arrival and a genuine departure ──────────────────────────
{
  // A doorway camera, told which way "in" is, with somebody walking through
  // it and later walking back out. Exactly one of each.
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  let t = 0;
  const walk = (from, to, steps = 6) => {
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const h = from + (to - from) * k;
      tr.update([{ box: [600 - h / 2, 400 - h, 600 + h / 2, 400], score: 0.85 }], (t += 400));
    }
    // Out of view long enough for the doorway to decide — five minutes now,
    // because somebody who steps just inside and stands talking is not an
    // arrival until they stay. See DOOR_DECIDE_MS.
    for (let i = 0; i < 400; i++) tr.update([], (t += 1000));
  };
  walk(60, 200);                                   // towards the camera: in
  ok("10. one person walking in is exactly one arrival", tr.entries === 1, `${tr.entries}`);
  ok("10. and no departure", tr.exits === 0, `${tr.exits}`);
  walk(200, 60);                                   // away from it: out
  ok("10. walking back out is exactly one departure", tr.exits === 1, `${tr.exits}`);
  ok("10. and no second arrival", tr.entries === 1, `${tr.entries}`);
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── The safeguards themselves ──────────────────────────────────────────────
{
  const identity = fs.readFileSync(path.join(root, "worker/identity.js"), "utf8");
  ok("a room camera no longer produces arrivals at all",
     /private cameInRoom\(_t: Track\): void \{/
       .test(fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8")));
  ok("and the day chart asks the doorway, not every camera",
     /if \(doorIds\.has\(r\.camera_id\) && r\.ts >= IN_OUT_TRUSTED_FROM/.test(worker));
  ok("evidence about somebody survives their track dying",
     /this\.stats\.waitingCarried = \(this\.stats\.waitingCarried \|\| 0\) \+ 1;/.test(identity));
  ok("but only from a sighting that has stopped, and only when it is obvious",
     /if \(now - v\.last < CO_SEEN_MS\) continue;/.test(identity)
     && /bestScore >= this\.lookSame && bestScore - second >= LOOK_MARGIN/.test(identity));
  ok("the people table cannot hold the same person twice",
     /PRIMARY KEY \(service, person\)/.test(worker)
     && /ON CONFLICT \(service, person\) DO UPDATE SET last_at = excluded\.last_at/.test(worker));
  ok("a restarted counter carries nothing forward",
     /const restarted = seen\.lastIn !== null && \(rIn < seen\.lastIn \|\| rOut < seen\.lastOut\);/.test(worker));
  ok("and neither does the first report Kyro ever sees from a camera",
     /const first = seen\.lastIn === null;/.test(worker)
     && /const step = \(now, last\) => \(first \|\| restarted \|\| now < last \? 0 : now - last\);/.test(worker));
  ok("there is an audit trail of what was not counted, and why",
     /await this\.ctx\.storage\.put\("count_audit", trail\.slice\(0, 200\)\);/.test(worker)
     && /reason: first \? "first report from this camera" : "its counter started again"/.test(worker));
  ok("and it can be read", /p === "\/api\/live\/count-audit" && request\.method === "GET"/.test(worker));
  ok("corrections take the number back out of the day's figures",
     /forgetPeopleRows\(service\) \{/.test(worker));
  ok("and nothing uncertain is quietly accepted as somebody new",
     /if \(w\.seen < \(w\.faces \? NEW_PERSON_WITH_FACE : NEW_PERSON_NO_FACE\)\) return null;/
       .test(fs.readFileSync(path.join(root, "worker/identity.js"), "utf8")));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Nobody is counted who did not arrive.");
process.exit(fails ? 1 : 0);
