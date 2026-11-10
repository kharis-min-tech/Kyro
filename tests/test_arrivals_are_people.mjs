/**
 * Eleven arrivals, one person.
 *
 * What was reported: "i was the only one on the camera and its saying 2
 * people, when i go to my analytics it said 11 arrived and 8 left, this is
 * false information because i was the only one in the camera... i never went
 * out of anywhere, was sitting down the whole time... so what 2 other
 * imagination people came in?"
 *
 * Nothing invented anybody. Every one of those figures — "Went out, this
 * session 3", "Busiest exit time, 2 people left", "11 arrived, 8 left",
 * attendance 11, busiest day 11, average attendance 11 — was the same number
 * reaching the screen by six routes: a ROOM camera's "entries".
 *
 * A room camera has no doorway to watch. Its "entries" counts every person it
 * becomes sure of, and over an afternoon it becomes sure of the same
 * congregation again and again. Kyro's own page printed "1 seen at once"
 * directly underneath "11", which was Kyro telling the truth and being
 * ignored by its own arithmetic.
 *
 * The register of people (worker/identity.js) already knew they were one
 * person. It only ever lived in memory for the length of a service, so
 * nothing afterwards could ask it. Now when each different person was first
 * and last seen is written down, and that is where attendance, arrivals and
 * departures come from.
 *
 *   node tests/test_arrivals_are_people.mjs
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
const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-people-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/arrivals.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { bucketPeople } = await import(path.join(tmp, "arrivals.js"));

// ── The worker's rule, lifted out and run against rows as they'd be stored.
//    One row per different person per service: when they were first seen and
//    when they were last seen. ────────────────────────────────────────────────
const LEFT_AFTER_MS = 5 * 60_000;
const HOUR = 3600_000;

/** peopleByDay(), with a fixed timezone so the test doesn't depend on one. */
function byDay(rows, now, liveService = null) {
  const out = new Map();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" });
  for (const r of rows) {
    const d = fmt.format(new Date(r.first_at));
    let v = out.get(d);
    if (!v) { v = { people: 0, arrived: new Array(24).fill(0), left: new Array(24).fill(0) }; out.set(d, v); }
    v.people++;
    v.arrived[Number(hourFmt.format(new Date(r.first_at))) % 24]++;
    const gone = r.service !== liveService || now - r.last_at > LEFT_AFTER_MS;
    if (gone && r.last_at) v.left[Number(hourFmt.format(new Date(r.last_at))) % 24]++;
  }
  return out;
}

const day = Date.UTC(2026, 10, 10);           // 10 November 2026, the day she tested
const at = (h, m = 0) => day + h * HOUR + m * 60_000;

// 1. The reported fault. One person, at a desk, from 15:30 to 16:25. The room
//    camera lost her and found her again eleven times; the register has one
//    row, because it is one person.
{
  const rows = [{ service: "s1", first_at: at(15, 30), last_at: at(16, 25) }];
  const d = byDay(rows, at(16, 30), "s1").get("2026-11-10");
  ok("one person is attendance 1, not 11", d.people === 1);
  ok("she arrived once, at half past three", d.arrived[15] === 1 && d.arrived.reduce((a, b) => a + b) === 1);
  ok("and she has not left — she is still sitting there", d.left.reduce((a, b) => a + b) === 0);
}

// 2. Five minutes after her last sighting, she has left. Once. Not three times.
{
  const rows = [{ service: "s1", first_at: at(15, 30), last_at: at(16, 25) }];
  const d = byDay(rows, at(16, 40), "s1").get("2026-11-10");
  ok("she left once", d.left.reduce((a, b) => a + b) === 1);
  ok("at the hour she was last seen", d.left[16] === 1);
}

// 3. Somebody out of shot for a moment has not left. This is the whole fault:
//    a camera losing a person behind a pillar used to be a departure AND an
//    arrival.
{
  const rows = [{ service: "s1", first_at: at(15, 30), last_at: at(16, 28) }];
  const d = byDay(rows, at(16, 30), "s1").get("2026-11-10");
  ok("two minutes out of sight is not a departure", d.left.reduce((a, b) => a + b) === 0);
}

// 4. A finished service: everybody left, because everybody did.
{
  const rows = [
    { service: "old", first_at: at(10, 5), last_at: at(12, 10) },
    { service: "old", first_at: at(10, 20), last_at: at(12, 15) },
    { service: "old", first_at: at(11, 0), last_at: at(12, 5) },
  ];
  const d = byDay(rows, at(16, 0), "s1").get("2026-11-10");
  ok("three people is attendance 3", d.people === 3);
  ok("two arrived in the ten o'clock hour, one in the eleven", d.arrived[10] === 2 && d.arrived[11] === 1);
  ok("and all three left after noon", d.left[12] === 3);
}

// 5. A real Sunday still works: 220 people, arriving over two hours.
{
  const rows = Array.from({ length: 220 }, (_, i) => ({
    service: "sun", first_at: at(9, 30) + (i % 120) * 60_000, last_at: at(12, 0),
  }));
  const d = byDay(rows, at(16, 0), null).get("2026-11-10");
  ok("220 different people is attendance 220", d.people === 220);
  ok("their arrivals add up to 220", d.arrived.reduce((a, b) => a + b) === 220);
  ok("and so do their departures", d.left.reduce((a, b) => a + b) === 220);
}

