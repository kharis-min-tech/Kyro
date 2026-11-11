/**
 * A packed room is full of people, and all of them count.
 *
 * ── What happened ───────────────────────────────────────────────────────────
 *
 * A photograph of a crowded hall — the nearest man filling half the frame,
 * everybody else behind and beside him, half hidden — with hardly a green box
 * on it. "these people are not being counted."
 *
 * Two rules were throwing them away, and both were written for a nearly empty
 * room where the one thing near the camera is a person Kyro can see plainly:
 *
 *  1. tidy() dropped any BIG box the model was only half sure of, on the
 *     reasoning that "people near the camera are clearly visible, so the AI is
 *     sure of them; an unsure big box is a part of someone". A part of someone
 *     presupposes a someone, and the rule never checked there was one. In a
 *     packed room everybody is near the camera, so every box is big, and
 *     everybody is half behind somebody else, so the model is modest about
 *     every one of them.
 *
 *  2. notHeldBySomebody() dropped anything much smaller lying inside a bigger
 *     outline — written for a photograph on a phone held up to the lens. But
 *     somebody standing BEHIND somebody else is also much smaller (further
 *     away) and also inside their outline (that is what "behind" means).
 *
 * Both now ask the question that separates the cases, and neither asks it of
 * the count: an unsure big box has to be explained by somebody Kyro is sure
 * of, and something held has to be held in front of a chest rather than
 * appearing over a shoulder.
 *
 *   node tests/test_a_packed_room.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-packed-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { tidy, notHeldBySomebody, looksLikeAPerson, HELD_BELOW_HEAD } =
  await import(path.join(tmp, "peopleDetector.js"));

const W = 356, H = 512;                          // the shape of her photograph
const box = (x, y, w, h) => [x, y, x + w, y + h];
/** Everything Kyro runs over the model's answer, in the order it runs them. */
const counted = (list) => looksLikeAPerson(notHeldBySomebody(tidy(list, H)), H, 0.3);

// ── The frame she sent ──────────────────────────────────────────────────────
{
  const crowd = [
    { box: box(18,  40, 195, 470), score: 0.86 },   // the man in the suit, back to camera
    { box: box(165, 175, 120, 330), score: 0.44 },  // the woman in white beside him
    { box: box(300, 190,  56, 290), score: 0.38 },  // a man at the right edge
    { box: box(268, 250,  60, 150), score: 0.33 },  // head and shoulders behind her
    { box: box(0,   250,  40, 240), score: 0.31 },  // somebody at the left edge
    { box: box(230, 215,  42, 120), score: 0.36 },  // another head, over her shoulder
  ];
  const kept = counted(crowd);
  console.log(`\n  A packed room: the model found ${crowd.length}, Kyro counts ${kept.length}`);
  ok("everybody in a packed room is counted", kept.length === crowd.length,
     `counted ${kept.length} of ${crowd.length}`);
  ok("including the ones the model is least sure of",
     kept.some((p) => p.score < 0.35), `lowest kept: ${Math.min(...kept.map((p) => p.score))}`);
}

// ── …without letting back in what those rules were built to stop ────────────
{
  // A photograph of two people on a phone, held at chest height. Her box runs
  // from her head at 100 to her feet at 600; the phone is at 280 — a third of
  // the way down. That is an arm's length, and nothing standing behind her
  // could appear there.
  const her = { box: box(300, 100, 200, 500), score: 0.8 };
  const onScreen = [
    { box: box(360, 280, 40, 70), score: 0.8 },
    { box: box(410, 280, 40, 70), score: 0.8 },
  ];
  ok("a picture of people held up is still not people",
     notHeldBySomebody([her, ...onScreen]).length === 1,
     `${notHeldBySomebody([her, ...onScreen]).length}`);
  // The same two faces, but at the top of her outline: that is two people
  // standing behind her, and they count.
  const behind = [
    { box: box(360, 110, 40, 70), score: 0.8 },
    { box: box(410, 115, 40, 70), score: 0.8 },
  ];
  ok("two heads over her shoulder are two people",
     notHeldBySomebody([her, ...behind]).length === 3,
     `${notHeldBySomebody([her, ...behind]).length}`);
  ok("and the line between them is an arm's length, written down",
     HELD_BELOW_HEAD > 0 && HELD_BELOW_HEAD < 0.5, `${HELD_BELOW_HEAD}`);
}

{
  // tidy()'s own case, still working: a big unsure box that IS a part of
  // somebody — an arm or a shoulder inside a person Kyro is sure of.
  const person = { box: box(100, 60, 160, 420), score: 0.85 };
  const armOfThem = { box: box(120, 100, 90, 300), score: 0.3 };
  ok("an arm inside somebody is not a second person",
     tidy([person, armOfThem], H).length === 1, `${tidy([person, armOfThem], H).length}`);
  // …and the same box with nobody to be a part of is a person half hidden.
  ok("the same box with nobody near it is somebody half hidden",
     tidy([armOfThem], H).length === 1, `${tidy([armOfThem], H).length}`);
  // The shape rules are untouched: no crowd makes a sofa a person.
  const sofa = { box: box(40, 320, 300, 100), score: 0.95 };
  ok("a sofa in a crowded room is still a sofa",
     tidy([person, sofa], H).length === 1, `${tidy([person, sofa], H).length}`);
}

// ── Said where it is decided ────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/peopleDetector.ts"), "utf8");
  ok("a big unsure box has to be explained by somebody Kyro is sure of",
     /if \(y2 - y1 > bigHeight \* frameH && p\.score < bigMinScore\s*\n\s*&& sure\.some\(/.test(src));
  ok("and something held has to be held below the head",
     /&& p\.box\[1\] - other\.box\[1\] > HELD_BELOW_HEAD \* \(other\.box\[3\] - other\.box\[1\]\)\)\);/.test(src));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A room full of people is a room full of people.");
process.exit(fails ? 1 : 0);
