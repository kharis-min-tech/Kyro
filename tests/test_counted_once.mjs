/**
 * One person in front of two cameras is one person.
 *
 * What was reported: "the count is not working, i put two of the cameras on my
 * face yet its still double counting" — the headline read 4, then 5, with the
 * line underneath it saying the cameras could see 1 right now.
 *
 * Nothing was wrong with what the cameras could SEE. The headline is the
 * larger of two figures: what is plainly in shot, and everyone counted in less
 * everyone counted out. The second of those was coming from ROOM cameras,
 * because the doorway camera was managing 0 counts a second and could not be
 * believed. A camera on a room has no doorway to watch. The same person
 * stepping out of shot and back is an arrival every single time, so that
 * figure only ever climbs — 4, then 5, then 6 — while one person sits there.
 *
 * The register of people (worker/identity.js) is the one thing in Kyro that
 * knows those were all the same person. So it caps the headline: there cannot
 * be more people in the building than different people have been seen all
 * service. It is a ceiling, never a floor — it may lower a guess, it may never
 * deny somebody standing in shot.
 *
 *   node tests/test_counted_once.mjs
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
const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");

// The rule, lifted out of venueTotal and run.
const headline = (seen, door, room = 0, everSeen = 0) => {
  const countedNet = door ?? room;
  const ceiling = everSeen ? Math.max(everSeen, seen) : Infinity;
  return Math.min(Math.max(seen, countedNet), ceiling);
};

// 1. The reported fault, exactly as it was on the screen.
{
  ok("one person, cameras see 1, room cameras have counted 5 arrivals → 1",
     headline(1, null, 5, 1) === 1);
  ok("and it does not climb as she steps in and out of shot",
     [4, 5, 6, 7, 12].every((n) => headline(1, null, n, 1) === 1));
  ok("two cameras on one face is still one person",
     headline(1, null, 9, 1) === 1);
}

// 2. It is a ceiling, not a floor. If the register has somehow merged two
//    people into one, the headline follows the room, not the register.
//    A number may be lowered by a ceiling; a person standing in shot may not.
{
  ok("never fewer than the cameras can plainly see", headline(9, null, 2, 1) === 9);
  ok("the register cannot deny a room full of people", headline(40, null, 0, 3) === 40);
}

// 3. A real Sunday is untouched: the ceiling sits far above the figure and
//    never binds.
{
  ok("843 counted in a hall where 900 have been seen is 843",
     headline(210, null, 843, 900) === 843);
  ok("a trusted door camera is still believed",
     headline(19, 142, 0, 400) === 142);
  ok("and the door is capped by the register too",
     headline(19, 142, 0, 60) === 60);
}

// 4. No register yet — the first minute of a service, or face matching off.
//    Nothing changes from before.
{
  ok("no register means no ceiling", headline(9, null, 542, 0) === 542);
  ok("an empty building is nobody", headline(0, null, 0, 0) === 0);
}

// 5. It is in the worker, and the ceiling is built from the register itself
//    rather than a counter that could drift away from it.
{
  ok("the ceiling comes from the register", /const everSeen = this\.register\?\.size \|\| 0;/.test(src));
  ok("and never falls below what is in shot",
     /const ceiling = everSeen \? Math\.max\(everSeen, seenNow\) : Infinity;/.test(src));
  ok("the headline applies it", /const hereNow = anyRunning \? Math\.min\(Math\.max\(seenNow, countedNet\), ceiling\) : 0;/.test(src));
}

// 6. When it bites, the page says so. A headline smaller than the sum printed
//    directly beneath it is otherwise a mystery, and a mystery on this page is
//    what started all of this.
{
  ok("the worker publishes that it capped the figure", /counted_net_capped: countedNet > hereNow \? everSeen : null,/.test(src));
  ok("the page reads it", /counted_net_capped\?: number \| null/.test(page));
  ok("and explains it in plain words",
     /different (person has|people have)/.test(page)
     && /stepping out of shot and back counts as arriving again/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. One person is one person.");
process.exit(fails ? 1 : 0);
