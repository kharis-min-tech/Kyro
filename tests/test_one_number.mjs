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

// The rule, lifted out and run.
const hereNow = (seen, door) => Math.max(seen, door ?? 0);

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

// 3. No door camera, or one too slow to be trusted: what can be seen.
{
  ok("without a trusted door count it is what the cameras see", hereNow(27, null) === 27);
  ok("an empty building is nobody", hereNow(0, null) === 0 && hereNow(0, 0) === 0);
}

// 4. The rule lives in the website, once, and the parts are published with it
//    so the figure can always be taken apart.
{
  ok("the rule is in venueTotal", /const hereNow = Math\.max\(seenNow, doorNet \?\? 0\);/.test(src));
  ok("every page reads the same field", /      total_current: hereNow,/.test(src));
  ok("what the cameras see is published too", /seen_now: seenNow,/.test(src));
  ok("and the door's own figure", /in_building: doorNet,/.test(src));
  ok("occupancy uses the same figure", /venue_occupancy_pct: cap \? Math\.round\(\(hereNow \/ cap\)/.test(src));
}

// 5. The pages stopped working it out for themselves.
{
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
  ok("the headline no longer substitutes its own figure", /inBuilding: null,/.test(page));
  ok("and explains the one it shows", /Kyro shows whichever\s+is larger/.test(page.replace(/\s+/g, " ")) || /whichever/.test(page));

  const sessions = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");
  ok("the Sessions page reads the same field", /venue\?\.total_current/.test(sessions));
}

// 6. The service recording measures the same thing as the pages do, or the
//    "busiest" of a service would disagree with what was on screen during it.
{
  ok("a service's busiest uses the venue total", /const people = v\.total_current;/.test(src));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One question, one number.");
process.exit(fails ? 1 : 0);
