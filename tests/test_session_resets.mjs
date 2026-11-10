/**
 * Ending a session ends the figures with it — and one person is one person,
 * however long the camera runs.
 *
 * What was reported, after an evening of testing alone in front of two
 * cameras:
 *
 *   "i also dont know why it said 31 different people n the service when i
 *    was the only person in the camera"
 *   "when i end my session or camera, this should all be refreshed too"
 *
 * Two faults, and the first one explains the number.
 *
 * ── Why 31 ─────────────────────────────────────────────────────────────────
 *
 *   1. A camera that adds itself is given a room named after itself, because
 *      nothing else is known about it yet. Two cameras plugged into one
 *      computer were therefore two different ROOMS — and "different room" is
 *      a veto: nobody is in two rooms at once, so the person in front of the
 *      second camera could never be the person in front of the first. One
 *      person, two entries, every single time, with no way back.
 *
 *   2. The margin rule asks a candidate to stand clear of the runner-up
 *      before a match is made on appearance. When the runner-up is the same
 *      person filed twice, standing clear is impossible — so no match was
 *      made, somebody new was created, and the NEXT return was harder still.
 *      The register fed itself: eleven people from one person after thirty
 *      trips in and out, climbing by two a trip.
 *
 *   3. The uniform rule — "too many people look like this one, so clothes
 *      say nothing" — counted every identity ever filed, present or not. The
 *      duplicates from (1) and (2) tripped it, after which appearance was
 *      refused outright and EVERY return became a new person.
 *
 *   4. And five appearance readings each is five readings from wherever
 *      somebody happened to be standing for the last half minute. A person
 *      walking back in from further away did not match themselves, because
 *      everything Kyro knew about how they look from further away had been
 *      thrown away.
 *
 * ── The second fault ───────────────────────────────────────────────────────
 *
 * Ending a service put the register away and left everything else: "came in,
 * this session", "went out, this session", the busiest arrival time, and the
 * headline count of people in the building. Those are all measured from a
 * starting line nobody had moved, so a session that finished at six o'clock
 * was still on the screen at seven describing itself as "this session".
 *
 *   node tests/test_session_resets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry, UNIFORM_SEEN_MS, LOOK_SAMPLES, LOOK_SAMPLES_SAVED, SAMPLES } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");

// ── One person in front of a camera, all evening ───────────────────────────
//
// Modelled on what a camera actually sees, which the old simulations did not:
// she does not stand still. Each time she walks back into shot she is nearer
// or further away, so the box round her is a different size — and the size of
// that box is part of an appearance reading.
const look = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3)];
};
/** The same person, standing `d` of the way as close, turned a bit. */
const standing = (l, d, pose = 0) => {
  const v = l.slice();
  v[7] = l[7] * d;
  v[6] = l[6] * (1 + 0.12 * pose);
  v[2] = l[2] + 0.03 * pose;
  v[5] = l[5] + 0.02 * pose;
  return v;
};

/** An evening of walking out of shot and back, on `cams` cameras. */
function herEvening({ trips, cams = ["cam1"], oneRoom = true, stay = 5 }) {
  const r = new IdentityRegistry({ zoneOf: (c) => (oneRoom ? "room" : c) });
  const me = look(1);
  let t = 1_000, track = 1;
  for (let trip = 0; trip < trips; trip++) {
    const d = 0.55 + 0.45 * ((trip * 0.37) % 1);        // how close she stands
    for (let i = 0; i < stay; i++) {
      t += 5_000;                                        // a report every 5 s
      for (const c of cams) {
        r.observe(c, [{ track, look: standing(me, d + 0.03 * i, (i % 3) * 0.7), face: null }], t);
      }
    }
    t += 60_000;                                         // out of the room
    track++;                                             // a new track on the way back
  }
  return r;
}

{
  for (const trips of [5, 10, 20, 30]) {
    const n = herEvening({ trips }).size;
    ok(`one person, ${trips} trips in and out of one camera, is one person`, n === 1, `got ${n}`);
  }
  // The case she actually had: two cameras, both pointed at her.
  for (const trips of [10, 30]) {
    const n = herEvening({ trips, cams: ["cam1", "cam2"] }).size;
    ok(`and one person in front of TWO cameras, ${trips} trips, is still one`, n === 1, `got ${n}`);
  }
  // A long service with nobody leaving: she must not drift either.
  const steady = new IdentityRegistry({ zoneOf: () => "room" });
  const me = look(1);
  let t = 1_000;
  for (let i = 0; i < 400; i++) {
    t += 5_000;
    steady.observe("cam1", [{ track: 1, look: standing(me, 0.6 + 0.4 * Math.abs(Math.sin(i / 9)), (i % 3) * 0.7), face: null }], t);
  }
  ok("half an hour of one person standing there is one person", steady.size === 1, `got ${steady.size}`);
}

