/**
 * Unplug it and the picture goes. At once.
 *
 * "the image should be gone immediately, straight after i have unplugged
 * it, why is it still there frozen."
 *
 * Because a camera that has been unplugged goes on REPORTING. The computer
 * it was plugged into is still there and still sending every two seconds,
 * and what it sends says plainly that this camera has no picture. Three
 * separate things read "is it reporting" instead of "has it got a picture",
 * and each one on its own was enough to leave a frozen room on the screen:
 *
 *   · the server went on handing out the last still it had been sent;
 *   · the tile asked is_running rather than is_counting;
 *   · and the hook that fetches the picture, once switched off, simply
 *     returned — leaving the last one it had on screen for ever.
 *
 * A picture is the most convincing thing on a screen and a label cannot
 * argue with it. That is written in the server, three lines above the test
 * that was only half doing it.
 *
 *   node tests/test_an_unplugged_camera_shows_nothing.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-unplug-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

/** A hub holding one still picture and one live record. */
function hub(live) {
  const store = new Map([
    ["snap:box:cam", { at: Date.now(), data: new Uint8Array([1, 2, 3]) }],
    ["live", { "box:cam": live }],
  ]);
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } } };
  return h;
}
const now = Date.now();
const served = async (live) => {
  const res = await hub(live).getSnapshot("box:cam");
  return res.status === 200;
};

// ── 1. The server stops handing out the picture ───────────────────────────
{
  ok("1. a camera that is working has its picture served",
     await served({ updated_at: now, status: "online" }));
  // Unplugged: still reporting, saying it has no picture.
  ok("1. one that has just been unplugged does not",
     !(await served({ updated_at: now, status: "error", no_picture: true })));
  // …and the old test still holds.
  ok("1. nor does one that has stopped reporting at all",
     !(await served({ updated_at: now - 10 * 60_000, status: "online" })));
  // A camera with an error that CAN still see is not silenced — it has a
  // picture, and the reason belongs beside it.
  ok("1. but one with a problem that can still see is left alone",
     await served({ updated_at: now, status: "error", no_picture: false }));
}

// ── 2. The tile asks the right question ───────────────────────────────────
{
  const page = read("dashboard/src/app/live-cameras/page.tsx");
  ok("2. it asks whether the camera has a picture",
     /const running = !cameraId \|\| !!zonesHere\?\.\[cameraId\]\?\.is_counting;/.test(page));
  const worker = read("worker/venue.js");
  ok("2. and that is reporting AND producing a picture",
     /const counting = running && !\(l\.status === "error" && l\.no_picture\);/.test(worker));
}

// ── 3. Switched off means no picture, not the last one for ever ───────────
{
  const hook = read("dashboard/src/lib/edgeVenue.ts");
  ok("3. the picture is let go when it stops being watched",
     /if \(!enabled \|\| !cameraId\) \{[\s\S]{0,200}setUrl\(null\);/.test(hook));
  ok("3. and the blob is released, not just forgotten",
     /if \(current\.current\) \{ URL\.revokeObjectURL\(current\.current\); current\.current = null; \}[\s\S]{0,80}setUrl\(null\);\s*\n\s*return;/.test(hook));
}

// ── 4. The camera says so within a couple of seconds ──────────────────────
//
// None of the above helps if the computer never admits the camera is gone.
{
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("4. an unplugged camera is reported with no picture",
     /status: "error", error: c\.error \?\? "This camera isn't open yet",[\s\S]{0,120}no_picture: true/.test(ctx));
  ok("4. and its stream is let go the moment the track ends",
     /addEventListener\("ended", \(\) => \{ c\.stream = null;/.test(ctx));
  const worker = read("worker/venue.js");
  ok("4. reports are two seconds apart", /report_every_s: 2/.test(worker));
}

// ── 5. Every page asks the same question ─────────────────────────────────
//
// Found by sweeping for the shape rather than by being told: the Live
// badge on the attendance page and the Live / Offline badge on the seating
// page both read is_running, so both said LIVE — one of them over a people
// count — for a camera that had been unplugged.
{
  const att = read("dashboard/src/app/attendance/page.tsx");
  ok("5. the attendance tile's LIVE badge means working",
     /const live = !!z\?\.is_counting \|\| !!isBrowserCam;/.test(att));
  const seat = read("dashboard/src/app/seating/page.tsx");
  ok("5. and so does the seating page's",
     /const edgeRunning = edge \? !!edgeZone\?\.is_counting : undefined;/.test(seat));
  // Where "is it being counted at all, by anybody" is the question,
  // is_running is still the right one — a camera counted on another
  // computer is running, whatever this device can see of it.
  const page = read("dashboard/src/app/live-cameras/page.tsx");
  ok("5. …while \"counted somewhere else\" still asks whether it is running",
     /const countedElsewhere = !!\(cameraId && zonesHere\?\.\[cameraId\]\?\.is_running\);/.test(page));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
