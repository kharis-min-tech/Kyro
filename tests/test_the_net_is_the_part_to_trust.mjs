/**
 * "i am highly convinced that this is the real data" — 270 arrived, 258
 * left, on a card beside a room that never held more than eleven people.
 *
 * They do look like real data, and part of them is.
 *
 * ── Where they come from ──────────────────────────────────────────────────
 *
 * Arrivals and departures on this card come from the REGISTER, not from a
 * doorway: a person arrives once, when they were first seen, and leaves
 * once, when they were last seen, however many times a camera lost them
 * and found them again in between.
 *
 * So one entry in the register is exactly one arrival. And without face
 * matching the register gains an entry every time somebody is lost and
 * found again — measured at 45 entries from one person sitting still for
 * an hour. Both figures climb together, all morning.
 *
 * ── Which half survives ───────────────────────────────────────────────────
 *
 * The difference. Every spurious entry adds one arrival AND one departure,
 * so they cancel: 270 less 258 is 12, against 11 ever seen at once. The
 * net is nearly exactly right while the two numbers it is made of are
 * twenty times too big.
 *
 * That is worth saying precisely, rather than hedging both figures and
 * leaving her with nothing: the big numbers are not to be trusted, the gap
 * between them is how many are still in the room.
 *
 *   node tests/test_the_net_is_the_part_to_trust.mjs
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
const page   = fs.readFileSync(path.join(root, "dashboard/src/app/analytics/page.tsx"), "utf8");

// ── The arithmetic the warning rests on ───────────────────────────────────
// Each duplicate entry is one arrival and one departure, so the net is
// untouched by them. This is the claim being made on screen; check it.
{
  const service = ({ people, duplicatesEach, stillHere }) => {
    // Everyone arrives; everyone but those still here also leaves. A
    // duplicate is the same person filed again: another arrival, and
    // another departure for all but the last of them.
    const entries = people * duplicatesEach;
    const arrived = entries;
    const left = entries - stillHere;
    return { arrived, left, net: arrived - left };
  };
  for (const dup of [1, 5, 20, 45]) {
    const r = service({ people: 12, duplicatesEach: dup, stillHere: 11 });
    ok(`with ${String(dup).padStart(2)} entries per person, the net is still right (${r.net})`,
       r.net === 11, `${r.arrived} in, ${r.left} out, net ${r.net}`);
  }
  // …and the gross is not. That is the whole point of the warning.
  const bad = service({ people: 12, duplicatesEach: 22, stillHere: 11 });
  ok("while the two figures themselves are far too big",
     bad.arrived > 200 && bad.left > 200, `${bad.arrived} / ${bad.left}`);
}

// ── Where the figures come from is what makes it true ─────────────────────
{
  ok("arrivals and departures here come from the register",
     /Arrivals and departures by hour, from the register wherever it has/.test(worker)
     && /const useRegister = regDays\.length > 0;/.test(worker));
  ok("and the summary says whether face matching was on",
     /face_matching: \(await this\.privacy\(\)\)\.face_matching,/.test(worker));
}

// ── …and the card says which half to rely on ──────────────────────────────
{
  ok("the chart is told", /facesOff=\{\(summary as \{ face_matching\?: boolean \} \| null\)\?\.face_matching === false\}/.test(page));
  ok("it says both figures climb on their own",
     /Face matching is off, so both of these climb on their own/.test(page));
  ok("it names the cause, in plain words",
     /somebody lost and found again is counted\s*\n?\s*as another arrival/.test(page));
  ok("and it says which part IS reliable, rather than hedging everything",
     /The difference between them is the part to rely on: that is how many are still here\./
       .test(page.replace(/\s+/g, " ")));
  ok("the note sits under the figures, not squeezed beside them",
     page.indexOf("{facesOff && (") > page.indexOf("average day</span></p>\n            <p className=\"text-lg font-bold tabular-nums text-white\">{peak.hour}:00"));
  ok("and nothing is shown when faces are on", /\{facesOff && \(/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The gap between them is the part that survives.");
process.exit(fails ? 1 : 0);
