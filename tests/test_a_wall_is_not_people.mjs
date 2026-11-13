/**
 * A blank wall is not two people — and more people than the building holds
 * means something has gone wrong.
 *
 * "who are you counting, this walls not people, make sure this is accurate,
 *  a reminder, 114 people can fit in this room, so if there is more, than
 *  something is wrong."
 *
 * Two small green boxes, side by side, on a blank painted pillar.
 *
 * ── Why it happened ────────────────────────────────────────────────────────
 *
 * The AI is asked "where are the people in this picture" and answers with its
 * best guess for every patch that is vaguely person-shaped. On a featureless
 * wall its best guess is a weak one — and the bar it had to clear was a flat
 * 0.3 whatever the box looked like. A big box scoring 0.3 is the AI being
 * modest about somebody it can plainly see. A small box scoring 0.3 is the AI
 * shrugging at a few hundred pixels. They were treated identically.
 *
 * ── And the ceiling she named ──────────────────────────────────────────────
 *
 * It is the only sanity check on a count that comes from a fact about the
 * BUILDING rather than from the thing being checked. A hall with 114 seats
 * does not hold 300 people.
 *
 *   node tests/test_a_wall_is_not_people.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-wall-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  "--outDir", tmp, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck",
], { stdio: "pipe" });
const { looksLikeAPerson, BIG_ENOUGH, SMALL, SMALL_NEEDS } = await import(path.join(tmp, "peopleDetector.js"));

/** A 1280x720 picture, which is what a camera at 720p gives. */
const H = 720;
const box = (x, y, w, h, score) => ({ box: [x, y, x + w, y + h], score });

// ── Her pillar ─────────────────────────────────────────────────────────────
{
  // The two boxes in the screenshot, scaled to a 720-high frame: roughly a
  // tenth of the height, and the sort of middling score a blank wall earns.
  const wall = [box(500, 330, 40, 78, 0.34), box(560, 330, 38, 74, 0.31)];
  ok("two small middling boxes on a wall are not counted",
     looksLikeAPerson(wall, H, 0.3).length === 0);

  // …and the same boxes WOULD be counted if the AI were actually sure.
  const sure = [box(500, 330, 40, 78, 0.72)];
  ok("but a small box the AI is sure about still is", looksLikeAPerson(sure, H, 0.3).length === 1);
}

// ── Nobody real is lost ────────────────────────────────────────────────────
{
  // Somebody close to the camera, filling a third of the frame, at the plain
  // threshold: the AI being modest about somebody it can plainly see.
  ok("somebody near the camera at the plain threshold is counted",
     looksLikeAPerson([box(400, 200, 120, 260, 0.31)], H, 0.3).length === 1);
  // A row of people across a hall: half the frame height, ordinary scores.
  const row = Array.from({ length: 8 }, (_, i) => box(60 + i * 120, 180, 70, 210, 0.45));
  ok("a row of people across a hall is all counted", looksLikeAPerson(row, H, 0.3).length === 8);
  // Somebody at the back of a big room — small, but the AI is confident.
  ok("somebody at the back is counted when the AI is confident",
     looksLikeAPerson([box(900, 300, 22, 52, 0.62)], H, 0.3).length === 1);
}

// ── Shape ──────────────────────────────────────────────────────────────────
{
  // A radiator, a bench, a bag: wider than tall. Never a person facing a camera.
  ok("a box wider than it is tall is not a person",
     looksLikeAPerson([box(300, 400, 200, 90, 0.9)], H, 0.3).length === 0);
  ok("even at a very high score", looksLikeAPerson([box(300, 400, 400, 120, 0.99)], H, 0.3).length === 0);
  // And somebody sitting, who is nearly square but still taller than wide.
  ok("somebody sitting is still a person",
     looksLikeAPerson([box(300, 300, 150, 190, 0.5)], H, 0.3).length === 1);
}

// ── The bar slides rather than jumping ─────────────────────────────────────
{
  ok("the thresholds are written down", BIG_ENOUGH === 0.20 && SMALL === 0.08 && SMALL_NEEDS === 0.5);
  // A box one pixel either side of a line must not flip from counted to not.
  const near = (tall, score) => looksLikeAPerson([box(10, 10, 40, Math.round(tall * H), score)], H, 0.3).length;
  ok("nothing changes abruptly at one pixel of height",
     near(BIG_ENOUGH + 0.001, 0.31) === near(BIG_ENOUGH - 0.001, 0.31));
  ok("and the bar really is higher for a smaller box",
     near(0.12, 0.38) === 0 && near(0.30, 0.38) === 1);
}

// ── It is wired in, with the other two ─────────────────────────────────────
{
  // Through atCutoff, which is the same filter with the bar as its
  // argument — so the camera can also say what it WOULD have counted at
  // either end of the setting. See suggestSensitivity.
  ok("the counting browser uses it",
     /looksLikeAPerson\(people, px\.height, bar\)/.test(ctx)
     && /c\.people = atCutoff\(countConfidenceRef\.current\);/.test(ctx));
  ok("alongside the ignore areas and the held-up photograph",
     /notHeldBySomebody\(\s*\n?\s*outsideZones\(\s*\n?\s*looksLikeAPerson/.test(ctx));
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── More people than the building holds ────────────────────────────────────
{
  ok("the website works out when the count is above capacity",
     /over_capacity: cap > 0 && hereNow > cap \? \{ seats: cap, counted: hereNow \} : null,/.test(worker));
  // cap only ever adds up capacities somebody ENTERED — against a seat count
  // Kyro guessed from the picture this would be one guess accusing another.
  ok("and only against a seat count somebody entered",
     /const entered = rooms\.reduce\(\(n, r\) => n \+ \(r\.capacity_from === "admin" \? r\.capacity \|\| 0 : 0\), 0\);/.test(worker)
     // …and nothing else. A fixed seat count once stood in when nobody had
     // entered one; it is gone, so no number means no seat count — which is
     // the honest answer, and never a capacity Kyro guessed from a picture.
     && /const cap = entered;/.test(worker)
     && !/SEATS_IN_THE_HALL/.test(worker)
     && !/capacity_from === "found"/.test(worker.slice(worker.indexOf("const entered = rooms.reduce"), worker.indexOf("const seatsHere"))));
  ok("it is raised where failures are collected",
     /await this\.wrong\("Counting",/.test(worker)
     && /people in a building set to hold/.test(worker));
  ok("and cleared when it comes back down", /await this\.working\("Counting"\);/.test(worker));
  ok("the check never stops a report going through",
     /\} catch \{ \/\* the check is a bonus; never the thing that stops a report \*\/ \}/.test(worker));
  // Reported, not silently clamped: people do stand at the back, and a figure
  // quietly capped at 114 is a figure nobody can investigate.
  ok("the figure is reported, never quietly clamped",
     !/hereNow = Math\.min\(hereNow, cap\)/.test(worker)
     && /Reported rather than silently capped/.test(worker));
  ok("and it is said where the figure is, not only in the health panel",
     /More people than the building holds\./.test(page)
     && /look at the green boxes on the Cameras page/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A wall is not people, and 114 is a ceiling worth checking.");
process.exit(fails ? 1 : 0);
