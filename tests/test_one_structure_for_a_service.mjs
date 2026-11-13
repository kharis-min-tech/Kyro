/**
 * One service, one set of headings.
 *
 * "this is meant to be the session structure [...] so i dont know why its
 * like this" — the Sessions page's card and the service card describe the
 * same service, and described it in two different vocabularies:
 *
 *     Sessions page    Now       Peak      Entries    Capacity
 *     Service card     Here now  Busiest   Came in    Seats
 *
 * Two structures for one thing is two things to learn, and side by side
 * they read as two disagreeing answers rather than one answer in two
 * places. The words the rest of Kyro already uses win.
 *
 * What this guards is the structure, not the prose: the four headings, in
 * that order, and no second name anywhere for a figure that has one.
 *
 *   node tests/test_one_structure_for_a_service.mjs
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
/** The words on screen, not the ones in the notes beside them. */
const onScreen = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const card = onScreen(read("dashboard/src/components/ui/AutoServices.tsx"));
const sessions = onScreen(read("dashboard/src/app/sessions/page.tsx"));

const HEADINGS = ["Now", "Peak", "Entries", "Capacity"];

// ── 1. The service card uses the four headings, in that order ─────────────
{
  const found = [...card.matchAll(/className="text-xs text-gray-500">([A-Z][a-z]+)</g)].map((m) => m[1]);
  const four = found.filter((w) => HEADINGS.includes(w));
  ok("1. the service card shows the four headings", four.length === 4, JSON.stringify(found));
  ok("1. in the order the Sessions card uses", four.join(" ") === HEADINGS.join(" "), four.join(" "));
}

// ── 2. …which are the Sessions card's own ─────────────────────────────────
{
  const found = [...sessions.matchAll(/className="text-xs text-gray-500 mb-0\.5">([^<{]+)</g)].map((m) => m[1].trim());
  for (const h of ["Now", "Peak", "Entries"]) {
    ok(`2. the Sessions card still says "${h}"`, found.includes(h), JSON.stringify(found));
  }
  // Its fourth says which kind of number it is, which the other card does
  // too — a guess and an entered figure are not the same claim.
  ok("2. and its fourth is Capacity, or says it is a guess",
     /"Seats \(Kyro's guess\)" : "Capacity"/.test(sessions), "the guess label is gone");
}

// ── 3. No figure has a second name ────────────────────────────────────────
{
  for (const [gone, instead] of [
    ["Here now", "Now"], ["Busiest", "Peak"], ["Came in", "Entries"],
  ]) {
    ok(`3. nothing on the service card still says "${gone}"`,
       !new RegExp(gone).test(card), `use "${instead}"`);
  }
  // …including the page that shows the same attendance figure.
  const arrivals = onScreen(read("dashboard/src/components/ui/ArrivalTimes.tsx"));
  ok("3. nor the arrivals tile, which shows the same number",
     !/Came in/.test(arrivals) && /Entries, this session/.test(arrivals));
}

// ── 4. Each still says what it is ─────────────────────────────────────────
//
// The headings matching is the point, but four words alone are what made
// them look like four attempts at one number in the first place.
{
  ok("4. Now says where it comes from", /the cameras can see/.test(card));
  ok("4. Peak says what it is the most of", /most at once/.test(card));
  ok("4. Entries says it counts people once each", /different people, all service/.test(card));
  ok("4. and the line below still says why they differ",
     /are\s*\n?\s*moments/.test(card) && /only ever goes up/.test(card));
}

// ── 5. A different figure does not borrow a heading's name ────────────────
//
// "Start fresh" resets the door's crossing counters, which are NOT the
// "Entries" heading above it — that counts different people. It used to be
// described as "the came in / went out figures", a hair away from the
// heading it is not.
{
  ok("5. the fresh start names its own figures",
     /arrivals and departures/.test(card) && !/came in \/ went out/.test(card));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
