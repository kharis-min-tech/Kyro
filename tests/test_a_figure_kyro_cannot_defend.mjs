/**
 * "number is not accurate" — 353, over the words "Different people, counted
 * once each", as plain a statement of fact as a screen can make.
 *
 * Kyro knew it could not stand behind it.
 *
 * Without face matching, somebody lost and found again is told apart from
 * everybody else by the colour of their coat alone. Once a reading wobbles
 * — the light shifts, they turn — one person becomes two entries, and two
 * entries that look alike cannot then be told apart from EACH OTHER, so
 * they become four. Measured: one person sitting still for an hour, counted
 * as 45. See tests/test_one_person_alone_needs_a_face.mjs.
 *
 * The figure still shows. It is what was counted, and nothing here rewrites
 * what was counted — "Do not delete or rewrite historical records to make
 * the dashboard appear correct". What changes is that it stops being
 * presented as a fact: the line underneath says it climbs on its own and
 * should be read as the top of the range.
 *
 * The same rule as the word "guess" under a seat count Kyro worked out for
 * itself. A figure that cannot be defended has to say so where it is
 * written, not in a panel somewhere else.
 *
 *   node tests/test_a_figure_kyro_cannot_defend.mjs
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
const card   = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
const page   = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");

// ── The page is told whether faces are on ─────────────────────────────────
{
  ok("the website reports the setting itself",
     /face_matching: \(await this\.privacy\(\)\)\.face_matching,/.test(worker));
  // Not the same as whether faces are ARRIVING: an empty hall reads no
  // faces and nothing is wrong. Those are separate fields and must stay so.
  ok("…separately from whether any faces are arriving",
     /face_cameras: faceFresh\.length,/.test(worker)
     && /face_engine_ready: !!faceReadyAt/.test(worker));
  ok("and the attendance page reads it",
     /face_matching\?: boolean \} \| null\)\?\.face_matching === false/.test(page));
  ok("only for today — an old day's figure is not changed by today's setting",
     /facesOff=\{!!edge && isToday/.test(page));
}

// ── …and says so where the figure is ──────────────────────────────────────
{
  ok("with faces on, the figure stands as counted",
     /: "Different people, counted once each" \}/.test(card));
  ok("with them off, it says the figure climbs on its own",
     /without face matching this climbs on its own, so treat it as the top of the range/.test(card));
  ok("the two are chosen together with the figure, not elsewhere",
     /sub: facesOff\n\s*\? "Counted once each/.test(card));
}

// ── The figure itself is untouched ────────────────────────────────────────
// Saying a number cannot be defended is not the same as changing it.
{
  ok("the value shown is still what was counted",
     /\? \{ value: attendanceShown\.toLocaleString\(\),/.test(card));
  ok("and nothing here holds or rounds it",
     !/facesOff \? 0/.test(card) && !/facesOff \? null/.test(card));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A figure that can't be defended says so.");
process.exit(fails ? 1 : 0);
