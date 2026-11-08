/**
 * One counter, not two.
 *
 * The thing being guarded against: the tiles on Live and Attendance ran their
 * own detector (TensorFlow COCO-SSD, fetched from Google at page load) while
 * the real engine — YOLO11, shipped with the site — was counting the same
 * room. The same picture was labelled 14 in one corner and 5 in the other, and
 * the tile's weaker figure was the one written to the key the attendance
 * headline and the webhook payload read.
 *
 *   node tests/test_tile_count.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-tile-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/tileCount.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { tileCount, matchView } = await import(path.join(tmp, "tileCount.js"));

const view = (over = {}) => ({
  key: "k1", label: "HD Pro Webcam C920 (046d:08e5)", count: 14,
  streaming: true, error: null, countedAt: 1_000, ...over,
});

// 1. Counting: the engine's number, and nobody else's.
{
  const r = tileCount("running", [view()], "HD Pro Webcam C920 (046d:08e5)");
  ok("the tile shows the engine's figure", r.count === 14 && r.state === "counting");
  ok("it names the engine's camera so the picture can be shared", r.key === "k1");
  ok("no message competes with the number", r.message === null);
}

// 2. Counting switched off — say so, don't sit on "Loading detector…".
{
  const r = tileCount("idle", [], "HD Pro Webcam C920 (046d:08e5)");
  ok("counting switched off is stated plainly", r.state === "off" && /Cameras page/.test(r.message));
  ok("and no number is invented", r.count === null);
}

// 3. No engine on the page at all.
{
  const r = tileCount(null, [], "anything");
  ok("no engine means no number", r.count === null && r.state === "off");
}

// 4. A camera the engine isn't counting must not borrow another's figure.
{
  const r = tileCount("running", [view()], "HuddleCamHD (2e7e:0737)");
  ok("a second camera doesn't inherit the first one's count",
     r.count === null && r.state === "off", `got ${JSON.stringify(r)}`);
}

// 5. Both cameras counting — each tile gets its own.
{
  const cams = [view(), view({ key: "k2", label: "HuddleCamHD (2e7e:0737)", count: 3 })];
  ok("the C920 tile gets 14", tileCount("running", cams, "HD Pro Webcam C920 (046d:08e5)").count === 14);
  ok("the HuddleCam tile gets 3", tileCount("running", cams, "HuddleCamHD (2e7e:0737)").count === 3);
}

// 6. Open but nothing counted yet — "Counting…", never a zero that looks real.
{
  const r = tileCount("running", [view({ countedAt: 0 })], "HD Pro Webcam C920 (046d:08e5)");
  ok("an uncounted camera shows no figure", r.count === null && r.state === "starting");
}

// 7. A camera with a fault reports the fault.
{
  const r = tileCount("running", [view({ error: "Another program is using this camera" })], "HD Pro Webcam C920 (046d:08e5)");
  ok("a camera fault is passed through", r.state === "problem" && /Another program/.test(r.message));
  ok("and no number is shown beside it", r.count === null);
}

// 8. A camera that stopped streaming isn't reported as a live count.
{
  const r = tileCount("running", [view({ streaming: false })], "HD Pro Webcam C920 (046d:08e5)");
  ok("a closed camera shows no count", r.count === null && r.state === "problem");
}

// 9. Matching: one camera counting and one tile asking is unambiguous.
{
  ok("a name that matches nothing is not forced onto the only camera",
     matchView([view()], "a camera the engine isn't counting") === null);
  ok("a camera the engine couldn't name is matched when it's the only one",
     matchView([view({ label: "" })], "HuddleCamHD (2e7e:0737)")?.key === "k1");
  ok("with no name at all the only camera is used", matchView([view()], undefined)?.key === "k1");
  ok("two cameras and no name is never guessed", matchView([view(), view({ key: "k2", label: "Other" })], undefined) === null);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. One engine, one number per camera.");
process.exit(fails ? 1 : 0);
