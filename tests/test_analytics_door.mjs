/**
 * Analytics has to agree with the live page.
 *
 * The live page says a hundred and forty people are in the building, counted
 * at the entrance. Analytics said the peak was 27 and the average attendance
 * 16 — not out of date, but answering a different question: how many people
 * the cameras could SEE at once. On a wide auditorium a camera sees its own
 * corner, and a camera on a doorway sees whoever is in the doorway. Neither is
 * attendance.
 *
 * With a camera on the door, a day's attendance is everyone who came in less
 * everyone who went out, which is the same figure the live page shows.
 *
 *   node tests/test_analytics_door.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// The day-by-day builder, lifted out and run on made-up readings.
const from = src.indexOf("  async daily(url) {");
const to = src.indexOf("\n  }", src.indexOf("return { history, arrival, summary };"));
const body = src.slice(from, to + 4);
ok("the daily builder was found", from > 0 && body.includes("doorRun"));

// Stand-ins for the bits of the Durable Object it touches.
function run({ rows, cams, people }) {
  const fakeSql = { exec: () => ({ toArray: () => rows }) };
  const self = {
    ctx: { storage: { sql: fakeSql } },
    get: async (k, d) => (k === "live" ? {} : k === "cameras" ? cams : d),
    isOnline: () => false,
    dateFmt: () => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }),
    // The register of people: how many DIFFERENT people were there each day,
    // and when each of them arrived and left. Empty unless a case supplies it,
    // which is also the truth for every day recorded before it existed.
    peopleByDay: () => people ?? new Map(),
    // How many seats the building has. Zero here on purpose: these cases are
    // about how a day's attendance is WORKED OUT, and holding it at what the
    // room holds is a separate question with its own file
    // (test_full_hall.mjs). Zero means "nothing to hold against", which is
    // also the truth for a building nobody has told.
    seatsInBuilding: async () => 0,
  };
  const fn = new Function("IN_OUT_TRUSTED_FROM", "countedMovement", `return (async function () {
    ${body.replace("async daily(url) {", "const daily = async function (url) {").replace(/\n  }$/, "\n  };")}
    return daily;
  })();`)(0, () => false);
  return fn.then((daily) => daily.call(self, new URL("https://x/?days=30&tz=UTC")));
}

const t0 = Date.parse("2026-11-08T09:00:00Z");
const min = 60_000;

// 1. Her setup: a camera on the room seeing a corner of it, and one on the
//    door. Two hundred people come in over the morning and ten go out.
{
  const rows = [];
  for (let i = 0; i <= 20; i++) {
    rows.push({ camera_id: "room", ts: t0 + i * min, current: 20 + (i % 7), capacity: 0, entries: 0, exits: 0 });
    rows.push({ camera_id: "door", ts: t0 + i * min, current: 3, capacity: 0, entries: i * 10, exits: i * 0.5 | 0 });
  }
  const cams = {
    room: { camera_id: "room", location: "indoor", zone_capacity: 0 },
    door: { camera_id: "door", location: "entrance", zone_capacity: 0 },
  };
  const out = await run({ rows, cams });
  // A day's attendance is how many people came IN. "Most at once" is a
  // different and much smaller number: a camera sees its own corner of a hall,
  // so on an afternoon with about 900 people in the building the most seen at
  // once was 19 — and 19 was being reported as the day's attendance.
  ok("the day's attendance is how many came in",
     out.history[0].attendance === 200, `got ${out.history[0].attendance}`);
  ok("what the cameras saw at once is kept as its own figure",
     out.history[0].seen_at_once > 0 && out.history[0].seen_at_once < 30,
     `got ${out.history[0].seen_at_once}`);
  ok("and 'most at once' stays what it says it is",
     out.summary.all_time_peak === out.history[0].seen_at_once, `got ${out.summary.all_time_peak}`);
  ok("the busiest day is the busiest day", out.summary.busiest_day === 200, `got ${out.summary.busiest_day}`);
  ok("and the door's own figure is carried alongside it",
     out.history[0].door_attendance === 190, `got ${out.history[0].door_attendance}`);
  ok("the page is told these are counts of arrivals", out.summary.attendance_is_arrivals === true);
}

// 2. No camera on a door: unchanged — what the cameras could see.
{
  const rows = [];
  for (let i = 0; i <= 10; i++) {
    rows.push({ camera_id: "room", ts: t0 + i * min, current: i < 5 ? 10 : 27, capacity: 100, entries: 0, exits: 0 });
  }
  const cams = { room: { camera_id: "room", location: "indoor", zone_capacity: 100 } };
  const out = await run({ rows, cams });
  // Nothing counted anyone in or out, so attendance falls back to the most
  // seen at once — a floor, and the page says so.
  ok("with nothing counting arrivals, attendance falls back to what was seen",
     out.summary.all_time_peak === 27, `peak ${out.summary.all_time_peak}`);
  ok("and the page is told it is a fallback", out.summary.attendance_is_arrivals === false);
  ok("no door camera is reported", out.summary.from_door === false);
}

// 3. The counting computer restarted at lunchtime and the door counter went
//    back to zero. The morning's arrivals must not be thrown away, nor the
//    afternoon's counted from nothing.
{
  const rows = [];
  for (let i = 0; i <= 10; i++) rows.push({ camera_id: "door", ts: t0 + i * min, current: 2, capacity: 0, entries: i * 10, exits: 0 });
  for (let i = 0; i <= 5; i++) rows.push({ camera_id: "door", ts: t0 + (11 + i) * min, current: 2, capacity: 0, entries: i * 4, exits: 0 });
  const cams = { door: { camera_id: "door", location: "entrance", zone_capacity: 0 } };
  const out = await run({ rows, cams });
  ok("a counter that started again keeps the morning's figure",
     out.history[0].door_attendance === 100 + 20, `got ${out.history[0].door_attendance}`);
}

// 4. More people out than in (a counter that only saw the end of a service)
//    is nobody, not a negative number of people.
{
  const rows = [];
  for (let i = 0; i <= 5; i++) rows.push({ camera_id: "door", ts: t0 + i * min, current: 2, capacity: 0, entries: 0, exits: i * 10 });
  const cams = { door: { camera_id: "door", location: "entrance", zone_capacity: 0 } };
  const out = await run({ rows, cams });
  ok("a day that only saw people leave is not a negative attendance",
     (out.history[0]?.door_attendance ?? 0) === 0, `got ${out.history[0]?.door_attendance}`);
}

// N. The register, once there is one: attendance is different people, counted
//    once each, and it beats both the cameras' tallies and "most at once".
//
//    This is the fault she reported: one person at a desk, a room camera that
//    became sure of her eleven times, and every page in Kyro repeating 11.
{
  const rows = [];
  for (let i = 0; i <= 20; i++) {
    // The room camera's tally climbs all afternoon. It is one person.
    rows.push({ camera_id: "room", ts: t0 + i * min, current: 1, capacity: 0, entries: i, exits: (i * 0.8) | 0 });
  }
  const cams = { room: { camera_id: "room", location: "indoor", zone_capacity: 0 } };
  const people = new Map([["2026-11-08", {
    people: 1,
    arrived: Object.assign(new Array(24).fill(0), { 9: 1 }),
    left: new Array(24).fill(0),
  }]]);
  const out = await run({ rows, cams, people });
  ok("one person at a desk is attendance 1, not 20",
     out.history[0].attendance === 1, `got ${out.history[0].attendance}`);
  ok("and the page is told the figure is different people",
     out.history[0].attendance_from === "register" && out.summary.attendance_from_register === true);
  ok("the camera's own tally is kept beside it, not thrown away",
     out.history[0].came_in === 20, `got ${out.history[0].came_in}`);
  ok("the busiest day is one person", out.summary.busiest_day === 1);
  ok("so is the average", out.summary.avg_attendance === 1);
  ok("one arrival, in the hour she sat down",
     out.arrival[9].count === 1 && out.arrival.reduce((a, b) => a + b.count, 0) === 1);
  ok("and no departures at all — she never went out",
     out.arrival.reduce((a, b) => a + b.exits, 0) === 0);
  ok("the hourly chart says it is counting people, not crossings",
     out.summary.movement_from_register === true);
}

// N+1. Days from before the register still work, and say what they are.
{
  const rows = [];
  for (let i = 0; i <= 20; i++) rows.push({ camera_id: "door", ts: t0 + i * min, current: 3, capacity: 0, entries: i * 10, exits: 0 });
  const cams = { door: { camera_id: "door", location: "entrance", zone_capacity: 0 } };
  const out = await run({ rows, cams });
  ok("an older day still has its figure", out.history[0].attendance === 200);
  ok("and is labelled as the cameras' tally, not the register",
     out.history[0].attendance_from === "entries" && out.summary.attendance_from_register === false);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Analytics and the live page answer the same question.");
process.exit(fails ? 1 : 0);
