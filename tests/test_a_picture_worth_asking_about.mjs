/**
 * "this is not even a person, well what you are showing me"
 *
 * A question asking whether two people were the same. On the right, a
 * perfectly clear picture of somebody in a white top standing in a
 * doorway. On the left, a near-black frame with a dark shape filling it
 * and some ceiling lights at the top — no face, no outline, nothing
 * anybody could answer from.
 *
 * Kyro kept ONE picture per person and replaced it every eight seconds
 * with whatever the latest one happened to be. Somebody is in shot for
 * minutes, so there are dozens of pictures of them, and the one shown was
 * chosen for no better reason than being the most recent — which during
 * worship with the lights down is as likely as not to be the worst.
 *
 * Two changes, and only one of them needs a number:
 *
 *   · keep the CLEAREST picture rather than the latest. No threshold: the
 *     better score wins, so it can only improve what is shown. The clock
 *     still has a say, so a question shows the person as they are now.
 *   · refuse to ask at all when even the clearest is a black rectangle.
 *     Drawn at the indefensible end on purpose — a dim hall during worship
 *     is still worth asking about, and Kyro has been silent enough.
 *
 *   node tests/test_a_picture_worth_asking_about.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-clarity-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/pictureClarity.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { clarity, worthAskingAbout, MOSTLY_BLACK } = await import(path.join(tmp, "pictureClarity.js"));

const W = 60, H = 100;
/** Build a picture: paint(x, y) returns [r,g,b]. */
function picture(paint) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = paint(x, y);
      const at = (y * W + x) * 4;
      d[at] = r; d[at + 1] = g; d[at + 2] = b; d[at + 3] = 255;
    }
  }
  return d;
}
const judge = (d) => clarity(d, W, H);

// ── The two pictures she was shown ────────────────────────────────────────
// Left: almost entirely black, with a strip of ceiling lights across the
// top eighth. Bright pixels exist, so "is anything bright in it" would have
// passed this — which is why the measure asks how much of it is lit.
const theBlackOne = picture((x, y) =>
  y < H / 8 && (x % 11) < 4 ? [210, 215, 235] : [10, 10, 14]);
// Right: a lit doorway. A white top, a dark skirt, a pale doorframe.
const theClearOne = picture((x, y) =>
  x < W / 6 ? [150, 170, 195]
  : y < H / 2 ? [225, 228, 235]
  : [45, 48, 70]);

{
  const black = judge(theBlackOne), clear = judge(theClearOne);
  ok("the near-black one is measured as mostly unlit",
     black.lit < 1 - MOSTLY_BLACK, `lit ${black.lit.toFixed(2)}`);
  ok("and is not asked about", !worthAskingAbout(black));
  ok("the clear one is lit", clear.lit > 0.9, `lit ${clear.lit.toFixed(2)}`);
  ok("and IS asked about", worthAskingAbout(clear));
  ok("the clear one scores higher, so it would be the one kept",
     clear.score > black.score, `${clear.score.toFixed(3)} vs ${black.score.toFixed(3)}`);
  ok("a few bright lamps do not make a black picture look full of detail",
     black.contrast < clear.contrast || black.lit < clear.lit,
     `black contrast ${black.contrast.toFixed(2)}, clear ${clear.contrast.toFixed(2)}`);
}

// ── A dim hall during worship is still worth asking about ─────────────────
// This is the case the threshold must NOT catch. The lights are down, but
// you can see people: everything is dim rather than black.
{
  const worship = picture((x, y) =>
    y < H / 2 ? [58, 54, 86] : [38, 40, 58]);
  const c = judge(worship);
  ok("a dim hall is still asked about", worthAskingAbout(c), `lit ${c.lit.toFixed(2)}`);
}
// …and somebody in dark clothing, lit normally. A black coat is not a black
// picture, and this is the mistake that would silence the questions.
{
  const darkCoat = picture((x, y) =>
    x > W / 3 && x < (W * 2) / 3 && y > H / 4 ? [26, 24, 30]   // the coat
    : [120, 125, 140]);                                         // the room
  ok("somebody in a black coat in a lit room is asked about",
     worthAskingAbout(judge(darkCoat)));
}

// ── A flat picture has nothing to compare either ──────────────────────────
{
  const wall = picture(() => [128, 128, 128]);
  const c = judge(wall);
  ok("a flat grey wall is lit but scores nothing", c.lit === 1 && c.score < 0.02,
     `score ${c.score.toFixed(3)}`);
  const lensCap = picture(() => [4, 4, 4]);
  ok("a lens cap is not asked about", !worthAskingAbout(judge(lensCap)));
}

// ── Measuring the same picture twice gives the same answer ────────────────
{
  const a = judge(theClearOne), b = judge(theClearOne);
  ok("the measure is steady", a.score === b.score);
  ok("an empty picture is handled rather than thrown",
     clarity(new Uint8ClampedArray(0), 0, 0).score === 0);
  ok("and something it cannot measure is never blocked",
     worthAskingAbout(null) === true);
}

// ── It is wired in where the pictures are chosen and sent ─────────────────
{
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("the clearest picture is the one kept",
     /const score = clarityOf\(crop\)\?\.score \?\? 0;/.test(ctx)
     && /if \(stale \|\| score > had\.score\) c\.crops\.set\(x\.track, \{ at: now, crop, score \}\);/.test(ctx));
  ok("…but never one older than a minute",
     /const stale = !had \|\| now - had\.at > BEST_PICTURE_WITHIN_MS;/.test(ctx)
     && /const BEST_PICTURE_WITHIN_MS = 60_000;/.test(ctx));
  ok("every picture sent for a question is checked first",
     (ctx.match(/worthAskingAbout\(clarityOf\(/g) || []).length === 3,
     `${(ctx.match(/worthAskingAbout\(clarityOf\(/g) || []).length} of 3 places`);
  ok("and a refused picture leaves the question waiting, not answered",
     /if \(!worthAskingAbout\(clarityOf\(kept\.crop\)\)\) continue;/.test(ctx));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Nothing in the picture, nothing asked.");
process.exit(fails ? 1 : 0);
