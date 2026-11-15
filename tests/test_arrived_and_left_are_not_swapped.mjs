/**
 * "dont get confused by putting the data that is arrived and the data that
 * is left into the wrong data, so when people leave, dont put it in
 * arrived, make sure."
 *
 * Two separate places work out arrivals and departures, and either could
 * have them the wrong way round without anything looking obviously wrong —
 * a hall fills and empties, so both numbers are large either way.
 *
 *   the doorway   entries go up when somebody walks in, exits when they
 *                 walk out. The INCREASE in each since the last reading is
 *                 what gets counted, never the total.
 *   the register  a person arrived at their first sighting and left at
 *                 their last. Somebody still being seen has not left at
 *                 all.
 *
 * This test drives both with people whose comings and goings are known, so
 * a swap fails it rather than being noticed on a screen weeks later.
 *
 * It also holds the thing found while writing it: a departure was filed
 * under the date somebody ARRIVED. Right for every ordinary service, wrong
 * for anything crossing midnight — a watchnight service put people's
 * leaving at one in the morning into the previous day, before the arrival
 * it belonged to.
 *
 *   node tests/test_arrived_and_left_are_not_swapped.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-swap-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

// ── The doorway: an increase in entries is an arrival, never a departure ──
{
  const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const fn = src.slice(src.indexOf("function countedMovement("), src.indexOf("\n}", src.indexOf("function countedMovement(")) + 2);
  const countedMovement = new Function(`${fn}; return countedMovement;`)();

  const counters = new Map();
  const arrivals = new Array(24).fill(0), departures = new Array(24).fill(0);
  const row = (entries, exits) => ({ camera_id: "door", entries, exits });

  countedMovement(counters, row(10, 4), arrivals, departures, 9);   // the starting point
  ok("the first reading is a starting point, not a crowd",
     arrivals.every((n) => n === 0) && departures.every((n) => n === 0));

  countedMovement(counters, row(13, 4), arrivals, departures, 9);   // three walked in
  ok("three more entries are three arrivals", arrivals[9] === 3, `${arrivals[9]}`);
  ok("…and not three departures", departures[9] === 0, `${departures[9]}`);

  countedMovement(counters, row(13, 9), arrivals, departures, 10);  // five walked out
  ok("five more exits are five departures", departures[10] === 5, `${departures[10]}`);
  ok("…and not five arrivals", arrivals[10] === 0, `${arrivals[10]}`);

  // A counter that starts again must not read as a hall emptying.
  countedMovement(counters, row(0, 0), arrivals, departures, 11);
  ok("a counter starting again adds nothing to either",
     arrivals[11] === 0 && departures[11] === 0, `${arrivals[11]} / ${departures[11]}`);
}

// ── The register: first sighting in, last sighting out ────────────────────
{
  const day = "2026-11-15";
  const at = (h, m = 0, d = 15) => Date.parse(`2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const hub = (rows, now) => {
    const h = Object.create(VenueHub.prototype);
    h.ctx = { storage: { sql: { exec: () => ({ toArray: () => rows }) } } };
    h.register = { service: "svc-now" };
    return h.peopleByDay(0, "UTC", now);
  };

  // Three people at a morning service that has finished.
  const out = hub([
    { service: "svc-old", first_at: at(9, 5),  last_at: at(10, 40) },
    { service: "svc-old", first_at: at(9, 50), last_at: at(11, 10) },
    { service: "svc-old", first_at: at(10, 2), last_at: at(11, 15) },
  ], at(23));
  const v = out.get(day);
  ok("everybody is counted once, on the day they came", v.people === 3, `${v?.people}`);
  ok("arrivals land on the hour they were first seen",
     v.arrived[9] === 2 && v.arrived[10] === 1, `9h:${v.arrived[9]} 10h:${v.arrived[10]}`);
  ok("departures land on the hour they were last seen",
     v.left[10] === 1 && v.left[11] === 2, `10h:${v.left[10]} 11h:${v.left[11]}`);
  ok("and nobody's leaving is counted as an arriving",
     v.arrived.reduce((a, b) => a + b, 0) === 3 && v.left.reduce((a, b) => a + b, 0) === 3);

  // Somebody still being seen, in the service running now, has NOT left.
  const live = hub([
    { service: "svc-now", first_at: at(9, 5), last_at: at(10, 55) },
  ], at(11));
  const w = live.get(day);
  ok("somebody still being seen counts as arrived",
     w.arrived.reduce((a, b) => a + b, 0) === 1);
  ok("…and not as left", w.left.reduce((a, b) => a + b, 0) === 0,
     `${w.left.reduce((a, b) => a + b, 0)}`);
}

// ── A service that crosses midnight ───────────────────────────────────────
// They arrived on the 14th at 11pm and left on the 15th at 1am. The
// departure belongs to the 15th. It used to be filed on the 14th, at hour
// one — before the arrival it belonged to.
{
  const at = (d, h) => Date.parse(`2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`);
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { sql: { exec: () => ({ toArray: () => [
    { service: "watchnight", first_at: at(14, 23), last_at: at(15, 1) },
  ] }) } } };
  h.register = { service: "svc-now" };
  const out = h.peopleByDay(0, "UTC", at(15, 9));

  const came = out.get("2026-11-14"), went = out.get("2026-11-15");
  ok("the arrival is on the night they came", came.arrived[23] === 1, `${came?.arrived[23]}`);
  ok("and that day records no departure at all",
     came.left.reduce((a, b) => a + b, 0) === 0, `${came?.left.reduce((a, b) => a + b, 0)}`);
  ok("the departure is on the morning they left", went && went.left[1] === 1, `${went?.left[1]}`);
  ok("…and is not counted as an arrival on either day",
     went.arrived.reduce((a, b) => a + b, 0) === 0);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Leaving is leaving and arriving is arriving.");
process.exit(fails ? 1 : 0);