// ── The card the church reads. ──────────────────────────────────────────────

// 6. Quarter-hour slots from the website, re-added into whatever size the card
//    is showing. Every size it offers is a whole number of quarter hours, so
//    nothing is ever lost or invented in the re-adding.
{
  // One person: arrived in the fourth quarter-hour, left in the ninth.
  const arrived = new Array(12).fill(0), left = new Array(12).fill(0);
  arrived[3] = 1; left[8] = 1;
  const m = { minutes: 15, from: at(15, 0), arrived, left };
  for (const size of [15, 30, 60, 120, 180, 240]) {
    const s = bucketPeople(m, size);
    ok(`at ${size}-minute slots it is still one person`,
       s.totalArrived === 1 && s.totalLeft === 1,
       `got ${s.totalArrived} in / ${s.totalLeft} out`);
  }
  const quarter = bucketPeople(m, 15);
  ok("the busiest arrival slot holds one person, not two",
     quarter.peakArrival?.arrived === 1 && quarter.peakDeparture?.left === 1);
}

// 7. A fresh start narrows the card to this session and deletes nothing.
{
  const arrived = new Array(8).fill(0), left = new Array(8).fill(0);
  arrived[0] = 5; arrived[6] = 2;
  const m = { minutes: 15, from: at(15, 0), arrived, left };
  ok("the whole service is seven", bucketPeople(m, 15).totalArrived === 7);
  ok("this session, started at 16:15, is two", bucketPeople(m, 15, at(16, 15)).totalArrived === 2);
}

// 8. A busy morning adds up at every slot size — no double counting when
//    quarter hours are merged.
{
  const arrived = Array.from({ length: 16 }, (_, i) => i + 1);     // 136 people
  const left = Array.from({ length: 16 }, () => 2);                // 32
  const m = { minutes: 15, from: at(9, 0), arrived, left };
  for (const size of [15, 30, 60, 120, 240]) {
    const s = bucketPeople(m, size);
    ok(`${size}-minute slots: 136 in, 32 out`, s.totalArrived === 136 && s.totalLeft === 32,
       `got ${s.totalArrived}/${s.totalLeft}`);
  }
}

// ── And that it is wired up, rather than merely possible. ────────────────────

// 9. The record itself.
{
  ok("when each person was first and last seen is written down",
     /CREATE TABLE IF NOT EXISTS people \(service TEXT NOT NULL, person INTEGER NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL/.test(src));
  ok("it is written every time the register is saved", /this\.savePeople\(service\);/.test(src));
  ok("nothing in it describes anybody — two times and a number",
     !/CREATE TABLE IF NOT EXISTS people [^)]*(code|face|look|name)/.test(src));
  ok("a deleted day takes its people with it",
     /UPDATE people SET deleted_at = \? WHERE deleted_at IS NULL AND first_at >= \? AND first_at <= \?/.test(src));
  ok("and undeleting brings them back",
     /UPDATE people SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND first_at >= \? AND first_at <= \?/.test(src));
  ok("a deleted service takes its register too",
     /UPDATE people SET deleted_at = \? WHERE deleted_at IS NULL AND service = \?/.test(src));
}

// 10. Attendance is different people, and says so.
{
  ok("the day's attendance is the register first",
     /const attendance = reg \? reg\.people : v\.came_in > 0 \? v\.came_in : v\.peak;/.test(src));
  ok("every day says where its figure came from", /attendance_from: reg \? "register"/.test(src));
  ok("and the summary says so too", /attendance_from_register: history\.some/.test(src));
  ok("the hourly chart uses the register when it has one",
     /if \(useRegister\) \{/.test(src) && /movement_from_register: useRegister,/.test(src));
}

// 11. The live card gets the same figures, from the same table — so the
//     Attendance page and Analytics cannot disagree.
{
  ok("the live total carries the register's movement", /movement: this\.registerMovement\(serviceNow\?\.id \?\? null\),/.test(src));
  ok("read from the table, so a restart mid-service doesn't lose it",
     /SELECT first_at, last_at FROM people WHERE deleted_at IS NULL AND service = \?/.test(src));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("the card prefers it over the cameras' tallies",
     /const usingRegister = !!movement && movement\.arrived\.length > 0 && !unverified;/.test(card));
  // Said in four words rather than three sentences — "too much writing" —
  // with the full version on hover. It still has to be SAID: the two figures
  // can be very far apart (one person at a desk counted as eleven), so which
  // one is on screen is not optional.
  ok("and says plainly which one it is showing",
     /\{usingRegister \? "Each person counted once" : "Camera tallies — crossings, not people"\}/.test(card));
  ok("with the long version kept where it costs nothing",
     /From the register of people: each person counted once/.test(card)
     && /which count crossings rather than people/.test(card));
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
  ok("the page hands it over", /movement=\{edge && isToday \?/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Arrivals are people.");
process.exit(fails ? 1 : 0);
