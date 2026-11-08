/**
 * One camera on the entrance, one on the room.
 *
 * Her setup, and the thing being guarded against: a camera on the door and a
 * camera on the room are doing two different jobs. The door says who came and
 * went; the room says how many are there now. Adding the door's people to the
 * room's counts the same person twice — once walking in, once sitting down.
 *
 * It also fixes which arrivals to believe. A room camera calls it a departure
 * whenever someone steps out of shot, which is most of why "29 in, 0 out"
 * looked the way it did. A camera watching a doorway is the one to ask.
 *
 *   node tests/test_door_and_room.mjs
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
const roomTotals = new Function(
  `${src.slice(src.indexOf("function roomTotals("), src.indexOf("function countedMovement("))}; return roomTotals;`,
)();

/** The part of venueTotal() this is about, with the same splitting rule. */
function totals(zones) {
  const doorZones = zones.filter((z) => z.location === "entrance");
  const roomZones = zones.filter((z) => z.location !== "entrance");
  const rooms = roomTotals(roomZones);
  const doors = roomTotals(doorZones);
  const sum = (list, k) => list.reduce((n, r) => n + (r[k] || 0), 0);
  const hasDoor = doorZones.length > 0;
  return {
    current: sum(rooms, "current"),
    capacity: sum(rooms, "capacity"),
    entries: hasDoor ? sum(doors, "entries") : sum(rooms, "entries"),
    exits: hasDoor ? sum(doors, "exits") : sum(rooms, "exits"),
    from_door: hasDoor,
  };
}

const room = (over = {}) => ({
  location: "indoor", zone_name: "Main Floor", camera_id: "room",
  current: 13, peak: 13, entries: 29, exits: 0, capacity: 250, is_running: true, ...over,
});
const door = (over = {}) => ({
  location: "entrance", zone_name: "Entrance", camera_id: "door",
  current: 2, peak: 4, entries: 15, exits: 3, capacity: 0, is_running: true, ...over,
});

// 1. Her setup. The two people standing in the doorway must not be added to
//    the thirteen in the room — they are the same people, a moment earlier.
{
  const t = totals([room(), door()]);
  ok("the doorway's people are not added to the room's", t.current === 13,
     `got ${t.current} (adding them gives 15)`);
  ok("arrivals come from the camera watching the door", t.entries === 15);
  ok("so do departures", t.exits === 3);
  ok("and the page can say where they came from", t.from_door === true);
}

// 2. The door has no seats and must not change the venue's capacity.
{
  ok("a door adds no seats", totals([room(), door()]).capacity === 250);
}

// 3. Without a door camera, nothing changes: the room's own figures are used,
//    shaky as they are.
{
  const t = totals([room()]);
  ok("with no door camera the room's arrivals are used", t.entries === 29 && t.exits === 0);
  ok("and the page says they aren't from a door", t.from_door === false);
}

// 4. The room's unreliable arrivals must not be added to the door's real ones.
{
  const t = totals([room({ entries: 29, exits: 0 }), door({ entries: 15, exits: 3 })]);
  ok("the room's guesswork is dropped, not added", t.entries === 15,
     `got ${t.entries} (adding them gives 44)`);
}

// 5. Two cameras on the same room, plus a door: both rules at once.
{
  const t = totals([
    room({ camera_id: "room-a", current: 13 }),
    room({ camera_id: "room-b", current: 11 }),
    door(),
  ]);
  ok("two cameras on one room still give one room", t.current === 13);
  ok("and the door still supplies the arrivals", t.entries === 15);
}

// 6. Two cameras on one entrance (both sides of a wide door) don't double the
//    arrivals either.
{
  const t = totals([room(), door({ camera_id: "d1", entries: 15 }), door({ camera_id: "d2", entries: 14 })]);
  ok("two cameras on one door don't double the arrivals", t.entries === 15,
     `got ${t.entries} (adding them gives 29)`);
}

// 7. Two entrances in different places are different doors, and both count.
{
  const t = totals([
    room(),
    door({ camera_id: "front", zone_name: "Front door", entries: 15, exits: 3 }),
    door({ camera_id: "side", zone_name: "Side door", entries: 6, exits: 1 }),
  ]);
  ok("separate doors are added together", t.entries === 21 && t.exits === 4);
}

// 8. A door camera on its own: no room, so nobody is reported inside.
{
  const t = totals([door()]);
  ok("a door alone reports nobody in the room", t.current === 0);
  ok("but still reports the arrivals", t.entries === 15);
}

console.log(fails
  ? `\n${fails} failed`
  : "\nAll good. The door counts who came; the room counts who's there. Nobody twice.");
process.exit(fails ? 1 : 0);
