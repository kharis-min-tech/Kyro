/**
 * One number for "how many people are here".
 *
 * Three pages each worked it out their own way, and all three were on the
 * screen at the same moment: the headline said 1, the line under it said the
 * cameras could see 9, and the Sessions page said 13. Every one of them was
 * answering honestly. Together they were useless — "the numbers are not the
 * same, two three four, five different numbers".
 *
 * There is one rule now, in one place, and every page reads it.
 *
 *   node tests/test_one_number.mjs
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

// The rule, lifted out and run. `door` is the door's net when a door camera is
// keeping up; otherwise the room cameras' own in-less-out is used, which is
// where the arrival figures on the page come from.
// `everSeen` is the register of different people (worker/identity.js). Nobody
// can be in the building who has not been seen, so it is a ceiling — but never
// one that denies somebody standing in shot. See tests/test_counted_once.mjs.
const hereNow = (seen, door, room = 0, everSeen = 0) =>
  Math.min(Math.max(seen, door ?? room), everSeen ? Math.max(everSeen, seen) : Infinity);

// 1. It can never contradict what is plainly in shot. This is the failure
//    that started it: nine people visible, headline reading 1.
{
  ok("nine in shot and a door that has counted one is nine", hereNow(9, 1) === 9);
  ok("it is never less than what the cameras can see", hereNow(13, 0) === 13);
}

// 2. When the door has seen more than the room can, the door wins — which is
//    the whole point of having a camera on a doorway.
{
  ok("a door that has counted 142 in a hall where 19 are visible gives 142", hereNow(19, 142) === 142);
}

// 3. No door camera, or one too slow to be trusted: the room cameras' own
//    in-less-out, which is the sum the arrival card shows — so the headline
//    and the card are the same arithmetic rather than two answers side by side.
{
  ok("without a trusted door it uses the rooms' in less out", hereNow(9, null, 542) === 542);
  ok("and still never less than what is in shot", hereNow(27, null, 3) === 27);
  ok("an empty building is nobody", hereNow(0, null, 0) === 0);
}

// 4. A service still starts and ends on what the cameras can SEE. "Everyone in
//    less everyone out" does not come back down when a hall empties — one
//    missed departure and a service would run until midnight.
{
  // Whether a service is running goes by what the cameras can see…
  ok("starting and ending a service goes by what can be seen",
     /const seen = v\.seen_now \?\? v\.total_current;/.test(src)
     && /if \(seen >= SERVICE_START_PEOPLE\)/.test(src)
     && /if \(seen >= SERVICE_END_PEOPLE\)/.test(src));
  // …but how busy it got is the figure every page shows, or "Here now 81"
  // sits next to "Busiest 19", which cannot be true of anything.
  ok("how busy it got is the figure every page shows", /const people = v\.total_current;/.test(src));
}

// 4. The rule lives in the website, once, and the parts are published with it
//    so the figure can always be taken apart.
{
  ok("the rule is in venueTotal", /const hereNow = Math\.min\(Math\.max\(seenNow, countedNet\), ceiling\);/.test(src));
  ok("and the sum behind it is published", /counted_net: countedNet,/.test(src));
  ok("every page reads the same field", /      total_current: hereNow,/.test(src));
  ok("what the cameras see is published too", /seen_now: seenNow,/.test(src));
  ok("and the door's own figure", /in_building: doorNet,/.test(src));
  ok("occupancy uses the same figure", /venue_occupancy_pct: cap \? Math\.round\(\(hereNow \/ cap\)/.test(src));
}

// 5. The pages stopped working it out for themselves.
{
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
  ok("the headline no longer substitutes its own figure", /inBuilding: null,/.test(page));
  // And nothing else quietly swaps it either. This line preferred the door
  // camera's own net when there was one, which put a different number in the
  // headline from the one every other page was using.
  ok("the live poll feeds the agreed figure, not a second one",
     /const here = vt\.total_current;/.test(page)
     && !/const here = \(edge \? vt\.in_building/.test(page));
  ok("and explains the one it shows",
     /Everyone counted in, less everyone counted out/.test(page)
     && /it can never be fewer than the people plainly in shot/.test(page));

  const sessions = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");
  ok("the Sessions page reads the same field", /venue\?\.total_current/.test(sessions));
}

// 6. The parts are always published, so any figure on any page can be taken
//    apart without asking me what it means.
{
  ok("what the cameras see is published", /seen_now: seenNow,/.test(src));
  ok("the counted sum is published", /counted_net: countedNet,/.test(src));
  ok("and where that sum came from", /counted_net_from_door: doorNet !== null,/.test(src));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One question, one number.");
process.exit(fails ? 1 : 0);
