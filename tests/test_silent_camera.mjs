/**
 * A camera that opens and then sends nothing.
 *
 * Kyro asks every camera for 1920x1080, because more pixels means people
 * further away are still found. Some cameras accept that, open happily, and
 * then send no picture at all — a black tile that never explained itself, and
 * then only said "unplug it". Asking again for nothing in particular is the
 * way back, and it costs the operator nothing.
 *
 *   node tests/test_silent_camera.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");

// Lift openCamera out and strip its type annotations.
const from = src.indexOf("export function openCamera");
const to = src.indexOf("const SIZES", from);
const sizes = src.slice(to, src.indexOf("\n", src.indexOf("[1920, 1080]", to)))
  .replace(": ([number, number] | null)[]", "");
const body = (src.slice(from, src.indexOf("\n}", from) + 2) + "\n" + sizes)
  .replace("export function openCamera(deviceId: string, step = 0): Promise<MediaStream>",
           "function openCamera(deviceId, step = 0)");

let asked = null;
const navigator = { mediaDevices: { getUserMedia: (c) => { asked = c; return Promise.resolve("stream"); } } };
const openCamera = new Function("navigator", `${body}; return openCamera;`)(navigator);

// 1. Normally Kyro asks for detail — that is what finds people at the back.
{
  await openCamera("cam-1");
  ok("it asks for the camera by name", asked.video.deviceId.exact === "cam-1");
  ok("and asks for high detail", asked.video.width?.ideal === 1920 && asked.video.height?.ideal === 1080);
  ok("with no microphone, ever", asked.audio === false);
}

// 2. The way back from a camera that opens and stays black: ask for less.
{
  await openCamera("cam-1", 1);
  ok("the second try is still the same camera", asked.video.deviceId.exact === "cam-1");
  ok("and asks for less", asked.video.width.ideal === 1280 && asked.video.height.ideal === 720);

  await openCamera("cam-1", 2);
  ok("the third asks for less again", asked.video.width.ideal === 640);

  await openCamera("cam-1", 3);
  ok("the last asks for no particular size", asked.video.width === undefined);
  ok("and still no microphone, ever", asked.audio === false);
}

// 3. The retry ladder in the count loop: wait, reopen plainly, then say so —
//    and only reopen once, or it would loop on a camera that is simply broken.
{
  const loop = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("it reopens asking for less", /openCamera\(c\.deviceId, c\.tries\)/.test(loop));
  ok("it stops after a few goes rather than looping", /c\.tries < 3/.test(loop) && /c\.tries\+\+;/.test(loop));
  ok("and gives up with something to try, not a shrug", /USB socket/.test(loop));
  const wait = loop.match(/NO_PICTURE_MS = ([\d_]+)/)?.[1]?.replace(/_/g, "");
  ok("it waits seconds, not minutes, before trying", Number(wait) > 0 && Number(wait) <= 10_000, `${wait} ms`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A silent camera gets asked again on its own terms.");
process.exit(fails ? 1 : 0);
