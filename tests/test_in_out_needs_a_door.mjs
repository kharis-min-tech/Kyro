/**
 * "In" and "out" mean a line, and only a doorway camera watches one.
 *
 * What was on the screen: a tile for a camera pointed at a desk, with nobody
 * in shot and a live count of 0, reading **6 in · 5 out**. Beside it, another
 * reading **2 in · 4 out** — more people leaving than had ever arrived, which
 * cannot happen anywhere. Reported as: "the in and out section is not
 * accurate, nor is it refreshed, it needs to refresh, but its very
 * inaccurate, i didnt even put my face on the came yet its saying its being
 * counted".
 *
 * Two separate faults.
 *
 * ── A room camera was being asked a question it cannot answer ──────────────
 *
 * A doorway camera watches people cross a line and knows which way they went.
 * A room camera has no line. Its "in" is every person it became SURE OF and
 * its "out" is every person it LOST SIGHT OF — so one person at a desk,
 * stepping out of shot and back, produces arrivals and departures all
 * afternoon without walking anywhere. Those numbers were on the tiles, in the
 * venue totals, and standing in for the door whenever no door camera existed.
 *
 * There is a real answer now and it is not a crossing count: the register
 * knows how many different people have been seen and when each was last seen
 * (worker/identity.js). So room cameras are no longer asked, nothing stands
 * in for a doorway, and a room tile shows what it can genuinely measure.
 *
 * ── And 4 out against 2 in ─────────────────────────────────────────────────
 *
 * One flag did two jobs. `counted` meant "Kyro is sure this is a person" —
 * which is what the live figure is made of — and ALSO "counted as having
 * arrived", which is what lets a departure be tallied. When a session's
 * tallies started again, the people still in shot kept it. From then on they
 * could only subtract.
 *
 *   node tests/test_in_out_needs_a_door.mjs
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
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/live-cameras/page.tsx"), "utf8");

// ── The tracker: arrivals and departures stay in step ──────────────────────
//
// Run for real. The tracker is TypeScript, so it is compiled to a temp
// directory with the repo's own tsc and imported — the pattern used by
// tests/test_arrival_buckets.mjs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-inout-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck",
], { stdio: "pipe" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const box = (x, y, w, h) => [x, y, x + w, y + h];
/** One report from a camera: the boxes it can see at this moment. */
const see = (tr, boxes, at) => tr.update(boxes.map((b) => ({ box: b, score: 0.8 })), at, 1280, 720);

{
  const tr = new PersonTracker();      // a ROOM camera: no doorway set
  let t = 0;
  // Two people walk in and settle down.
  for (let i = 0; i < 8; i++) see(tr, [box(200, 200, 60, 160), box(400, 200, 60, 160)], (t += 500));
  ok("two people in a room are two arrivals", tr.entries === 2, `in ${tr.entries}`);
  ok("and nobody has left", tr.exits === 0, `out ${tr.exits}`);

  // A new session starts while they are both still sitting there.
  tr.resetCounts();
  ok("a fresh start puts both tallies back to nothing", tr.entries === 0 && tr.exits === 0);
  ok("and does NOT blank how many are in the room",
     tr.update([{ box: box(200, 200, 60, 160), score: 0.8 }, { box: box(400, 200, 60, 160), score: 0.8 }], (t += 500), 1280, 720) === 2);

  // Now they both leave. GRACE_MS is 45 s — somebody behind a pillar for half
  // a minute has not left — so wait past it.
  for (let i = 0; i < 60; i++) see(tr, [], (t += 1000));
  ok("people who were already here when it reset are in NEITHER figure",
     tr.exits === 0, `out ${tr.exits} — they never arrived during this session`);
  ok("so departures can never run ahead of arrivals", tr.exits <= tr.entries,
     `${tr.entries} in, ${tr.exits} out`);
}

