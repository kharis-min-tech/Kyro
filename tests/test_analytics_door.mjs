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
function run({ rows, cams }) {
  const fakeSql = { exec: () => ({ toArray: () => rows }) };
  const self = {
    ctx: { storage: { sql: fakeSql } },
    get: async (k, d) => (k === "live" ? {} : k === "cameras" ? cams : d),
    isOnline: () => false,
    dateFmt: () => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }),
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
  ok("the day's attendance is the door's, not the room's view",
     out.summary.all_time_peak === 200 - 10, `peak ${out.summary.all_time_peak}`);
  ok("and the page is told where it came from", out.summary.from_door === true);
  ok("the room camera's corner is not added to it",
     out.history[0].attendance === 190, `got ${out.history[0].attendance}`);
}

// 2. No camera on a door: unchanged — what the cameras could see.
{
  const rows = [];
  for (let i = 0; i <= 10; i++) {
    rows.push({ camera_id: "room", ts: t0 + i * min, current: i < 5 ? 10 : 27, capacity: 100, entries: 0, exits: 0 });
  }
  const cams = { room: { camera_id: "room", location: "indoor", zone_capacity: 100 } };
  const out = await run({ rows, cams });
  ok("without a door camera the peak is what was seen", out.summary.all_time_peak === 27,
     `peak ${out.summary.all_time_peak}`);
  ok("and the page isn't told otherwise", out.summary.from_door === false);
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
     out.summary.all_time_peak === 100 + 20, `peak ${out.summary.all_time_peak}`);
}

// 4. More people out than in (a counter that only saw the end of a service)
//    is nobody, not a negative number of people.
{
  const rows = [];
  for (let i = 0; i <= 5; i++) rows.push({ camera_id: "door", ts: t0 + i * min, current: 2, capacity: 0, entries: 0, exits: i * 10 });
  const cams = { door: { camera_id: "door", location: "entrance", zone_capacity: 0 } };
  const out = await run({ rows, cams });
  ok("a day that only saw people leave is not a negative attendance",
     (out.summary.all_time_peak ?? 0) === 0, `peak ${out.summary.all_time_peak}`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Analytics and the live page answer the same question.");
process.exit(fails ? 1 : 0);
