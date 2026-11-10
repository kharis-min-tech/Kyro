/**
 * A pile of blankets is not a person.
 *
 * It was counted as one: a box about three times wider than it was tall, with
 * the AI reasonably confident, on a bed. Every check Kyro had was passed,
 * because the one nobody had written was the shape of a human being.
 *
 * There was already a rule about wide boxes, and it only ever fired for a wide
 * box sitting INSIDE somebody Kyro was sure of — a lap, a bag, a table edge in
 * front of a person. A wide box on its own, with nobody near it, went
 * straight through.
 *
 *   node tests/test_not_a_person.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-shape-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { tidy } = await import(path.join(tmp, "peopleDetector.js"));

const FRAME_H = 640;
const box = (x, y, w, h) => [x, y, x + w, y + h];
const kept = (people) => tidy(people, FRAME_H).length;

// 1. The actual case: the blankets, with their real proportions and a
//    confidence high enough to have passed everything else.
{
  const blankets = { box: box(55, 140, 850, 295), score: 0.62 };     // 2.9 : 1
  ok("a pile of blankets is not a person", kept([blankets]) === 0, `kept ${kept([blankets])}`);
}

// 2. And people still are. Every shape a person's box actually takes.
{
  const standing = { box: box(100, 80, 90, 320), score: 0.55 };      // 0.3 : 1
  const sitting  = { box: box(100, 200, 120, 190), score: 0.45 };    // 0.6 : 1
  const close    = { box: box(20, 10, 300, 620), score: 0.8 };       // fills the frame
  const far      = { box: box(400, 300, 22, 60), score: 0.35 };      // small and unsure
  ok("somebody standing is counted", kept([standing]) === 1);
  ok("somebody sitting is counted", kept([sitting]) === 1);
  ok("somebody close to the camera is counted", kept([close]) === 1);
  ok("somebody far away is counted", kept([far]) === 1);
  ok("and all four together are four", kept([standing, sitting, close, far]) === 4);
}

// 3. A camera looking straight DOWN at a doorway — the mounting Kyro asks for
//    — sees people from above, where somebody with their arms out is wider
//    than they are long. That must still count.
{
  const overhead      = { box: box(200, 200, 150, 120), score: 0.6 };   // 1.25 : 1
  const armsOut       = { box: box(200, 200, 190, 130), score: 0.6 };   // 1.46 : 1
  const armsOutUnsure = { box: box(200, 200, 190, 130), score: 0.3 };
  ok("somebody seen from above is counted", kept([overhead]) === 1);
  ok("with their arms out, still counted", kept([armsOut]) === 1);
  ok("and the same shape unsure is still counted", kept([armsOutUnsure]) === 1);
}

// 4. The grey area between a person and a sofa: wide, and the AI is not sure.
//    Kyro asks for confidence there rather than guessing either way.
{
  const wideUnsure = { box: box(100, 300, 300, 160), score: 0.3 };    // 1.9 : 1
  const wideSure   = { box: box(100, 300, 300, 160), score: 0.7 };
  ok("a wide box the AI is unsure of is not counted", kept([wideUnsure]) === 0);
  ok("the same shape, confidently seen, is counted", kept([wideSure]) === 1);
}

// 5. Nothing is wide enough to be furniture AND confident enough to count.
//    This is the line that matters: no amount of confidence makes a sofa a
//    person, which is why the check runs before the confidence checks.
{
  const sofa = { box: box(40, 320, 700, 230), score: 0.95 };          // 3 : 1
  ok("a very confident sofa is still not a person", kept([sofa]) === 0);
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/peopleDetector.ts"), "utf8");
  ok("and the shape is checked before confidence",
     src.indexOf("if (ratio > WIDEST_PERSON) return false;") < src.indexOf("if (p.score >= SURE) return true;"));
}

// 6. The old rule still works: a lap or a bag inside somebody Kyro is sure of.
{
  const person = { box: box(100, 100, 160, 400), score: 0.8 };
  const lap    = { box: box(105, 300, 150, 70), score: 0.3 };         // 2.1 : 1, inside them
  ok("a lap inside a person is not a second person", kept([person, lap]) === 1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. People are person-shaped.");
process.exit(fails ? 1 : 0);
