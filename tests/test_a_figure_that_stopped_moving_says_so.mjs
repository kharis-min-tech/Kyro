/**
 * "numbers still the same despite people coming in, theres a bug"
 *
 * The figure was right. Nothing was being recorded.
 *
 * ── Why it stops ──────────────────────────────────────────────────────────
 *
 * A service starts by itself once SERVICE_START_PEOPLE have been in shot
 * for a couple of minutes, and ends once the room has had fewer than
 * SERVICE_END_PEOPLE in it for a quarter of an hour. Outside a service
 * nothing goes into the register at all — "a register of people needs a
 * reason to exist, and somebody left a camera running is not one".
 *
 * So testing with one or two people, the service ends after fifteen
 * minutes and does not start again, because one or two people never reach
 * the number that starts one. The attendance figure then stays exactly
 * where it was while people walk in and out in front of the camera.
 *
 * That is correct behaviour and it is indistinguishable from broken.
 * Somebody watching people arrive under a figure that will not move has
 * every reason to report a bug — and did, three times.
 *
 * So the card says it: this is the last figure counted, not a live one,
 * and here is what starts one. Same rule as a stopped camera showing a
 * dash rather than its last count — a figure that has outlived the thing
 * measuring it has to say so.
 *
 *   node tests/test_a_figure_that_stopped_moving_says_so.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const card   = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
const page   = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── The thresholds that make a figure stop ────────────────────────────────
{
  const n = (name) => Number(new RegExp(`const ${name} = (\\d+)`).exec(worker)?.[1]);
  const start = n("SERVICE_START_PEOPLE"), end = n("SERVICE_END_PEOPLE");
  ok("a service needs people to start", start > 0, `${start}`);
  ok("and ends when there are fewer than that", end > 0 && end <= start, `${end} of ${start}`);
  // The gap is the whole of the trap: between the two, nothing starts and
  // nothing is recorded, and a hall with a handful of people sits there.
  ok("so a room with fewer people than that records nothing", end > 1, `${end}`);
  ok("and nothing is recorded outside a service",
     /if \(!service\) return;/.test(worker)
     && /a register of people needs a\n\s*\/\/ reason to exist/.test(worker));
}

// ── The card says so, before anything else ───────────────────────────────
{
  ok("the card is told whether anything is being recorded",
     /recording\?: boolean;/.test(card));
  ok("and the page tells it, for today only",
     /recording=\{edge && isToday \? !!venueTotal\?\.service_now : undefined\}/.test(page));
  ok("a stopped figure says it is the last one counted",
     /Nothing is being recorded just now, so this is the last figure counted — not a live one\./
       .test(card.replace(/["`]\s*\n\s*\+\s*["`]/g, "")));
  ok("and says what starts one",
     /A service starts by itself once enough people have been in shot for a couple of minutes/
       .test(card.replace(/["`]\s*\n\s*\+\s*["`]/g, "")));
  // Said FIRST: it explains why every other caption on the card is stale,
  // so it must not be buried behind the seat-count or face-matching ones.
  const chain = card.slice(card.indexOf("const stopped = recording === false;"));
  ok("it is the first thing checked, because it explains the rest",
     chain.indexOf("const entries") < chain.indexOf("held != null"),
     "something else is decided first");
}

// ── …and only when it is true ─────────────────────────────────────────────
{
  ok("a past day is never called stopped — 'right now' means nothing there",
     /recording=\{edge && isToday \? [^:]+: undefined\}/.test(page));
  ok("and the figure itself is unchanged, as always",
     /\? \{ value: attendanceShown\.toLocaleString\(\),\n\s*sub: "Nothing is being recorded just now/.test(card));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A figure that stopped moving says so.");
process.exit(fails ? 1 : 0);
