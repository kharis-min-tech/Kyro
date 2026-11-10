/**
 * The whole thing working together.
 *
 * Every other test checks one piece. These run cameras, people, seats and
 * services against each other, because that is where the failures that
 * actually happened came from: each half behaving correctly and the two
 * disagreeing.
 *
 *   node tests/test_whole_system.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry } from "../worker/identity.js";
import { Building } from "../worker/building.js";
import { Trouble, cameraHealth } from "../worker/health.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};
const root = path.resolve(import.meta.dirname, "..");

const look = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.1 * Math.cos(a), 0.333 + 0.1 * Math.sin(a), 0.35,
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45, 2.5, 0.5];
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
/** A church: two cameras on the hall, one on the door, a building, a register. */
function church() {
  const b = new Building();
  const zones = { west: "Main", east: "Main", door: "Foyer" };
  const r = new IdentityRegistry({
    zoneOf: (c) => zones[c] ?? c,
    createsIdentities: (c) => c !== "door",
    onSameChair: (x, y) => b.sameChairEvidence(x, y, true),
  });
  return { b, r };
}

// 1 & 2. Two cameras, one chair, one person.
{
  const { b, r } = church();
  let t = 1000;
  b.sawSeat("west", "K1", [200, 200, 280, 270], t);
  b.sawSeat("east", "K9", [900, 400, 980, 470], t);
  for (let i = 0; i < 6; i++) {
    t += 4000;
    r.observe("west", [{ track: 1, look: look(1), face: face(1), seat: "K1" }], t);
    r.observe("east", [{ track: 7, look: look(1), face: face(1), seat: "K9" }], t + 400);
  }
  ok("2. one person in two overlapping views is one attendee", r.size === 1, `${r.size}`);
  const props = b.proposals();
  ok("1. and the two seats are proposed as one chair", props.length === 1, `${props.length}`);
  b.merge(props[0].keep, props[0].drop, "Kharis Admin", b.version);
  ok("1. after merging, one master seat exists", b.overview().total === 1, `${b.overview().total}`);
  ok("1. seen by both cameras", b.overview().seen_by_more_than_one_camera === 1);
  ok("1. and attendance did not move", r.size === 1);
}

// 3. The same person through the entrance, over and over.
{
  const { r } = church();
  let t = 1000;
  for (let trip = 0; trip < 8; trip++) {
    for (let f = 0; f < 3; f++) { t += 500; r.observe("door", [{ track: 900 + trip, look: look(5), face: face(5), seat: null }], t); }
    t += 30_000;
    for (let f = 0; f < 3; f++) { t += 500; r.observe("west", [{ track: 500 + trip, look: look(5), face: face(5), seat: "K3" }], t); }
    t += 30_000;
  }
  ok("3. eight trips through the door is one attendee", r.size === 1, `${r.size}`);
}

// 4. Two different people, two seats.
{
  const { b, r } = church();
  let t = 1000;
  b.sawSeat("west", "K1", [200, 200, 280, 270], t);
  b.sawSeat("west", "K2", [300, 200, 380, 270], t);
  for (let f = 0; f < 5; f++) {
    t += 2000;
    r.observe("west", [
      { track: 1, look: look(11), face: face(11), seat: "K1" },
      { track: 2, look: look(12), face: face(12), seat: "K2" },
    ], t);
  }
  ok("4. two people in two seats are two attendees", r.size === 2, `${r.size}`);
  ok("4. in two seats", r.diagnostics().seated_now === 2);
  ok("4. and the seats were not merged", b.proposals().length === 0);
}

