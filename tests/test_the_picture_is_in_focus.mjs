/**
 * A camera that has gone blurry is a camera that is missing people.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "HD Pro Webcam C920 — always loses focus."
 *
 * A webcam is built for a face at arm's length on a video call, and refocuses
 * whenever the picture changes. A hall's picture changes constantly: somebody
 * walks past the lens, a door opens, the light moves. So it hunts — and every
 * frame spent hunting is a blurred frame, which to the counting AI is a frame
 * with fewer people in it. Nobody is decided against; they were never in
 * focus to be found.
 *
 * Two halves, because neither is enough on its own:
 *
 *   HOLD IT — let the camera's own autofocus settle on the room, then lock it
 *   there. A hall does not move; a camera watching one needs to focus once.
 *
 *   NOTICE IT — plenty of cameras and browsers will not allow that. A camera
 *   quietly handing over soft pictures looks exactly like a quiet morning,
 *   which is the worst thing a fault can look like.
 *
 *   node tests/test_the_picture_is_in_focus.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-focus-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/pictureCheck.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { PictureWatch, lookAt, SHARP_SAMPLES } = await import(path.join(tmp, "pictureCheck.js"));

const W = 160, H = 120;
/**
 * A picture of a room: fine detail all over it, like chair backs, faces and
 * door frames.
 *
 * Deliberately NOT regular stripes. My first attempt used stripes four pixels
 * wide, which the sharpness check samples at exactly the wrong interval — it
 * landed on the same phase every time and read a bright room as a dark one.
 * The test was wrong and the code was right, which is the more embarrassing
 * way round.
 */
const sharp = (phase = 0) => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = (((x + phase) * 7 + y * 13) % 11) < 5 ? 210 : 55;
    const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { data: d, width: W, height: H };
};
/**
 * The same room, out of focus: the same light, the edges smeared away.
 *
 * Blurred across a wider span than the sharpness check steps, because that is
 * what being out of focus does — it is not a slight softening of neighbouring
 * pixels, it is detail gone over the whole picture.
 */
const blurred = (phase = 0) => {
  const px = sharp(phase), out = new Uint8ClampedArray(px.data);
  const R = 14;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, n = 0;
      for (let k = -R; k <= R; k++) {
        const xx = Math.max(0, Math.min(W - 1, x + k));
        sum += px.data[(y * W + xx) * 4]; n++;
      }
      const i = (y * W + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = sum / n;
    }
  }
  return { data: out, width: W, height: H };
};

// ── The measurement itself ──────────────────────────────────────────────────
{
  const a = lookAt(sharp()), b = lookAt(blurred());
  console.log(`\n  detail: sharp ${a.detail.toFixed(3)} · blurred ${b.detail.toFixed(3)}`);
  ok("a sharp picture reads as having detail in it", a.detail > 0.1, `${a.detail}`);
  ok("and a blurred one reads as having much less", b.detail < a.detail * 0.5, `${b.detail} vs ${a.detail}`);
  // The thing that makes this worth measuring at all: the two are otherwise
  // identical. Same brightness, same colours, same everything a simpler check
  // would look at.
  ok("…although they are the same brightness, which is why nothing else caught it",
     Math.abs(a.brightness - b.brightness) < 5, `${a.brightness} vs ${b.brightness}`);
}

// ── Noticing it ─────────────────────────────────────────────────────────────
{
  const w = new PictureWatch();
  // A real room is never two identical frames — people move. One flipped
  // byte is not enough to say so: the watchdog rightly calls that a frozen
  // camera, and a frozen camera is not judged for sharpness.
  for (let i = 0; i < SHARP_SAMPLES + 2; i++) w.saw(sharp(i));
  ok("a camera in focus is not complained about", !w.soft);
  w.saw(blurred(99));
  ok("and one that goes soft is", w.soft);
  // Judged against its OWN best: a dim hall on a winter evening has less
  // detail than a sunlit one, and neither is a fault.
  const dim = new PictureWatch();
  for (let i = 0; i < SHARP_SAMPLES + 2; i++) dim.saw(blurred(i));
  ok("a camera that was never sharp is not accused of losing focus", !dim.soft);
  ok("nothing is said before there is enough to say it with",
     (() => { const n = new PictureWatch(); n.saw(sharp(0)); n.saw(blurred(1)); return !n.soft; })());
  w.reset();
  ok("and reopening a camera forgets what sharp looked like", !w.soft && w.bestDetail === 0);
}

// ── Holding it ──────────────────────────────────────────────────────────────
{
  const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
  ok("Kyro asks the camera to hold its focus", /export async function holdFocus/.test(cam));
  ok("after letting its own autofocus find the room first",
     /await new Promise\(\(r\) => setTimeout\(r, FOCUS_SETTLE_MS\)\);/.test(cam)
     && /const FOCUS_SETTLE_MS = 3_000;/.test(cam));
  ok("at the distance it settled on, when the camera will say",
     /if \(typeof now\.focusDistance === "number"\) hold\.focusDistance = now\.focusDistance;/.test(cam));
  ok("and a camera that cannot do it still counts people",
     /} catch \{\s*\n\s*return "cannot";\s*\n\s*\}/.test(cam));
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("every camera that opens is asked", (ctx.match(/holdFocus\(c\.stream\)/g) ?? []).length === 3);
  ok("and counting never waits for it", /holdFocus\(c\.stream\)\.then/.test(ctx));
  ok("a soft picture is reported where faults are reported",
     /The picture has gone soft — the camera is hunting for focus/.test(ctx));
  ok("and says something different depending on whether the focus could be held",
     /c\.focus === "locked"/.test(ctx));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A blurred camera says so.");
process.exit(fails ? 1 : 0);
