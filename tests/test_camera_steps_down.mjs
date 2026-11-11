/**
 * Asking a camera for less has to actually ask it for less.
 *
 * "huddleCamHD is not working".
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 *
 * Kyro's own message had been saying, for months:
 *
 *   "if this is a HuddleCam at 1920x1080, it may need to be asked for
 *    1280x720 instead"
 *
 * …while never once asking for it. Every step of the step-down used `ideal`,
 * which is a PREFERENCE, not a limit: the browser hands back whatever the
 * camera likes best and calls that a success. So 1920x1080, then 1280x720,
 * then 640x480 opened the same stream three times. The retry ran, the counter
 * went up, the message changed, and the camera was still being asked for
 * exactly the thing it could not do.
 *
 * `max` is a real constraint — the browser must come back at or under it, or
 * fail, and failing is fine because the next step is smaller again.
 *
 * ── And the fault was only half caught ────────────────────────────────────
 *
 * A black picture triggered the step-down. A FROZEN one — the same frame over
 * and over — only produced a complaint telling somebody to go and unplug the
 * camera. That is the commonest way a HuddleCam fails: asked for 1080p on a
 * socket that cannot carry it, it does not refuse, it just stops sending new
 * frames. Handing that to a person to fix, when the program could have asked
 * for a smaller picture, is work Kyro should have done itself.
 *
 *   node tests/test_camera_steps_down.mjs
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
const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");

// ── Run it, rather than reading it ─────────────────────────────────────────
//
// What the camera is ASKED for is the whole bug, so the constraints are
// checked by calling openCamera with a stubbed getUserMedia and looking at
// what it was handed.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-cam-"));
// cameraMode.ts imports from "@/lib/…", which only the bundler resolves, and
// none of it is needed to answer "what is the camera asked for". So the file
// is compiled on its own — tsc still emits the JavaScript while complaining
// about the imports it cannot follow — and the import lines are taken off
// the result.
try {
  execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
    path.join(root, "dashboard/src/lib/cameraMode.ts"),
    "--outDir", tmp, "--module", "esnext", "--target", "es2022",
    "--moduleResolution", "bundler", "--skipLibCheck",
  ], { stdio: "pipe" });
} catch { /* type errors from the unresolved imports; the JS is still written */ }
const built = path.join(tmp, "cameraMode.js");
if (!fs.existsSync(built)) { console.log("✗ cameraMode.ts didn't compile at all"); process.exit(1); }
fs.writeFileSync(built, fs.readFileSync(built, "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/^export \{[^}]*\} from ["'][^"']*["'];?$/gm, ""));

const asked = [];
// Node has its own read-only `navigator`, so it is replaced outright.
const media = { getUserMedia: async (c) => { asked.push(c); return { id: "stream", getTracks: () => [] }; } };
Object.defineProperty(globalThis, "navigator", { value: { mediaDevices: media }, configurable: true, writable: true });
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  configurable: true, writable: true,
});
const { openCamera, openCameraAnySize, rememberCameraStep } = await import(path.join(tmp, "cameraMode.js"));

{
  asked.length = 0;
  await openCamera("cam-1", 0);
  const v = asked[0].video;
  ok("the first ask is for the best picture the camera has",
     v.width.ideal === 1920 && v.height.ideal === 1080, JSON.stringify(v));
  ok("and it is that camera, not whichever one the browser fancies",
     v.deviceId.exact === "cam-1");
}
{
  asked.length = 0;
  await openCamera("cam-1", 1);
  const v = asked[0].video;
  ok("the second ask is a HARD CAP, not a preference",
     v.width.max === 1280 && v.height.max === 720 && v.width.ideal === undefined,
     JSON.stringify(v));
  await openCamera("cam-1", 2);
  ok("and so is the third", asked[1].video.width.max === 640 && asked[1].video.height.max === 480);
}
{
  asked.length = 0;
  await openCamera("cam-1", 3);
  ok("the last ask puts no size on it at all",
     asked[0].video.width === undefined && asked[0].video.height === undefined,
     JSON.stringify(asked[0].video));
}

// ── Stepping down, and remembering ─────────────────────────────────────────
{
  // A camera that refuses everything above 640x480 — a second camera sharing
  // a USB controller, which is exactly her setup.
  asked.length = 0;
  const fussy = async (c) => {
    asked.push(c);
    const w = c.video.width;
    if (!w || w.max <= 640) return { id: "stream", getTracks: () => [] };
    const e = new Error("too big"); e.name = "OverconstrainedError"; throw e;
  };
  media.getUserMedia = fussy;
  rememberCameraStep("fussy-cam", 0);
  await openCameraAnySize("fussy-cam");
  ok("a fussy camera is stepped down until something opens", asked.length === 3, `${asked.length} tries`);
  ok("and the size that worked is remembered",
     JSON.parse(globalThis.localStorage.getItem("kyro_camera_size"))["fussy-cam"] === 2);

  // Next time counting starts, it does not go through that again.
  asked.length = 0;
  await openCameraAnySize("fussy-cam");
  ok("so the next start asks for that size first", asked.length === 1 && asked[0].video.width.max === 640,
     `${asked.length} tries`);

  // But it is a head start, not a cage: if even that stops opening, the
  // smaller ones below it are still tried.
  asked.length = 0;
  media.getUserMedia = async (c) => {
    asked.push(c);
    if (c.video.width) { const e = new Error("no"); e.name = "OverconstrainedError"; throw e; }
    return { id: "stream", getTracks: () => [] };
  };
  await openCameraAnySize("fussy-cam");
  ok("and it keeps stepping down from there", asked.length === 2, `${asked.length} tries`);
}
{
  // Not being allowed to use cameras is not a size problem, and asking four
  // times only produces four identical refusals.
  asked.length = 0;
  media.getUserMedia = async (c) => {
    asked.push(c);
    const e = new Error("denied"); e.name = "NotAllowedError"; throw e;
  };
  let threw = null;
  try { await openCameraAnySize("blocked-cam"); } catch (e) { threw = e; }
  ok("a blocked camera is asked once, not four times", asked.length === 1, `${asked.length} tries`);
  ok("and the refusal is passed on", threw?.name === "NotAllowedError");
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── A frozen picture is fixed, not complained about ────────────────────────
{
  ok("black AND frozen both step the camera down",
     /if \(\(c\.watch\.black \|\| c\.watch\.frozen\) && c\.tries < 3\) \{/.test(ctx));
  ok("and what worked is remembered", /rememberCameraStep\(c\.deviceId, c\.tries\);/.test(ctx));
  ok("the message no longer tells somebody to go and unplug it",
     !/Unplug it and plug it back in\."\);/.test(ctx.slice(ctx.indexOf("The same picture over and over"), ctx.indexOf("The same picture over and over") + 400)));
  ok("it says what Kyro is doing about it instead",
     /Kyro is asking it for a smaller picture/.test(ctx));
  ok("and names the usual cause", /a USB socket with too little bandwidth for 1920x1080/.test(ctx));
}

// ── The note that explains why `ideal` was the bug ─────────────────────────
{
  ok("the reason is written next to the fix",
     /which is a preference and not a limit/.test(cam.replace(/\s+/g, " ")));
  ok("including that Kyro's own message had been saying it for months",
     /while never actually\s*\n?\s*\* asking for it/.test(cam) || /while never actually asking for it/.test(cam.replace(/\s+/g, " ")));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Asking for less asks for less.");
process.exit(fails ? 1 : 0);
