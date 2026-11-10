/**
 * A picture of a person is not a person, a pillow is not a person — and when
 * Kyro finds out it was wrong, THE NUMBER GOES DOWN.
 *
 * Reported, with the emphasis hers:
 *
 *   "i put my phone towards the camera showing two people / a picture, and it
 *    counted it, now my data is wrong, also it counted my pillow as another
 *    person"
 *
 *   "if ever you make a mistake, make sure you put the number down!! dont
 *    just pile up the false data with the real data ... if you finally
 *    identified that it was 1 person and not 2 put the number down"
 *
 * And the proof that it wasn't: Busiest day 4, "came in this session" 4, the
 * headline 2 — with the counting card on the same screen saying "1 person
 * now, in view of two cameras at once, counted once".
 *
 * ── The two halves ─────────────────────────────────────────────────────────
 *
 * 1. NOT COUNTING THEM IN THE FIRST PLACE, where that can be done honestly.
 *    - A photograph held up to a camera sits ENTIRELY INSIDE the box round
 *      the person holding it, and is much smaller. Two real people standing
 *      close together never do that: one's head is above the other's
 *      shoulders, or their feet are below. Geometry settles it.
 *    - A pillow cannot be settled by geometry — it is not inside anybody. It
 *      is settled over TIME: a seated human being is never still, and a
 *      cushion never moves at all. That is a reason to ask, never a reason to
 *      delete somebody, because people do fall asleep.
 *
 * 2. TAKING THE NUMBER BACK OUT when it was counted anyway. Correcting the
 *    register in memory was only half a correction: every figure a church
 *    reads — attendance, busiest day, came in this session, the arrival
 *    chart — is built from rows in a table, and the rows stayed. That is the
 *    pile-up: a number that could only ever climb.
 *
 *   node tests/test_put_the_number_down.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { IdentityRegistry, ASK_IF_STILL_S, STILL_WATCHING_MS } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SamePerson.tsx"), "utf8");

// ── A photograph held up to the camera ─────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-notaperson-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck",
], { stdio: "pipe" });
const { notHeldBySomebody } = await import(path.join(tmp, "peopleDetector.js"));
const { PersonTracker, STILL_ENOUGH_MS } = await import(path.join(tmp, "personTracker.js"));

const at = (x, y, w, h) => ({ box: [x, y, x + w, y + h], score: 0.8 });

{
  // Her, holding a phone with two people on the screen. The phone is in her
  // hands, chest height, so both faces on it are inside her outline.
  const her = at(300, 100, 200, 500);
  const onScreen1 = at(360, 280, 40, 70);
  const onScreen2 = at(410, 280, 40, 70);
  const kept = notHeldBySomebody([her, onScreen1, onScreen2]);
  ok("a picture of two people held up is not two more people", kept.length === 1, `${kept.length}`);
  ok("and the person holding it is still counted", kept[0] === her);

  // Two real people standing close together, overlapping a lot. Neither is
  // swallowed by the other, so both are still counted — this is the case the
  // rule must not break.
  const a = at(300, 100, 180, 500), b = at(400, 110, 180, 490);
  ok("two people standing close together are still two people",
     notHeldBySomebody([a, b]).length === 2);
  // Even a child beside an adult: much smaller, but not inside them.
  const adult = at(300, 100, 180, 500), child = at(460, 330, 90, 270);
  ok("a child next to an adult is still a person", notHeldBySomebody([adult, child]).length === 2);
  // And somebody far away, small, on their own.
  ok("somebody small on their own is untouched", notHeldBySomebody([at(100, 100, 40, 110)]).length === 1);
  ok("one person is never filtered", notHeldBySomebody([her]).length === 1);
}

// ── A pillow: it never moves ───────────────────────────────────────────────
{
  const tr = new PersonTracker();
  let t = 0;
  // A cushion on a chair. The detector's box jitters by a pixel; it never
  // actually moves.
  for (let i = 0; i < 40; i++) {
    const j = i % 2;                                     // a pixel of jitter
    see(tr, [[500 + j, 300, 560 + j, 420]], (t += 10_000));
  }
  const still = tr.seenNow(t)[0];
  ok("a cushion is still being counted — nothing is deleted on its own",
     tr.seenNow(t).length === 1);
  ok("but Kyro knows it has not moved", still.stillFor >= STILL_ENOUGH_MS,
     `${Math.round(still.stillFor / 1000)}s`);

  // A person in the same chair. Breathing, shifting, turning their head.
  const tr2 = new PersonTracker();
  let u = 0;
  for (let i = 0; i < 40; i++) {
    const d = (i % 5) * 6;                               // a few pixels of life
    see(tr2, [[500 + d, 300 - d, 560 + d, 420 - d]], (u += 10_000));
  }
  ok("a person in the same chair is never flagged", tr2.seenNow(u)[0].stillFor < STILL_ENOUGH_MS,
     `${Math.round(tr2.seenNow(u)[0].stillFor / 1000)}s`);
}
function see(tr, boxes, at) { return tr.update(boxes.map((b) => ({ box: b, score: 0.8 })), at, 1280, 720); }

fs.rmSync(tmp, { recursive: true, force: true });

// ── And it asks, rather than deciding ──────────────────────────────────────
{
  const r = new IdentityRegistry({ zoneOf: () => "room" });
  const look = (n) => {
    const a = (n * 2.399) % (Math.PI * 2);
    return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35, 0.333, 0.333, 0.45, 2.5, 0.5];
  };
  let t = 1_000;
  for (let i = 0; i < 8; i++) r.observe("cam", [{ track: 1, look: look(1), face: null, stillFor: 0 }], (t += 5_000));
  ok("something that moves is never asked about", r.asks.length === 0);
  r.observe("cam", [{ track: 1, look: look(1), face: null, stillFor: ASK_IF_STILL_S }], (t += 5_000));
  const asks = r.takeAsks();
  ok("something that hasn't moved for four minutes is", asks.length === 1 && asks[0].kind === "person");
  ok("and it is still counted meanwhile", r.size === 1);
  ok("the question says why", /hasn't moved at all for \d+ minutes/.test(asks[0].reason));
  // Asked once, not every four minutes for the rest of the morning.
  r.observe("cam", [{ track: 1, look: look(1), face: null, stillFor: ASK_IF_STILL_S + 300 }], (t += 5_000));
  ok("and it is asked once, not over and over", r.asks.length === 0);

  // "No, not a person" takes it off — and stops it coming back.
  const before = r.size;
  const res = r.notAPerson("cam", 1);
  ok("saying no takes it off the register", res && r.size === before - 1, `${before} → ${r.size}`);
  ok("and nothing still points at it",
     [...r.byTrack.values()].every((v) => r.people.has(v.id)));
  ok("the removal is listed so the day's figures follow", r.gone.includes(res.removed));
  // The same cushion, seen again. It must not come back as somebody new.
  for (let i = 0; i < 10; i++) r.observe("cam", [{ track: 9, look: look(1), face: null, stillFor: 0 }], (t += 5_000));
  ok("and anything that looks like it is not counted again", r.size === before - 1, `${r.size}`);
  ok("which is counted, so it can be seen", (r.stats.ignoredNotPeople ?? 0) > 0);
}

// ── Putting the number down, everywhere ────────────────────────────────────
{
  ok("people who stop existing are listed for the hub", /takeGone\(\) \{/.test(fs.readFileSync(path.join(root, "worker/identity.js"), "utf8")));
  ok("merging lists the one that went",
     /this\.people\.delete\(dropId\);\s*\n(?:.*\n)*?\s*this\.gone\.push\(dropId\);/.test(fs.readFileSync(path.join(root, "worker/identity.js"), "utf8")));
  ok("the hub takes their row out of the day's figures",
     /forgetPeopleRows\(service\) \{/.test(worker)
     && /UPDATE people SET deleted_at = \? WHERE deleted_at IS NULL AND service = \? AND person = \?/.test(worker));
  ok("and clears the cache every figure is built from", /this\.movementCache = null;\s*\n\s*\} catch \(e\) \{/.test(worker));
  ok("nothing is written back for somebody merged away a moment ago",
     /\/\/ Anyone who has stopped existing goes first[\s\S]{0,200}this\.forgetPeopleRows\(service\);\s*\n\s*try \{/.test(worker));
  // The whole point: it happens on the answer, not at the next save.
  ok("it happens the moment you answer, not at the next save",
     (worker.match(/this\.forgetPeopleRows\(this\.register\.service\);\s*\n\s*this\.savePeople\(this\.register\.service\);/g) ?? []).length === 2);
  ok("so attendance, busiest day and the arrival chart all follow",
     /SELECT first_at, last_at FROM people WHERE deleted_at IS NULL AND service = \?/.test(worker)
     && /deleted_at IS NULL/.test(worker));
}

// ── And the headline stops lagging behind the cameras ──────────────────────
{
  const r = new IdentityRegistry({ zoneOf: () => "room" });
  const look = (n) => [0.3 + n * 0.02, 0.3, 0.35, 0.3, 0.3, 0.45, 2.5, 0.5];
  let t = 1_000;
  for (let i = 0; i < 8; i++) {
    r.observe("cam", [{ track: 1, look: look(1), face: null }, { track: 2, look: look(9), face: null }], (t += 5_000));
  }
  ok("two people, both here", r.hereNow(t, 5 * 60_000, new Set(["cam"])) === 2);
  // One of them stops being seen. The camera is still running and still
  // looking at the same room, so their not being in shot means something.
  for (let i = 0; i < 20; i++) r.observe("cam", [{ track: 1, look: look(1), face: null }], (t += 5_000));
  ok("somebody a working camera can't see drops out within the minute",
     r.hereNow(t, 5 * 60_000, new Set(["cam"])) === 1,
     `${r.hereNow(t, 5 * 60_000, new Set(["cam"]))}`);
  ok("but if that camera is switched off, they are given the full five minutes",
     r.hereNow(t, 5 * 60_000, new Set()) === 2);
  ok("and the line is written down", STILL_WATCHING_MS === 60_000);
}

// ── The page ───────────────────────────────────────────────────────────────
{
  ok("the panel asks 'Is this a person?'", /Is this a person\?/.test(panel));
  ok("with one picture and two answers", /Yes, a person/.test(panel) && /No, take it off/.test(panel));
  ok("it says why it is asking", /People breathe and shift; a cushion/.test(panel));
  ok("and reports what the answer did to the figures",
     /Taken off the count, and off today&apos;s figures|Taken off the count, and off today's figures/.test(panel));
  ok("the heading says the answer changes the figures straight away",
     /changes the figures straight away/.test(panel) && /Nothing is left piled on top/.test(panel));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A mistake takes the number back down.");
process.exit(fails ? 1 : 0);
