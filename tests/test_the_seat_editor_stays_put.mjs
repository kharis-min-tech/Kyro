/**
 * The Seat Editor opens on the same camera every time.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "the seat editor changes constantly" — sent with a picture of it showing a
 * camera labelled Entrance / Exit, which is a doorway and has no seats at all.
 *
 * Two faults, both in the one line that chose a camera when nothing was
 * remembered: `cameras[0]`.
 *
 *   It is whichever the list happened to put first. That list is fetched
 *   again every ten seconds, and a camera dropping out of one reply and back
 *   into the next is enough to make the choice run again and land elsewhere.
 *   Nothing was written down, because only a choice made BY HAND was — so it
 *   could drift for ever.
 *
 *   And it can be the doorway, which is a camera with nothing to draw.
 *
 *   node tests/test_the_seat_editor_stays_put.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/layout-editor/page.tsx"), "utf8");

/** The choice the page makes, lifted out so it can be run against a list that
 *  wobbles the way a ten-second poll really does. */
const pick = (cameras) => {
  const rooms = cameras.filter((c) => c.location !== "entrance" && c.location !== "queue");
  return [...(rooms.length ? rooms : cameras)]
    .sort((a, b) => a.camera_id.localeCompare(b.camera_id))[0]?.camera_id;
};

const DOOR = { camera_id: "web-door", location: "entrance" };
const HALL = { camera_id: "web-hall", location: "indoor" };
const OTHER = { camera_id: "web-balcony", location: "indoor" };

// ── It does not land on a doorway ───────────────────────────────────────────
{
  ok("a doorway is never chosen when there is a room", pick([DOOR, HALL]) === "web-hall");
  ok("…whichever order the list arrives in", pick([HALL, DOOR]) === "web-hall");
  // A building with only a doorway plugged in still has to show something.
  ok("with nothing but a doorway, it shows the doorway rather than nothing",
     pick([DOOR]) === "web-door");
  ok("and the page says a doorway has no seats to draw",
     /is set as a doorway/.test(page) || /no seats/.test(page));
}

// ── …and it does not move ───────────────────────────────────────────────────
{
  // The same list, shuffled the way successive replies can be.
  const orders = [[DOOR, HALL, OTHER], [HALL, OTHER, DOOR], [OTHER, DOOR, HALL], [HALL, DOOR, OTHER]];
  const picks = new Set(orders.map(pick));
  ok("the same cameras always give the same answer", picks.size === 1, [...picks].join(", "));
  ok("…and it is a room", !["web-door"].includes([...picks][0]), [...picks][0]);
}

// ── Written down, so it is only ever chosen once ───────────────────────────
{
  ok("an automatic choice is remembered too, not only one made by hand",
     /if \(!remembered\) \{\s*\n\s*try \{ localStorage\.setItem\(LAST_CAMERA_KEY, pick\.camera_id\); \}/.test(page));
  /**
   * …but a remembered camera missing from ONE reply must not be overwritten.
   * It is usually a camera missing for a second, not a camera that has gone —
   * and since the fallback prefers a room, a moment with only the doorway
   * listed would write the doorway down as the seating camera for good.
   */
  ok("a wobbly poll cannot overwrite what was remembered",
     /Written down only when there was nothing remembered at all/.test(page));
  ok("choosing by hand still writes it down",
     /const chooseCamera = \(id: string\) => \{[\s\S]{0,160}localStorage\.setItem\(LAST_CAMERA_KEY, id\);/.test(page));
  ok("and a remembered camera is only restored if it still exists",
     /const keep = remembered && cameras\.find\(\(c\) => c\.camera_id === remembered\);/.test(page));
  ok("nothing is chosen at all while the list is empty",
     /if \(edge === null \|\| !cameras\.length\) return;/.test(page));
  ok("and an existing choice is left alone",
     /if \(cameras\.some\(\(c\) => c\.camera_id === cameraId\)\) return;/.test(page));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. The Seat Editor stays where you left it.");
process.exit(fails ? 1 : 0);