{
  // Somebody who genuinely arrives after the reset still counts, both ways —
  // being careful must not turn into counting nobody.
  const tr = new PersonTracker();
  let t = 0;
  for (let i = 0; i < 8; i++) see(tr, [box(200, 200, 60, 160)], (t += 500));
  tr.resetCounts();
  for (let i = 0; i < 8; i++) see(tr, [box(200, 200, 60, 160), box(600, 200, 60, 160)], (t += 500));
  ok("somebody arriving after the reset is an arrival", tr.entries === 1, `in ${tr.entries}`);
  for (let i = 0; i < 60; i++) see(tr, [], (t += 1000));
  ok("and leaving again is a departure", tr.exits === 1, `out ${tr.exits}`);
  ok("still in step", tr.exits <= tr.entries);
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── The flag that did two jobs ─────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  ok("'is a person' and 'arrived here' are now two different things",
     /counted: boolean;\s+\/\/ confirmed to be a person/.test(src) && /\n  arrived: boolean;/.test(src));
  ok("a departure is tallied against having arrived", /if \(t\.arrived\) this\.exits\+\+;/.test(src));
  ok("and a reset clears only the arrival", /t\.countedIn = false; t\.countedOut = false; t\.arrived = false;/.test(src)
     && !/for \(const t of this\.tracks\) t\.counted = false;/.test(src));
}

// ── Nothing stands in for a doorway any more ───────────────────────────────
{
  ok("in and out are believed only from a door camera",
     /const trustInOut = hasDoor && doorZones\.some\(\(z\) => z\.is_running && z\.in_out\);/.test(worker));
  ok("and only a door's figures are used for them",
     /const entries = sumDoors\("entries"\);/.test(worker) && /const exits = sumDoors\("exits"\);/.test(worker));
  ok("the room cameras' crossing counts no longer stand in", !/const roomNet =/.test(worker));
  ok("with the register answering 'how many are here' instead",
     /const registerNow = this\.register\s*\n?\s*\? this\.register\.hereNow\(Date\.now\(\), LEFT_AFTER_MS, new Set\(zones\.filter/.test(worker)
     && /const countedNet = doorNet \?\? registerNow;/.test(worker));
  // …and somebody a WORKING camera cannot see has probably gone. Five
  // minutes is right when nothing is watching that room any more; it is far
  // too slow when the camera is right there and can see they are not.
  ok("and somebody a working camera can't see drops out in a minute",
     /export const STILL_WATCHING_MS = 60_000;/.test(fs.readFileSync(path.join(root, "worker/identity.js"), "utf8")));
  ok("and the page is told which it was", /counted_net_from_register: doorNet === null && registerNow > 0,/.test(worker));
  // Still null rather than a made-up number when nothing can follow people.
  ok("no door, no in-and-out figure at all",
     /total_entries: trustInOut \? entries : null, total_exits: trustInOut \? exits : null,/.test(worker));
}

// ── The register's own answer ──────────────────────────────────────────────
{
  const { IdentityRegistry } = await import(path.join(root, "worker/identity.js"));
  const r = new IdentityRegistry({ zoneOf: () => "room" });
  const look = (n) => {
    const a = (n * 2.399) % (Math.PI * 2);
    return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
      0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
      2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3)];
  };
  let t = 1_000;
  for (let i = 0; i < 8; i++) {
    t += 5_000;
    r.observe("cam", [1, 30, 64].map((n) => ({ track: n, look: look(n), face: null })), t);
  }
  ok("three people seen are three people here", r.hereNow(t, 5 * 60_000) === 3, `${r.hereNow(t, 5 * 60_000)}`);
  // Two of them leave and are not seen again.
  for (let i = 0; i < 8; i++) {
    t += 5_000;
    r.observe("cam", [{ track: 1, look: look(1), face: null }], t);
  }
  t += 6 * 60_000;
  r.observe("cam", [{ track: 1, look: look(1), face: null }], t);
  ok("and once two have been gone five minutes, one is here",
     r.hereNow(t, 5 * 60_000) === 1, `${r.hereNow(t, 5 * 60_000)}`);
  ok("without anybody being removed from the register", r.size === 3, `${r.size}`);
}

// ── The tiles stop showing it ──────────────────────────────────────────────
{
  ok("the tile asks whether this camera has a doorway at all",
     /doorway: \(z\?\.location \?\? camera\.location\) === "entrance",/.test(page));
  ok("and whether it is quick enough to follow people through one",
     /following: z\?\.in_out \?\? false,/.test(page));
  ok("in and out are shown only when both are true",
     /const showInOut = edgeLive \? edgeLive\.doorway && edgeLive\.following : true;/.test(page));
  ok("a room camera shows what it can measure instead", /most at once/.test(page));
  ok("and says why, for anyone who looks", /it can't count people in and out/.test(page));
  ok("the expanded view follows the same rule",
     /\{ label: "Most at once", value: peak\.toLocaleString\(\)/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. In and out mean a door.");
process.exit(fails ? 1 : 0);
