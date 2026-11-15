/**
 * "Kyro couldn't follow people reliably on this day, so arrivals and
 * departures aren't shown."
 *
 * Reported as an error, and it reads like one. It is not: the day was
 * counted perfectly well. There is simply no camera set as a doorway.
 *
 * Arrivals and departures are believed from a door and from nowhere else,
 * on purpose. A room camera's "entries" is not arrivals — it is every
 * person it became sure of, and over two hours of people standing up and
 * sitting down it becomes sure of the same congregation again and again.
 * That was "1 person on the camera and 6 came in". So it is refused.
 *
 * But the message blamed the counting, and the real reason is a setting
 * somebody can change in five seconds. A message that names the wrong
 * cause sends somebody hunting a fault that is not there — which is what
 * happened.
 *
 *   node tests/test_no_doorway_says_so.mjs
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
const cal    = fs.readFileSync(path.join(root, "dashboard/src/components/ui/MovementCalendar.tsx"), "utf8");
const types  = fs.readFileSync(path.join(root, "dashboard/src/lib/edgeVenue.ts"), "utf8");

// ── The website says which of the two reasons it is ───────────────────────
{
  ok("a day's movement says whether there is a doorway at all",
     /no_doorway: doorIds\.size === 0,/.test(worker));
  ok("and a doorway is still the only thing arrivals are believed from",
     /const doorIds = new Set\(Object\.values\(await this\.get\("cameras", \{\}\)\)\s*\n?\s*\.filter\(\(c\) => c\.location === "entrance"\)/.test(worker));
  ok("the page is told about it", /no_doorway\?: boolean;/.test(types));
}

// ── …and the page says the true one ───────────────────────────────────────
{
  ok("with no doorway, it names the setting rather than blaming the counting",
     /No camera is watching a doorway, so Kyro can&apos;t tell who arrived from who left\./.test(cal));
  ok("and says exactly where to change it",
     /Set the camera on your entrance to <strong>Entrance<\/strong> on the Cameras page/.test(cal));
  ok("and that the attendance does not depend on it",
     /The attendance figures don&apos;t need it\./.test(cal));
  ok("the old wording is kept for the case where it IS true",
     /Kyro couldn&apos;t follow people reliably on this day/.test(cal));
  ok("the two are chosen apart, not run together",
     /\{data\.no_doorway\s*\n?\s*\? <>/.test(cal));
}

// ── The reason is only ever shown when there is nothing to show ───────────
{
  ok("neither message appears when the arrivals are known",
     /\{!data\.in_out_known && \(/.test(cal));
  ok("and the figures themselves are a dash rather than a nought",
     /\{data\.in_out_known \? hours\.reduce\(\(s, h\) => s \+ h\.arrived, 0\) : "—"\}/.test(cal));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. It says what is actually missing.");
process.exit(fails ? 1 : 0);