// 5 & 6. Restarts and reconnections.
{
  const { b, r } = church();
  let t = 1000;
  for (let i = 1; i <= 10; i++) b.sawSeat("west", `K${i}`, [100 * i, 200, 100 * i + 80, 270], t);
  for (let i = 1; i <= 10; i++) {
    for (let f = 0; f < 3; f++) { t += 600; r.observe("west", [{ track: i, look: look(20 + i), face: face(20 + i), seat: `K${i}` }], t); }
  }
  const people = r.size, seats = b.overview().total;
  // Everything restarts: the worker reloads both from storage.
  const b2 = new Building(JSON.parse(JSON.stringify(b.save())));
  const r2 = new IdentityRegistry({ zoneOf: () => "Main" });
  r2.restore(JSON.parse(JSON.stringify(r.snapshot())));
  ok("5. seats survive a restart", b2.overview().total === seats, `${b2.overview().total}`);
  ok("5. and so do the people", r2.size === people, `${r2.size}`);
  // The camera reconnects with brand-new track numbers.
  t += 90_000;
  for (let i = 1; i <= 10; i++) {
    b2.sawSeat("west", `K${i}`, [100 * i, 200, 100 * i + 80, 270], t);
    for (let f = 0; f < 3; f++) { t += 600; r2.observe("west", [{ track: 8000 + i, look: look(20 + i), face: face(20 + i), seat: `K${i}` }], t); }
  }
  ok("6. a reconnect creates no duplicate seats", b2.overview().total === seats, `${b2.overview().total}`);
  ok("6. and no duplicate people", r2.size === people, `${r2.size}`);
}

// 7 & 8. A black camera and a stale one are reported, not hidden.
{
  const now = 1_000_000;
  const t = new Trouble();
  const black = cameraHealth({ updated_at: now - 1000, fps: 4, counted_at: now - 1000, black: true }, now);
  if (!black.ok) t.note("Camera · Hall", black.worst);
  ok("7. a black picture is a problem, not a healthy camera", !black.ok && t.broken);
  const stale = cameraHealth({ updated_at: now - 400_000 }, now);
  ok("8. a camera that stopped sending is caught", !stale.ok && stale.state === "not reporting");
  // And neither clears itself by being ignored.
  const after = new Trouble(JSON.parse(JSON.stringify(t.save())));
  ok("7. the problem survives a restart of the website", after.broken);
}

// 9. A service ends and another begins.
{
  const { r } = church();
  let t = 1000;
  r.startService("svc-morning");
  for (let i = 1; i <= 30; i++) {
    for (let f = 0; f < 3; f++) { t += 400; r.observe("west", [{ track: i, look: look(i), face: face(i), seat: `K${i}` }], t); }
  }
  const morning = r.size;
  ok("9. the morning service counted its congregation", morning === 30, `${morning}`);
  r.startService("svc-afternoon");
  ok("9. the afternoon starts at nobody", r.size === 0);
  ok("9. and nothing of the morning is left to recognise", r.diagnostics().with_a_face === 0);
  // The same people come to both services: they are counted again, correctly.
  for (let i = 1; i <= 12; i++) {
    for (let f = 0; f < 3; f++) { t += 400; r.observe("west", [{ track: i, look: look(i), face: face(i), seat: `K${i}` }], t); }
  }
  ok("9. the afternoon counts its own congregation", r.size === 12, `${r.size}`);
}

// 10. Several cameras reporting at the same instant.
{
  const { r } = church();
  let t = 1000;
  // Twenty people, each seen by both hall cameras in the same millisecond.
  for (let round = 0; round < 5; round++) {
    t += 2000;
    const people = Array.from({ length: 20 }, (_, i) => i + 1);
    r.observe("west", people.map((n) => ({ track: n, look: look(n), face: face(n), seat: `K${n}` })), t);
    r.observe("east", people.map((n) => ({ track: 100 + n, look: look(n), face: face(n), seat: `E${n}` })), t);
  }
  ok("10. twenty people seen by two cameras at once are twenty", r.size === 20, `${r.size}`);
  // Nobody holds two seats, however many cameras can see them.
  ok("10. and nobody holds two seats at once", r.diagnostics().seated_now === 20, `${r.diagnostics().seated_now}`);
}

