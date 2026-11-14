/**
 * A photograph of somebody is not somebody.
 *
 * "Kyro is still counting a picture on my phone as a person, why."
 *
 * Because there IS a person in those pixels. A detector asked "is this a
 * person" answers honestly about a photograph of a baby, and no threshold
 * will ever separate the two — a picture of somebody is exactly as
 * person-shaped as somebody.
 *
 * There was already a rule for a photograph held up in front of the lens,
 * and it needed the person HOLDING it to be in shot as a box of their own
 * with the picture inside theirs. Held at arm's length, close to the
 * camera, only a hand is in frame — nothing contains the baby, and the rule
 * could not fire.
 *
 * What IS in the frame is the phone. The model reports eighty kinds of
 * object and Kyro already reads three of those rows for the chairs. Three
 * more — television, laptop, phone — cost nothing, out of the same run on
 * the same picture. Somebody inside a screen is a picture of somebody.
 *
 *   node tests/test_a_picture_of_a_person.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-pic-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { notOnAScreen, ON_A_SCREEN, SCREEN_ROWS, decodeScreens } = await import(path.join(tmp, "peopleDetector.js"));

const kept = (people, screens) => notOnAScreen(people, screens).length;

// ── 1. The picture on her phone ───────────────────────────────────────────
{
  const phone = { box: [40, 10, 300, 330], score: 0.71 };
  const baby = { box: [78, 48, 232, 288], score: 0.58 };
  ok("1. a baby on a phone screen is not counted", kept([baby], [phone]) === 0);
  ok("1. and without reading the phone there was nothing to go on",
     kept([baby], []) === 1);
}

// ── 2. Real people near screens are still people ──────────────────────────
//
// This is the half that matters. A hall with a projector screen, a laptop
// on the sound desk, a television in the foyer — none of those may start
// swallowing the congregation.
{
  const tv = { box: [600, 200, 900, 380], score: 0.6 };
  ok("2. somebody standing in front of a television",
     kept([{ box: [620, 120, 780, 600], score: 0.8 }], [tv]) === 1);
  ok("2. somebody standing beside it",
     kept([{ box: [950, 200, 1050, 560], score: 0.8 }], [tv]) === 1);
  ok("2. somebody at their laptop",
     kept([{ box: [420, 430, 700, 760], score: 0.9 }], [{ box: [100, 500, 420, 700], score: 0.8 }]) === 1);
  ok("2. and a room with no screen in it is untouched",
     kept([{ box: [10, 10, 90, 300], score: 0.7 }, { box: [200, 10, 280, 300], score: 0.7 }], []) === 2);
}

// ── 3. …but a presenter ON the television is not in the room ──────────────
{
  const tv = { box: [600, 200, 900, 380], score: 0.6 };
  ok("3. a presenter on the screen is not counted",
     kept([{ box: [640, 230, 740, 360], score: 0.5 }], [tv]) === 0);
}

// ── 4. The screen has to be able to contain them ──────────────────────────
//
// A person box bigger than the screen it supposedly sits in is somebody
// standing in front of it, whatever the overlap says.
{
  const tiny = { box: [300, 300, 340, 360], score: 0.6 };      // a phone on a desk
  ok("4. a whole person is not swallowed by a phone across the room",
     kept([{ box: [295, 100, 345, 700], score: 0.8 }], [tiny]) === 1);
}

// ── 5. It costs no extra work ─────────────────────────────────────────────
//
// The screens come out of the SAME model output as the people. An extra AI
// run on every count, to catch a photograph, would not be worth it.
{
  const det = read("dashboard/src/lib/peopleDetector.ts");
  ok("5. screens are decoded from a result Kyro already has",
     /export function decodeScreens\(out: Float32Array/.test(det));
  ok("5. from the whole-picture look, in the same pass",
     /if \(screens && opts\.onScreens\) opts\.onScreens\(decodeScreens\(out, r, ox, oy, sx, sy\)\);/.test(det));
  ok("5. and there is no second run for them",
     (det.match(/await run\(tensor\)/g) ?? []).length <= 2, "more model runs than expected");
  ok("5. the rows are the ones that show pictures of people",
     SCREEN_ROWS.length === 3 && SCREEN_ROWS.every((r) => r > 4), SCREEN_ROWS.join(", "));
  ok("5. and decodeScreens is a real function, not a stub",
     typeof decodeScreens === "function");
}

// ── 6. It is wired into the counting, not just written ────────────────────
{
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("6. the counting asks for the screens", /\(s\) => \{ screens = s; \}\)/.test(ctx));
  ok("6. and drops the people inside them", /notOnAScreen\(notHeldBySomebody\(/.test(ctx));
  const worker = read("dashboard/src/lib/countWorker.ts");
  ok("6. the background worker sends them back too",
     /ctx\.postMessage\(\{ type: "result", id: m\.id, people, screens \}\)/.test(worker));
  const mode = read("dashboard/src/lib/cameraMode.ts");
  ok("6. and the page hands them on to whoever asked",
     /if \(m\.screens && w\?\.onScreens\) w\.onScreens\(m\.screens\)/.test(mode));
}

// ── 7. The bar is written down ────────────────────────────────────────────
{
  ok("7. how much of a person must be inside a screen",
     ON_A_SCREEN >= 0.7 && ON_A_SCREEN < 1, `${ON_A_SCREEN}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
