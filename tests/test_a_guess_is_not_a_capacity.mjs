/**
 * A seat count Kyro guessed is not the room's capacity.
 *
 * "the system should not even guess that its 21 seats or 16 seats when
 * nothing was seen or shown ... dont assume anything"
 *
 * She never typed 21, or 16. The seat finder looked at the room, decided it
 * could see that many seat-shaped things, and the website wrote the number
 * straight into the room's capacity — where NOTHING could tell it apart from
 * a figure somebody had counted and entered.
 *
 * Everything downstream then treated it as fact:
 *
 *   "0 of 21 seats" and a percentage full on the seating page,
 *   "— / 21" and "21 spaces left" on the camera tile,
 *   a Capacity column reading 21 in Seats by room,
 *   the whole building's capacity, occupancy and space left,
 *   and the phone alert that fires when a room reaches 80% of it.
 *
 * A guess that cannot be told apart from a measurement is worse than no
 * guess, because every figure built on it inherits the confidence without
 * inheriting the doubt — and the one at the end of that chain is a phone
 * alert telling a steward a room is nearly full.
 *
 * So where the number came from travels with it. A found count is still kept
 * and still offered — "Kyro thinks it can see about 21 seats" — and it drives
 * nothing at all until somebody sets the real number.
 *
 *   node tests/test_a_guess_is_not_a_capacity.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const live = fs.readFileSync(path.join(root, "dashboard/src/app/live-cameras/page.tsx"), "utf8");
const seating = fs.readFileSync(path.join(root, "dashboard/src/app/seating/page.tsx"), "utf8");

// ── The website knows where the number came from ───────────────────────────
{
  ok("a capacity carries its source", /async syncCapacity\(camera_id, n, from = "found"\) \{/.test(worker)
     && /c\.capacity_from = from;/.test(worker));
  ok("somebody typing it makes it theirs",
     /if \(body\.zone_capacity !== undefined\) \{[\s\S]{0,200}c\.capacity_from = "admin";/.test(worker));
  ok("and a guess never overwrites what a person entered",
     /if \(from === "found" && c\.capacity_from === "admin"\) return;/.test(worker));
  ok("the source is published with the figures",
     /capacity_from: c\.capacity_from === "admin" \? "admin" : c\.zone_capacity \? "found" : null,/.test(worker));
  ok("it survives a camera moving to another computer",
     /"zone_capacity", "capacity_from", "zone_order"/.test(worker));
}

// ── Nothing is worked out from a guess ─────────────────────────────────────
{
  ok("no occupancy percentage from a guessed capacity",
     /occupancy_pct: c\.capacity_from === "admin" && c\.zone_capacity \?/.test(worker));
  ok("the building's capacity only adds up the ones somebody entered",
     /const entered = rooms\.reduce\(\(n, r\) => n \+ \(r\.capacity_from === "admin" \? r\.capacity \|\| 0 : 0\), 0\);/.test(worker)
     // …or the seats the church has STATED, when a camera is watching a room
     // and nobody has typed a number. Still never one Kyro guessed from a
     // picture, which is the thing this test exists to prevent.
     && /const cap = entered > 0 \? entered : rooms\.length \? SEATS_IN_THE_HALL : 0;/.test(worker)
     && !/capacity_from === "found"/.test(worker.slice(worker.indexOf("const entered = rooms.reduce"), worker.indexOf("const seatsHere"))));
  ok("a room with two cameras is measured if either one is",
     /if \(z\.capacity_from === "admin"\) r\.capacity_from = "admin";/.test(worker));
  // The one at the end of the chain, and the one that reaches a person.
  ok("and NO PHONE ALERT fires against a guess",
     /c\.capacity_from !== "admin" \|\| !this\.isOnline\(l\)\) continue;/.test(worker));
}

// ── The camera tile ────────────────────────────────────────────────────────
{
  ok("the tile asks whether the capacity is known",
     /const capacityKnown = \(edgeLive\?\.capacityFrom \?\? \(camera\.zone_capacity \? "admin" : null\)\) === "admin";/.test(live));
  ok("a guess is not used as the capacity", /const capacity = capacityKnown \? \(camera\.zone_capacity \?\? 0\) : 0;/.test(live));
  ok("so there is no '/ 21' and no spaces left from it",
     /const seatsLeft = \(measuring && !isQueue && capacity > 0\)/.test(live));
  ok("it is offered as a thought instead", /Kyro thinks it can see about/.test(live));
  ok("and says exactly what turning it into a real number switches back on",
     /&ldquo;spaces left&rdquo; and the filling-up alerts stay off until somebody sets/.test(live.replace(/\s+/g, " ")));
}

// ── Seats by room ──────────────────────────────────────────────────────────
{
  ok("the table knows which capacities are real", /const known = zone\.capacity_from === "admin";/.test(live));
  ok("space left and how full need one", /const left   = counting && known \?/.test(live)
     && /const pct    = counting && known \?/.test(live));
  ok("a guess is shown with a tilde and a question mark, not as a number",
     /\$\{zone\.capacity\.toLocaleString\(\)\}\?`/.test(live));
  ok("with a note saying what that means", /is Kyro&apos;s own guess from the picture/.test(live));
}

// ── The seating page ───────────────────────────────────────────────────────
{
  ok("'0 of 21 seats' needs a capacity somebody set",
     /const capKnown  = \(edgeZone as \{ capacity_from\?: string \} \| undefined\)\?\.capacity_from === "admin"/.test(seating));
  ok("utilisation is a dash without one",
     /value=\{cap \? `\$\{utilPct\}%` : "—"\}/.test(seating)
     && /sub=\{cap \? `\$\{occupied\} of \$\{cap\} seats` : "no seat count set for this room"\}/.test(seating));
  ok("and seats left goes with it", /const roomSeats  = capKnown \?/.test(seating));
  ok("the guess is offered there too", /Kyro thinks it can see about/.test(seating));
}

// ── One room's seats, typed into two cameras ───────────────────────────────
//
// "there are 114 chairs in the room, when i start the session make sure this
// is accurate." Typing 114 into both cameras pointed at that one room is the
// obvious thing to do, and it silently sets the building to hold 228 — every
// figure measured against twice the real number, reading comfortable when the
// hall is full. Cameras sharing a room NAME are one room and take the fullest
// view; the fix is one word, and nothing else on the page would say so.
{
  const cams = fs.readFileSync(path.join(root, "dashboard/src/app/cameras/page.tsx"), "utf8");
  ok("the Cameras page notices one room's seats entered twice",
     /function SameSeatsWarning\(\{ cameras \}/.test(cams));
  ok("it only fires when two rooms hold exactly the same number",
     /const same = list\.filter\(\(r\) => list\.filter\(\(x\) => x\.seats === r\.seats\)\.length > 1\);/.test(cams));
  ok("it says what Kyro currently thinks the building holds",
     /so Kyro thinks the building holds/.test(cams.replace(/\s+/g, " ")));
  ok("and gives the one word that fixes it",
     /give\s*\n?\s*them the <strong>same room name<\/strong>/.test(cams)
     || /give them the <strong>same room name<\/strong>/.test(cams.replace(/\s+/g, " ")));
  ok("doorway and queue cameras are left out, since they have no seats",
     /if \(isQueueCamera\(c\) \|\| c\.location === "entrance" \|\| !c\.zone_capacity\) continue;/.test(cams));

  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("and the claim is true: one room's seats are its seats",
     /r\.capacity = take\(r\.capacity, z\.capacity\);/.test(worker));
}

// ── A seat count typed in BEFORE the source was recorded ───────────────────
//
// "seats need to show 114" — on a page reading "Seats —". A capacity with no
// source recorded is treated as a guess and drives nothing, which is right
// for the numbers the seat finder invented and WRONG for one somebody had
// already typed before the field existed: their seat count silently stopped
// working. There is one honest way to tell them apart.
{
  ok("existing seat counts are given a source, once, at startup",
     /for \(const c of Object\.values\(cams\)\) \{\s*\n\s*if \(!c \|\| c\.capacity_from \|\| !c\.zone_capacity\) continue;/.test(worker));
  ok("a capacity matching the Found by Kyro layout is a guess",
     /c\.capacity_from = found && found\.seat_count === c\.zone_capacity \? "found" : "admin";/.test(worker));
  ok("and anything else was typed by somebody",
     /Anything else was typed/.test(worker.replace(/\s+/g, " ")));
  ok("it runs before anything else can read it",
     worker.indexOf("Decide, once, where each camera's existing seat count came from")
       > worker.indexOf("ctx.blockConcurrencyWhile(async () => {"));
  ok("and never runs twice", /if \(!c \|\| c\.capacity_from \|\| !c\.zone_capacity\) continue;/.test(worker));
}

// ── The service card says what is missing, and what it costs ───────────────
{
  const svc = fs.readFileSync(path.join(root, "dashboard/src/components/ui/AutoServices.tsx"), "utf8");
  ok("the service shows how many different people came in",
     /<p className="text-xs text-gray-500">Came in<\/p>/.test(svc)
     && /people_seen/.test(svc));
  ok("and a missing seat count says where to set it",
     /set it on Cameras/.test(svc));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A guess is offered, never assumed.");
process.exit(fails ? 1 : 0);