// 11. A failed storage write is exposed, not swallowed.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("11. a failed register write is reported",
     /await this\.wrong\("Register of people",/.test(worker));
  ok("11. a failed seat-state write is reported, with the camera's name",
     /await this\.wrong\(`Seat map · \$\{cams\[camera_id\]\?\.name \|\| camera_id\}`,/.test(worker));
  ok("11. and neither pretends to have succeeded",
     !/catch \(e\) \{ console\.log\("register failed/.test(worker));
}

// 12. Calibration survives a restart and is the same everywhere.
{
  const b = new Building();
  b.sawSeat("west", "K1", [200, 500, 280, 570], 1000);
  b.sawSeat("west", "K2", [200, 200, 280, 270], 1000);
  b.setStage("west", "bottom", "Kharis Admin", b.version);
  const rowsBefore = b.seatsFor("west").map((s) => `${s.seat_id}:${s.row}`);
  const b2 = new Building(JSON.parse(JSON.stringify(b.save())));
  ok("12. the stage setting survives a restart", b2.stageOf.west === "bottom");
  ok("12. and gives the same rows to any device asking",
     JSON.stringify(b2.seatsFor("west").map((s) => `${s.seat_id}:${s.row}`)) === JSON.stringify(rowsBefore));
  // One camera's setting must not disturb another's.
  b2.setStage("east", "left", "Kharis Admin", b2.version);
  ok("12. setting one camera's stage leaves the others alone", b2.stageOf.west === "bottom" && b2.stageOf.east === "left");
}

// 13. The dashboard refreshing changes nothing.
{
  const { r } = church();
  let t = 1000;
  for (let i = 1; i <= 15; i++) {
    for (let f = 0; f < 3; f++) { t += 400; r.observe("west", [{ track: i, look: look(i), face: face(i), seat: `K${i}` }], t); }
  }
  const before = r.size;
  // A dashboard refresh is a read. Reading must never change a count.
  for (let i = 0; i < 50; i++) r.diagnostics();
  ok("13. reading the figures fifty times changes nothing", r.size === before, `${r.size}`);
}

// 14. A backend restart mid-service.
{
  const { b, r } = church();
  let t = 1000;
  r.startService("svc-1");
  for (let i = 1; i <= 25; i++) {
    b.sawSeat("west", `K${i}`, [40 * i, 200, 40 * i + 30, 260], t);
    for (let f = 0; f < 3; f++) { t += 400; r.observe("west", [{ track: i, look: look(i), face: face(i), seat: `K${i}` }], t); }
  }
  const people = r.size, seats = b.overview().total;
  // Everything is written down and loaded again, mid-service.
  const r2 = new IdentityRegistry({ zoneOf: () => "Main" });
  r2.restore(JSON.parse(JSON.stringify(r.snapshot())));
  const b2 = new Building(JSON.parse(JSON.stringify(b.save())));
  ok("14. the service's people survive a backend restart", r2.size === people, `${r2.size}`);
  ok("14. and its seats", b2.overview().total === seats);
  ok("14. and it is still the same service", r2.service === "svc-1");
  // The congregation carries on being seen, on new track numbers.
  //
  // THIS IS THE HONEST LIMIT, measured rather than asserted away. A restart
  // deliberately does not reload face codes: they are biometric data, they
  // stay in memory, and they die with the process. So after a backend restart
  // Kyro has to recognise everybody by appearance alone — and a few people
  // whose coats aren't distinctive enough are counted a second time.
  //
  // The fix would be to store face codes, or to let "they are in the seat they
  // were in before" count as proof of identity. The first trades a privacy
  // promise for a number. The second is the thing that merges a choir. Neither
  // is worth it, so the cost is paid and shown.
  for (let i = 1; i <= 25; i++) {
    for (let f = 0; f < 3; f++) { t += 400; r2.observe("west", [{ track: 3000 + i, look: look(i), face: face(i), seat: `K${i}` }], t); }
  }
  const extra = r2.size - people;
  console.log(`\n  After a backend restart, ${people} people seen again on new track numbers`
    + ` became ${r2.size} — ${extra} counted twice, because face codes are deliberately not stored.\n`);
  ok("14. a backend restart duplicates nobody it can recognise", extra <= 5, `${extra} duplicated`);
  ok("14. and most of the congregation is still recognised", extra / people < 0.25, `${Math.round(extra / people * 100)}%`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The pieces agree with each other.");
process.exit(fails ? 1 : 0);
