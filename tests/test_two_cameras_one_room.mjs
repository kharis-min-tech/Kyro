/**
 * Two cameras on one room must not count everyone twice.
 *
 * The thing being guarded against: Kyro added its cameras together. Point two
 * at the same room — the obvious thing to do, to cover it properly — and every
 * person in it was counted twice. The only thing that ever took a duplicate
 * back out was face matching, which is biometric, off by default, and only
 * runs during a live service. Without it the headline was simply double.
 *
 *   node tests/test_two_cameras_one_room.mjs
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
const start = src.indexOf("function roomTotals(");
const end = src.indexOf("function countedMovement(");
const roomTotals = new Function(`${src.slice(start, end)}; return roomTotals;`)();

const cam = (zone, current, over = {}) => ({
  zone_name: zone, camera_id: `c-${zone}-${current}`, current,
  peak: current, entries: 0, exits: 0, capacity: 0, is_running: true, ...over,
});
const total = (rooms, k) => rooms.reduce((n, r) => n + (r[k] || 0), 0);

// 1. Her case exactly: two cameras, one room, both seeing the same people.
{
  const rooms = roomTotals([cam("Main Floor", 13), cam("Main Floor", 11)]);
  ok("two cameras on one room make one room", rooms.length === 1);
  ok("the room holds the fullest view, not the sum", total(rooms, "current") === 13,
     `got ${total(rooms, "current")} (the old way gave 24)`);
  ok("it records that two cameras watch it", rooms[0].cameras === 2);
}

// 2. Different zones are different rooms and still add up — a balcony is not
//    the main floor, and must not be swallowed.
{
  const rooms = roomTotals([cam("Main Floor", 13), cam("Balcony", 11)]);
  ok("two rooms stay two rooms", rooms.length === 2);
  ok("separate rooms are still added together", total(rooms, "current") === 24);
}

// 3. Seats belong to the room, not to each camera.
{
  const rooms = roomTotals([cam("Main Floor", 13, { capacity: 250 }), cam("Main Floor", 11, { capacity: 250 })]);
  ok("one room's seats are not doubled", total(rooms, "capacity") === 250);
}

// 4. Arrivals and departures double in exactly the same way.
{
  const rooms = roomTotals([
    cam("Main Floor", 13, { entries: 29, exits: 4 }),
    cam("Main Floor", 11, { entries: 26, exits: 3 }),
  ]);
  ok("arrivals are not doubled", total(rooms, "entries") === 29);
  ok("departures are not doubled", total(rooms, "exits") === 4);
}

// 5. A camera that has stopped reports 0 and must not drag the room down.
{
  const rooms = roomTotals([cam("Main Floor", 13), cam("Main Floor", 0, { is_running: false })]);
  ok("a stopped camera doesn't empty the room", total(rooms, "current") === 13);
}

// 6. Zone names are matched forgivingly — "Main Floor" and "main floor " are
//    one room, because nobody should lose a count to a capital letter.
{
  const rooms = roomTotals([cam("Main Floor", 13), cam("main floor ", 11)]);
  ok("spacing and capitals don't split a room", rooms.length === 1 && total(rooms, "current") === 13);
}

// 7. A camera with no zone name keeps to itself, so an unnamed camera can't
//    silently absorb another's count.
{
  const rooms = roomTotals([
    { zone_name: "", camera_id: "a", current: 13 },
    { zone_name: "", camera_id: "b", current: 11 },
  ]);
  ok("unnamed cameras stay separate", rooms.length === 2 && total(rooms, "current") === 24);
}

// 8. One camera behaves exactly as before.
{
  const rooms = roomTotals([cam("Main Floor", 13, { capacity: 250, entries: 29, exits: 4 })]);
  ok("a single camera is unchanged",
     rooms.length === 1 && total(rooms, "current") === 13 && total(rooms, "capacity") === 250
     && total(rooms, "entries") === 29 && total(rooms, "exits") === 4);
}

// 9. Three cameras on one room.
{
  const rooms = roomTotals([cam("Hall", 9), cam("Hall", 14), cam("Hall", 12)]);
  ok("three cameras on one room give the fullest view", total(rooms, "current") === 14 && rooms[0].cameras === 3);
}

console.log(
  fails
    ? `\n${fails} failed`
    : "\nAll good. Her two cameras: the old way said 24 people, now it says 13.",
);
process.exit(fails ? 1 : 0);
