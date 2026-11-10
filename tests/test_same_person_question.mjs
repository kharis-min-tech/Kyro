/**
 * "Is this the same person?" — Kyro asks, and the answer changes the figure.
 *
 * Asked for in so many words: "uno the system can rather ask me questions
 * like is this the same person? and screenshot them just for the AI count to
 * be more trained and for it to not double count and eventually the system
 * will be more trained enough to know".
 *
 * Kyro already knew when it was guessing. A coat that matched well but not
 * clearly; a new entry made while somebody on file looked almost the same; a
 * hall where everyone is dressed alike and clothes say nothing. Each of those
 * was a coin toss that quietly became a number on a screen, and the only
 * trace was a counter called "uncertain".
 *
 * What this guards:
 *
 *   - the guess is still made, so the live figure never stalls waiting;
 *   - the question carries TWO pictures, because two names and a score is not
 *     something anybody can answer;
 *   - the answer corrects the register there and then — two entries become
 *     one, or one becomes two, and attendance moves with it;
 *   - the pictures are deleted the moment it is answered;
 *   - and what is learned is said honestly. Nothing retrains the model that
 *     finds people or reads faces. What a few dozen labelled answers CAN set,
 *     and set properly, is the line between "same person" and "two people" in
 *     this building, in this light, with these coats.
 *
 *   node tests/test_same_person_question.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry, LOOK_ASK, LOOK_SAME } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SamePerson.tsx"), "utf8");

const look = (n, { h = 0.5 } = {}) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), h];
};
const reg = () => new IdentityRegistry({ zoneOf: () => "room" });
const see = (r, obs, at) => r.observe("cam", obs, at);

// ── Kyro asks, and does not wait ───────────────────────────────────────────
{
  const r = reg();
  let t = 1_000;
  // Somebody settles in.
  for (let i = 0; i < 8; i++) see(r, [{ track: 1, look: look(1), face: null }], (t += 5_000));
  ok("one person is one person", r.size === 1, `${r.size}`);
  ok("and nothing has been asked about, because nothing was a guess",
     r.asks.length === 0, `${r.asks.length}`);

  // Somebody else arrives who looks quite like them, but not enough to be
  // sure either way — the overlap where no threshold can help.
  t += 120_000;
  for (let i = 0; i < 8; i++) see(r, [{ track: 2, look: look(1, { h: 0.33 }), face: null }], (t += 5_000));
  ok("Kyro still decides, so the figure keeps going", r.size >= 1);
  const asks = r.takeAsks();
  ok("but it asks about what it guessed", asks.length === 1, `${asks.length}`);
  ok("saying which way it guessed", ["same", "different"].includes(asks[0].guess));
  ok("how alike they actually looked", typeof asks[0].score === "number" && asks[0].score >= LOOK_ASK);
  ok("whether a face was involved", asks[0].had_face === false);
  ok("and which sighting and which person to correct",
     asks[0].camera === "cam" && asks[0].track === 2 && typeof asks[0].person === "number");
  ok("taking them away empties the list, so nothing is asked twice", r.asks.length === 0);
}

// ── The answer changes the figure ──────────────────────────────────────────
{
  // Guessed "different" — two entries — and they were the same person.
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 8; i++) see(r, [{ track: 1, look: look(1), face: null }], (t += 5_000));
  t += 120_000;
  for (let i = 0; i < 8; i++) see(r, [{ track: 2, look: look(1, { h: 0.33 }), face: null }], (t += 5_000));
  const ask = r.takeAsks()[0];
  const before = r.size;
  if (ask.guess === "different") {
    const res = r.answerAsk(ask, true, t);
    ok("'same person' folds the extra entry back in", res.action === "merged", JSON.stringify(res));
    ok("so attendance goes down by one", r.size === before - 1, `${before} → ${r.size}`);
    ok("and the earlier arrival time is the one kept",
       [...r.people.values()][0].firstAt <= 6_000);
  } else {
    const res = r.answerAsk(ask, false, t);
    ok("'different people' pulls the sighting off and gives it its own entry", res.action === "split");
    ok("so attendance goes up by one", r.size === before + 1, `${before} → ${r.size}`);
  }
}
{
  // And the other way: agreeing changes nothing at all.
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 8; i++) see(r, [{ track: 1, look: look(1), face: null }], (t += 5_000));
  t += 120_000;
  for (let i = 0; i < 8; i++) see(r, [{ track: 2, look: look(1, { h: 0.33 }), face: null }], (t += 5_000));
  const ask = r.takeAsks()[0];
  const before = r.size;
  const res = r.answerAsk(ask, ask.guess === "same", t);
  ok("agreeing with Kyro changes nothing", res.agreed === true && res.changed === false);
  ok("and the figure stands", r.size === before);
  // …and the same pair is never asked about again this service.
  for (let i = 0; i < 8; i++) see(r, [{ track: 2, look: look(1, { h: 0.33 }), face: null }], (t += 5_000));
  ok("a settled pair is never asked about twice", r.asks.length === 0, `${r.asks.length}`);
}

// ── Merging and splitting keep the register whole ──────────────────────────
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 8; i++) {
    see(r, [{ track: 1, look: look(1), face: null, seat: "A1" },
            { track: 2, look: look(40), face: null, seat: "A2" }], (t += 5_000));
  }
  ok("two people, two seats", r.size === 2 && r.seats.size === 2);
  const [a, b] = [...r.people.keys()];
  r.mergeInto(a, b);
  ok("merging leaves one person", r.size === 1);
  ok("and no seat still points at somebody who no longer exists",
     [...r.seats.values()].every((id) => r.people.has(id)));
  ok("and no track does either",
     [...r.byTrack.values()].every((v) => r.people.has(v.id)));
  // Splitting a track off gives it a fresh identity, and the track follows it.
  const made = r.splitTrack("cam", 2, t);
  ok("splitting makes a new entry", made !== null && r.size === 2);
  ok("and the track now points at it", r.idOfTrack("cam", 2) === made);
  ok("while the other keeps everything that was really theirs",
     [...r.people.values()].every((p) => p.looks.length > 0));
}

// ── Two pictures, or no question ───────────────────────────────────────────
{
  ok("the website turns the register's guesses into questions", /async makeAsks\(cams, now\) \{/.test(worker));
  ok("of their own kind", /"same_person_question"/.test(worker) && /QUESTION_TYPES = \[[^\]]*"same_person_question", "is_this_a_person"\]/.test(worker));
  ok("it asks the counting browser for a picture of each side",
     /wanted\.push\(\{ id, side: "a", camera_id: a\.camera, track: a\.track \}\);/.test(worker)
     && /wanted\.push\(\{ id, side: "b", camera_id: a\.other_camera, track: a\.other_track \}\);/.test(worker));
  ok("and keeps asking for a while, because somebody may have looked away",
     /const ASK_PICTURE_WAIT_MS = 60_000;/.test(worker));
  ok("a question without both pictures is never shown",
     /q\.review_type !== "same_person_question" \|\| \(q\.pictures \?\? 0\) >= 2/.test(worker));
  ok("there is a limit on how many are waiting at once", /const MOST_ASKS = 12;/.test(worker));

  ok("the browser sends a crop of that one person", /export async function sendPersonPicture\(/.test(cam));
  ok("cropped round them with a little room, and small",
     /const pad = Math\.max\(8, \(x2 - x1\) \* 0\.25\);/.test(cam) && /Math\.min\(1, 320 \/ sw\)/.test(cam));
  ok("it only sends one when that person is still in shot",
     /const who = here\.find\(\(x\) => x\.track === want\.track\);/.test(ctx)
     && /if \(!who\) continue;      \/\/ looked away; the website asks again/.test(ctx));
  // A routine report carries numbers and nothing else. A crop only ever
  // leaves the computer because somebody is being asked to look at it, so it
  // is sent well away from the report-building code — which has its own
  // guard, in tests/test_appearance.mjs, that reads that code for any
  // mention of a picture.
  ok("and it is sent nowhere near the report that carries only numbers",
     ctx.indexOf("sendPersonPicture(want.id") < ctx.indexOf("const reports: CameraReport[]"));
  ok("and a request isn't dropped just because the next reply left it out",
     /if \(!wantPics\.current\.some\(\(x\) => x\.id === w\.id && x\.side === w\.side\)\) wantPics\.current\.push\(w\);/.test(ctx));
}

// ── Answering it corrects the register, and tidies the pictures away ───────
{
  ok("the answer goes to the register, not back to a camera",
     /if \(q\.review_type === "same_person_question"\) \{/.test(worker)
     && /result = this\.register\.answerAsk\(q\.ask, said\);/.test(worker));
  ok("the corrected register is saved, so a restart keeps the correction",
     /await this\.ctx\.storage\.put\("register", this\.register\.snapshot\(SAFE_VALUE_BYTES\)\);/.test(worker));
  ok("both pictures are deleted the moment it is answered",
     /await this\.ctx\.storage\.delete\(`qsnap:\$\{id\}:a`\);/.test(worker)
     && /await this\.ctx\.storage\.delete\(`qsnap:\$\{id\}:b`\);/.test(worker));
  ok("and the page is told what actually changed", /return json\(\{ ok: true, \.\.\.\(result \?\? \{\}\) \}\);/.test(worker));
}

// ── What is learned, said honestly ─────────────────────────────────────────
{
  ok("an answer is kept as a score and a yes-or-no, nothing else",
     /score: q\.score, face: !!q\.had_face, same: !!same,/.test(worker));
  ok("the honest limit is written down where it is implemented",
     /It is not retraining the AI/.test(worker));
  ok("the best line is worked out from the answers themselves",
     /const n = scored\.filter\(\(a\) => \(a\.score >= c\) === a\.same\)\.length;/.test(worker));
  ok("and only acted on once there are enough of them",
     /const ANSWERS_BEFORE_LEARNING = 25;/.test(worker)
     && /if \(l\.examples < ANSWERS_BEFORE_LEARNING \|\| l\.suggested === null\) return null;/.test(worker));
  ok("and only if it would really do better",
     /if \(rightAt\(better\) <= rightAt\(now\)\) return null;/.test(worker));
  ok("moved a step at a time, never a jump",
     /Math\.sign\(better - now\) \* 0\.01/.test(worker));
  ok("every move is written down so it can be seen and undone",
     /await this\.ctx\.storage\.put\("look_same_log", hist\.slice\(0, 50\)\);/.test(worker));

  // The register has to be able to carry a different line at all.
  const r = new IdentityRegistry({ zoneOf: () => "room" });
  ok("the measured line is the starting point", r.lookSame === LOOK_SAME);
  ok("and a venue can carry its own",
     new IdentityRegistry({ zoneOf: () => "room", lookSame: 0.91 }).lookSame === 0.91);
  ok("the website gives it the one this church has earned",
     /lookSame: \(await this\.get\("look_same", null\)\)\?\.value \?\? LOOK_SAME,/.test(worker));
}

// ── The panel ──────────────────────────────────────────────────────────────
{
  ok("it shows both pictures", /<Side id=\{q\.review_id\} side="a"/.test(panel) && /side="b"/.test(panel));
  ok("with three honest answers", /Same person/.test(panel) && /Different people/.test(panel) && /Can&apos;t tell/.test(panel));
  ok("it says what Kyro thought, and why", /Kyro counted them as/.test(panel) && /\{q\.why \? `, \$\{q\.why\}` : ""\}/.test(panel));
  ok("it says when no face was readable", /No face was readable, so only their clothes and build were compared/.test(panel));
  ok("answering reports what changed, not 'thanks'",
     /different people this service/.test(panel) && /Kyro had that right already/.test(panel));
  ok("it says plainly what is kept and what is deleted",
     /Both pictures are deleted the moment you answer/.test(panel)
     && /no photograph, no face code, no name/.test(panel));
  ok("and it shows nothing at all when there is nothing to show",
     /if \(!asks\.length && !\(learn && learn\.answered > 0\)\) return null;/.test(panel));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Kyro asks, and the answer moves the figure.");
process.exit(fails ? 1 : 0);