// Real people must still be real people. The register being cautious is only
// acceptable while it still counts everybody who is actually there.
{
  const r = new IdentityRegistry({ zoneOf: () => "room" });
  let t = 1_000;
  for (let i = 0; i < 8; i++) {
    t += 5_000;
    r.observe("cam1", [1, 30, 64, 91].map((n) => ({ track: n, look: standing(look(n), 0.8 + 0.02 * i), face: null })), t);
  }
  ok("four different people are four people", r.size === 4, `got ${r.size}`);
}

// ── The two rules that stopped it running away ─────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "worker/identity.js"), "utf8");
  ok("a uniform is people who are HERE, not people on file",
     /now - x\.p\.lastAt <= UNIFORM_SEEN_MS/.test(src) && UNIFORM_SEEN_MS === 60_000);
  ok("look-alikes nobody has seen are one person, not a new one",
     /const rivals = looks\.filter\(\(x\) => x\.look >= this\.lookSame\);/.test(src)
     && /if \(rivals\.length > 1 && !anyHere && best\.look >= this\.lookSame\) \{/.test(src));
  ok("and that is counted, so it can be looked at", /this\.stats\.mergedLookAlikes\+\+/.test(src));

  ok("appearance is remembered across distances, not just the last half minute",
     LOOK_SAMPLES === 20 && LOOK_SAMPLES > SAMPLES);
  ok("the stored copy keeps fewer, so a big register still fits",
     LOOK_SAMPLES_SAVED === 8 && LOOK_SAMPLES_SAVED < LOOK_SAMPLES
     && /for \(const each of \[LOOK_SAMPLES_SAVED, 5, 3, 2, 1\]\)/.test(src));

  ok("two cameras on one computer can see the same spot",
     /if \(ca\.device_id && ca\.device_id === cb\.device_id\) return true;/.test(worker));
  ok("and two cameras told to watch one room, too",
     /return \(ca\.zone_name \|\| ca\.name \|\| a\) === \(cb\.zone_name \|\| cb\.name \|\| b\);/.test(worker));
}

// ── Ending the session refreshes the figures ───────────────────────────────
{
  ok("there is one place that ends a session", /async endSession\(now = Date\.now\(\)\) \{/.test(worker));
  ok("it writes the service into the record", /if \(live\) await this\.finishService\(live, now\);/.test(worker));
  ok("and moves the starting line, so 'this session' starts at nothing",
     /async endSession\(now = Date\.now\(\)\) \{[\s\S]{0,400}?await this\.freshStart\(now, false\);/.test(worker));
  ok("ending a service by hand goes through it",
     /if \(!live \|\| live\.id !== id\) return json\(\{ error: "That service isn't running" \}, 404\);\s*\n\s*await this\.endSession\(Date\.now\(\)\);/.test(worker));
  ok("and so does the last camera being switched off",
     /const lastCameraOff = stopped\.length > 0 && !this\.anyCameraOn\(cams, live, now\);/.test(worker)
     && /if \(lastCameraOff\) await this\.endSession\(now\);/.test(worker));
  // But only the LAST one: stopping one camera of three must not end a
  // service that two other cameras are still counting.
  ok("one camera of several stopping ends nothing", /anyCameraOn\(cams, live, now = Date\.now\(\)\) \{/.test(worker)
     && /if \(l && now - l\.updated_at < OFFLINE_AFTER_MS && l\.status !== "offline"\) return true;/.test(worker));
  ok("nothing is deleted by any of it — the day is still there",
     /Nothing is deleted\. finishService writes the service into the record/.test(worker));
}

// ── Nothing counting means nobody counted ──────────────────────────────────
{
  ok("the headline is none when no camera is running",
     /const anyRunning = zones\.some\(\(z\) => z\.is_running\);/.test(worker)
     && /const hereNow = anyRunning \? Math\.min\(Math\.max\(seenNow, countedNet\), ceiling\) : 0;/.test(worker));
}

// ── "Different people, this service" is gone ───────────────────────────────
//
// Asked for in so many words: "matter of fact remove this, dont even know why
// it's there, really pointless". It said the same thing as the attendance
// headline further up the same page, so when the register was wrong it was
// wrong twice, in two places, with nothing to say which to believe.
{
  ok("the tile is gone from the arrivals card", !/Different people, this service/.test(card));
  ok("and nothing is still being passed to it", !/peopleSeen/.test(card));
  ok("but attendance still comes from the register",
     /people_seen: this\.register\?\.size \?\? sum\("people"\),/.test(worker));
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
  ok("and the page no longer sends it", !/peopleSeen=/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One person is one person, and a session that ends, ends.");
process.exit(fails ? 1 : 0);
