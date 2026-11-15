/**
 * "make sure this is functional" — the three-way control at the entrance:
 * Work it out · Everyone is arriving · Everyone is leaving.
 *
 * It works, and testing it found a worse bug behind it.
 *
 * ── What the control does ─────────────────────────────────────────────────
 *
 * Normally Kyro judges which way somebody walked by watching them: towards
 * a "closer" camera is coming in, away is going out. In a crowd that is
 * hard, so a person on the door can say which it is and Kyro stops
 * guessing. It wears off after half an hour — see
 * tests/test_everybody_is_leaving_wears_off.mjs.
 *
 * ── What was behind it ────────────────────────────────────────────────────
 *
 * Three people walked in and three walked out, and Kyro said one in and
 * three out. The two halves of a doorway look identical: somebody walking
 * IN finishes right in front of the lens, and the next person walking OUT
 * starts right in front of the lens. Same place, same size, a second or
 * two apart.
 *
 * The step that pairs a box to the person already there refuses that on
 * appearance — a plainly different coat is a different person. The step
 * BELOW it, which revives somebody lost for a moment by where they were,
 * did not. So the person leaving was taken for the person who had just
 * arrived, that arrival was un-tallied and re-judged from the wrong
 * starting box, and an arrival disappeared.
 *
 * It only refuses on evidence: with no appearance reading for either, the
 * place still decides, which is what that path is for.
 *
 *   node tests/test_the_entrance_setting_works.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-door-mode-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const look = (i) => ({ top: [(i * 53 % 255) / 255, (i * 97 % 255) / 255, (i * 29 % 255) / 255],
  bottom: [(i * 131 % 255) / 255, (i * 17 % 255) / 255, (i * 211 % 255) / 255],
  shape: 2.2 + (i % 7) * 0.12, height: 0.4 + (i % 5) * 0.05 });
const see = (tr, b, t, l) => tr.update(b.map((x) => ({ box: x, score: 0.9 })), t, undefined, l);
/** dir +1 walks towards the camera, growing; -1 walks away, shrinking. */
function walk(tr, who, dir, startT, withLook = true) {
  let time = startT;
  for (let f = 0; f < 7; f++) {
    const k = f / 6, sc = dir > 0 ? 0.35 + k * 0.5 : 0.85 - k * 0.5;
    const h = 400 * sc, w = h * 0.4, cy = 360 + (dir > 0 ? k * 80 : -k * 80);
    time += 1000 / 6;
    see(tr, [[640 - w / 2, cy - h / 2, 640 + w / 2, cy + h / 2]], time,
        withLook ? [look(who)] : undefined);
  }
  return time;
}
/** Three people in, then three others out, through one doorway. */
function inThenOut(mode) {
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway("closer", mode);
  let t = 1000;
  for (const p of [1, 2, 3]) { t = walk(tr, p, +1, t); t += 5000; see(tr, [], t, []); }
  for (const p of [4, 5, 6]) { t = walk(tr, p, -1, t); t += 5000; see(tr, [], t, []); }
  t += 20_000;
  see(tr, [], t, []);
  return { in: tr.entries, out: tr.exits };
}

// ── The three settings ────────────────────────────────────────────────────
{
  const judged = inThenOut(null);
  ok("Work it out: three in and three out, counted as they walked",
     judged.in === 3 && judged.out === 3, `${judged.in} in, ${judged.out} out`);

  const arriving = inThenOut("in");
  ok("Everyone is arriving: all six are arrivals",
     arriving.in === 6 && arriving.out === 0, `${arriving.in} in, ${arriving.out} out`);

  const leaving = inThenOut("out");
  ok("Everyone is leaving: all six are departures",
     leaving.in === 0 && leaving.out === 6, `${leaving.in} in, ${leaving.out} out`);
}

// ── Changing the setting does not throw the morning away ──────────────────
{
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway("closer", null);
  let t = 1000;
  for (const p of [1, 2]) { t = walk(tr, p, +1, t); t += 5000; see(tr, [], t, []); }
  t += 20_000; see(tr, [], t, []);
  const before = tr.entries;
  tr.watchesDoorway("closer", "out");            // somebody presses the button
  ok("the figures so far survive being told what is happening",
     tr.entries === before && before === 2, `${tr.entries} after ${before}`);
  // …but pointing the camera at a different doorway IS a different camera.
  tr.watchesDoorway("left", null);
  ok("and pointing it at a different doorway starts again",
     tr.entries === 0 && tr.exits === 0, `${tr.entries} / ${tr.exits}`);
}

// ── Somebody lost for a moment is still the same person ───────────────────
// The place still decides when there is no appearance to go on — which is
// the whole reason that step exists.
{
  const blink = (withLook) => {
    const tr = new PersonTracker("door", true);
    tr.watchesDoorway("closer");
    const h = 400 * 0.85, w = h * 0.4;
    let t = walk(tr, 9, +1, 1000, withLook);
    const box = [640 - w / 2, 440 - h / 2, 640 + w / 2, 440 + h / 2];
    t += 3000; see(tr, [], t, []);
    for (let f = 0; f < 4; f++) { t += 166; see(tr, [box], t, withLook ? [look(9)] : undefined); }
    t += 20_000; see(tr, [], t, []);
    return tr.people;
  };
  ok("lost and found again, with a coat to go on, is one person", blink(true) === 1, `${blink(true)}`);
  ok("…and with nothing to go on, still one person", blink(false) === 1, `${blink(false)}`);
}

// ── The refusal is written where it is used ───────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  const revive = src.slice(src.indexOf("        let best = RETURN_WITHIN_WIDTHS;"));
  ok("reviving by place refuses somebody plainly else",
     /if \(t\.look && myLookHere && alikeLook\(t\.look, myLookHere\) < PLAINLY_SOMEBODY_ELSE\) return;/
       .test(revive.slice(0, 2600)));
  ok("…and only when there is something to judge on",
     /t\.look && myLookHere &&/.test(revive.slice(0, 2600)));
  ok("both steps use the same bar",
     (src.match(/< PLAINLY_SOMEBODY_ELSE\) return;/g) || []).length === 2,
     `${(src.match(/< PLAINLY_SOMEBODY_ELSE\) return;/g) || []).length} of 2`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The entrance setting does what it says.");
process.exit(fails ? 1 : 0);
