/**
 * A camera that isn't counting has no figures — only a capacity.
 *
 * What was on the screen, with every camera switched off:
 *
 *   a tile reading  0 / 21  ·  21 spaces left  ·  0%  ·  21 left
 *   beside its own message saying the camera is not plugged in;
 *
 *   and a row in Seats by room reading
 *   Capacity 21 · People in 0 · Space left 21 · 0% · Open  Offline
 *   with "Open" and "Offline" drawn on top of one another.
 *
 * Reported as: "i dont have any cameras so it should be 0/0 or 0 left, all
 * needs to be refreshed".
 *
 * Every one of those but the capacity is a MEASUREMENT, and nothing was
 * measuring. "21 spaces left" in a room nothing can see is not a cautious
 * figure, it is an invented one — and in green, which reads as checked. It is
 * exactly the kind somebody acts on: it is the figure a steward would use to
 * decide whether to open another room.
 *
 * Capacity stays, because it is a number somebody typed into a settings box
 * rather than something a camera found.
 *
 * This is the same rule already applied to the last picture a stopped camera
 * sent, and to a room camera's arrivals: a figure that outlives the thing
 * measuring it is worse than no figure, because no figure cannot mislead.
 *
 *   node tests/test_nothing_counting_shows_nothing.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/live-cameras/page.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── One camera's tile ──────────────────────────────────────────────────────
{
  ok("a tile knows whether anything is measuring", /const measuring = isLive;/.test(page));
  ok("no occupancy from a camera that isn't",
     /const pct      = \(measuring && !isQueue && capacity > 0\)/.test(page));
  ok("no space left either",
     /const seatsLeft = \(measuring && !isQueue && capacity > 0\)/.test(page));
  ok("and the count itself is a dash, not a zero",
     /\{measuring \? current\.toLocaleString\(\) : "—"\}/.test(page));
  ok("the capacity is still shown, because somebody typed it in",
     /\{capacity > 0 && <span className="text-xs text-gray-400">\/ \{capacity\.toLocaleString\(\)\}<\/span>\}/.test(page));
  ok("it says why there are no figures rather than showing none",
     /Not counting — no figures from this camera/.test(page));
  ok("and a stopped doorway camera's in\/out goes with them",
     /\{showInOut && measuring \? \(<>/.test(page));
}

// ── The Seats by room table ────────────────────────────────────────────────
{
  ok("a row knows whether that camera is counting",
     /const counting = zone\.is_running && \(zone as \{ is_counting\?: boolean \}\)\.is_counting !== false;/.test(page));
  ok("people in is a dash when it isn't", /\{counting \? zone\.current\.toLocaleString\(\) : "—"\}/.test(page));
  // Both conditions now: something has to be counting, AND the capacity has
  // to be one somebody set rather than one Kyro guessed from the picture.
  // See tests/test_a_guess_is_not_a_capacity.mjs.
  ok("space left is nothing at all, not the whole capacity",
     /const left   = counting && known \? Math\.max\(0, zone\.capacity - zone\.current\) : null;/.test(page)
     && /\{left === null \? "—"/.test(page));
  ok("how full is a dash too", /\{pct === null \? "—" : `\$\{pct\}%`\}/.test(page));
  ok("but a capacity somebody SET stays",
     /\{known \? zone\.capacity\.toLocaleString\(\) : zone\.capacity > 0 \? `~\$\{zone\.capacity\.toLocaleString\(\)\}\?` : "—"\}/.test(page));

  // The overlap: two badges in one 5rem box.
  ok("the status column draws exactly ONE badge",
     /\{!zone\.is_running \? \(/.test(page)
     && /\) : zone\.status === "error" \|\| !counting \? \(/.test(page)
     && /\) : status === "critical" \? \(/.test(page));
  ok("so a switched-off camera can no longer read Open and Offline at once",
     !/\{status === "ok" && \(\s*\n\s*<span[\s\S]{0,200}Open<\/span>\s*\n\s*\)\}\s*\n\s*\{!zone\.is_running && \(/.test(page));
}

// ── The venue header ───────────────────────────────────────────────────────
{
  ok("the header asks how many cameras are actually running",
     /const counting    = \(venueTotal\?\.cameras_running \?\? 0\) > 0;/.test(page));
  ok("in venue is a dash when none are", /\{counting \? current\.toLocaleString\(\) : "—"\}/.test(page));
  ok("and says so in as many words", /no camera is counting · set to hold/.test(page));
  ok("space left is a dash", /const seatsLeft   = counting \? Math\.max\(0, totalSeats - current\) : null;/.test(page));
  ok("with the reason underneath", /nothing is counting/.test(page));
  ok("occupancy too", /\{counting \? `\$\{Math\.round\(venuePct\)\}%` : "—"\}/.test(page));
  ok("and the bar is empty rather than stuck where it was",
     /width: counting \? `\$\{Math\.min\(100, venuePct\)\}%` : "0%"/.test(page));
  ok("the queue estimator can't fit people into a room nobody is watching",
     /const canFitQueue = queueSize > 0 && seatsLeft !== null && seatsLeft >= queueSize;/.test(page));
}

// ── And the website agrees, so the page isn't papering over it ─────────────
{
  ok("with nothing counting, the website's own figure is none",
     /const anyRunning = zones\.some\(\(z\) => z\.is_running\);/.test(worker)
     && /const hereNow = anyRunning \? Math\.min\(Math\.max\(seenNow, countedNet\), ceiling\) : 0;/.test(worker));
  ok("and it publishes how many cameras are running, which is what the page asks",
     /cameras_running: zones\.filter\(\(z\) => z\.is_counting\)\.length/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Nothing counting, nothing claimed.");
process.exit(fails ? 1 : 0);
