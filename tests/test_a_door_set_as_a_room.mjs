/**
 * A camera pointed at a door, set as a room, says so.
 *
 * ── Why this is the expensive one ───────────────────────────────────────────
 *
 * A doorway camera and a room camera want opposite treatment, and which one a
 * camera is, is a tick-box somebody has to get right.
 *
 * Get it wrong this way round and NOTHING says so. The camera is open,
 * healthy, sending a perfect picture — and putting a new person in the
 * register for everybody who walks past it, because that is what a room
 * camera is for. One person crossing a doorway appears, disappears and
 * reappears; treated as a room they are three people, and by the end of a
 * morning a hall with 114 chairs has 300 people in it.
 *
 * Nobody should have to know that. The camera can tell: people are in a
 * doorway's view for a few seconds and in a hall's for an hour.
 *
 *   node tests/test_a_door_set_as_a_room.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tracker = read("dashboard/src/lib/personTracker.ts");
const ctx = read("dashboard/src/lib/CountingContext.tsx");
const worker = read("worker/venue.js");

// ── The camera measures how long people stay ───────────────────────────────
{
  ok("every track remembers when it began", /firstSeen: number;/.test(tracker)
     && /lastSeen: now, firstSeen: now,/.test(tracker));
  ok("and how long it lasted is kept when it ends",
     /this\.lives\.push\(Math\.max\(0, now - t\.firstSeen\)\);/.test(tracker));
  ok("on a doorway as well as a room", (tracker.match(/this\.noteLife\(t, now\);/g) ?? []).length === 2);
  ok("only for sightings Kyro was convinced were people",
     /if \(!t\.counted\) return;/.test(tracker.slice(tracker.indexOf("private noteLife"))));
  // The MIDDLE one, not the average: one usher standing by a door for twenty
  // minutes must not make a doorway look like a room.
  ok("the middle time is taken, not the average",
     /sorted\[Math\.floor\(sorted\.length \/ 2\)\]/.test(tracker));
  ok("and it says nothing until there is enough to say it with",
     /if \(this\.lives\.length < 8\) return 0;/.test(tracker));
  ok("it cannot grow without limit", /if \(this\.lives\.length > 200\) this\.lives\.shift\(\);/.test(tracker));
  ok("the camera reports it", /life_s: c\.tracker\.typicalLifeS \|\| undefined,/.test(ctx));
  ok("and the website keeps it", /life_s: num\(c\.life_s, 0, 100000\) \|\| null,/.test(worker));
}

// ── The judgement ──────────────────────────────────────────────────────────
{
  const DOORWAY_LIFE_S = Number(/const DOORWAY_LIFE_S = (\d+);/.exec(worker)?.[1]);
  ok("there is a line, and it is written down", DOORWAY_LIFE_S > 0, `${DOORWAY_LIFE_S}`);
  const call = (life) => !(life > 0) ? "quiet" : life > DOORWAY_LIFE_S ? "a room" : "a doorway";
  ok("people walking through a door read as a doorway", call(4) === "a doorway");
  ok("a congregation seated reads as a room", call(2400) === "a room");
  // Generous on purpose: being wrong the other way tells somebody to stop
  // counting the room they are actually counting.
  ok("a foyer where people stand and talk is left alone", call(40) === "a room");
  ok("and nothing is said before there is anything to say", call(0) === "quiet");
}

// ── Said where faults are said, with the fix ───────────────────────────────
{
  ok("a doorway set as a room is reported",
     /which is a doorway, not a room\./.test(worker));
  ok("saying what it costs", /puts a NEW person in the register for everybody who walks past/.test(worker));
  ok("and naming the tick-box that fixes it", /set its location to the entrance/.test(worker));
  ok("it clears itself when the camera is watching a room",
     /await this\.working\(`\$\{c\.name \|\| c\.camera_id\} is watching a room`\);/.test(worker));
  ok("a camera already set as a doorway is never nagged",
     /if \(c\.location === "entrance" \|\| c\.location === "queue"\) continue;/.test(worker));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A door set as a room says so.");
process.exit(fails ? 1 : 0);
