/**
 * Kyro asks about the chairs it cannot settle.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "kyro should be able to recognise what a chair is though and when people are
 * sitting down and where a chair is, thats why it should ask questions, which
 * has not been doing completely."
 *
 * It does recognise them. Chairs, benches and sofas come out of the SAME AI
 * run that finds people — the model reports eighty kinds of object and Kyro
 * was already reading three of those rows — so it costs no extra work at all.
 * It also already decides most of them for itself: a place people sit in
 * again and again is a seat, and so is a chair the AI sees plainly.
 *
 * And it already marks the ones it cannot settle. The note beside that code
 * says, in those words, that they are "for an administrator to confirm or
 * reject", and on a camera computer a photograph was sent and the question
 * asked.
 *
 * In Camera Mode nothing ever asked. Uncertain seats sat in the seat map
 * waiting to be noticed, which is not the same as being asked about — which
 * is why she has never once been shown one.
 *
 *   node tests/test_kyro_asks_about_chairs.mjs
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
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-chairs-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/seatFinder.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { SeatFinder, SEAT_W, SEAT_H } = await import(path.join(tmp, "seatFinder.js"));

// ── It really does see chairs, from the same AI run ────────────────────────
{
  const det = read("dashboard/src/lib/peopleDetector.ts");
  ok("bench, chair and sofa are read from the model's own output",
     /export const SEATING_ROWS = \[4 \+ 13, 4 \+ 56, 4 \+ 57\];/.test(det));
  ok("…which costs no extra AI work", /costs no extra AI work whatsoever/.test(det));
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("and a camera on a room looks for them", /c\.seatFinder\.wantsChairs\(Date\.now\(\)\) && engine\.current\.seating/.test(ctx));
}

// ── A chair it cannot settle becomes a question ────────────────────────────
{
  const sf = new SeatFinder("cam");
  const box = (x, y) => [x, y, x + 60, y + 90];
  let t = 0;
  /**
   * Somebody standing very upright in one place, over and over, nowhere near
   * anything else. That is either a chair nobody else uses or a person who
   * stood still — which is exactly the case the seat finder refuses to decide
   * alone, and exactly the case worth asking about.
   */
  for (let i = 0; i < 12; i++) {
    t += 60_000;
    sf.sawPeople([[600, 300, 630, 480]], SEAT_W, SEAT_H, t);   // tall and thin: standing
    sf.decide(t);
  }
  const unsure = sf.uncertain();
  ok("a place Kyro cannot settle is marked uncertain", unsure.length >= 1, `${unsure.length}`);
  ok("and it has a box, so it can be photographed", unsure[0] && unsure[0].box?.length === 4);

  // An answer settles it, both ways.
  sf.confirm(unsure[0].id);
  ok("answering yes makes it a seat", sf.uncertain().length === 0 && sf.seats().length >= 1);
  const sf2 = new SeatFinder("cam");
  for (let i = 0; i < 12; i++) { t += 60_000; sf2.sawPeople([[600, 300, 630, 480]], SEAT_W, SEAT_H, t); sf2.decide(t); }
  const u2 = sf2.uncertain()[0];
  sf2.reject(u2.id);
  ok("answering no removes it", sf2.uncertain().length === 0 && !sf2.seats().some((s) => s.id === u2.id));
}

// ── …and the question actually travels ─────────────────────────────────────
{
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  const worker = read("worker/venue.js");
  ok("the camera offers the ones it cannot settle",
     /seat_asks: c\.seatFinder\.uncertain\(\)\.slice\(0, 4\)/.test(ctx));
  ok("the website turns them into questions", /review_type: "is_this_a_seat"/.test(worker));
  ok("…asking each chair once, never twice",
     /if \(asked\[mark\]\) continue;/.test(worker) && /seats_asked/.test(worker));
  ok("…and a few at a time, so a hall of chairs is not a hall of questions",
     /if \(added >= 3\) break;/.test(worker));
  ok("a picture of the chair is asked for", /want\.push\(\{ id, side: "a", camera_id: a\.camera_id, seat: a\.seat \}\)/.test(worker));
  // Any seat, not only an unsure one. This used to read uncertain(), which
  // was right while "is this a seat?" was the only question about a chair.
  // "Is this the same chair?" asks about two chairs Kyro is quite sure ARE
  // chairs — it is which one they are that it cannot settle — and those are
  // not in uncertain(), so it would have sent no picture at all.
  ok("the camera crops it where it stands, not from the kept people pictures",
     /const pl = c\.seatFinder\.places\.find\(\(x\) => x\.id === want\.seat\);/.test(ctx));
  ok("…scaling the seat finder's own space back to the picture",
     /const sx = c\.grabCanvas\.width \/ SEAT_W, sy = c\.grabCanvas\.height \/ SEAT_H;/.test(ctx));
  ok("the question is not shown until there is a picture to show",
     /\["is_this_a_person", "is_this_a_seat"\]\.includes\(q\.review_type\) \|\| \(q\.pictures \?\? 0\) >= 1/.test(worker));
}

// ── The answer has to get back, or asking changes nothing ──────────────────
{
  const worker = read("worker/venue.js");
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("the answer carries which seat it was about",
     /\.\.\.\(q\.ask\?\.kind === "seat" \? \{ seat: q\.ask\.seat \} : \{\}\)/.test(worker));
  ok("the camera reads the answers it is sent", /for \(const ans of answers \?\? \[\]\)/.test(ctx));
  ok("and applies it to the seat it was about",
     /cam\.seatFinder\.confirm\(ans\.seat\)/.test(ctx) && /cam\.seatFinder\.reject\(ans\.seat\)/.test(ctx));
  const card = read("dashboard/src/components/ui/SamePerson.tsx");
  ok("and it is shown where the other questions are shown",
     /q\.review_type === "is_this_a_seat"/.test(card));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. Kyro asks about the chairs it cannot place.");
process.exit(fails ? 1 : 0);
