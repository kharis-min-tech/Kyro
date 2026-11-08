/**
 * Renaming a camera has to reach Kyro, not just this browser.
 *
 * The thing being guarded against: a camera was treated as living only in this
 * browser when its id started with "web-". That looked safe — addCamera gives
 * such a camera an id like web-m3k2x-4f1a. But a camera registered by Camera
 * Mode gets "<device id>:<key>", and a Camera Mode device's id ALSO starts
 * with "web-". So every camera counting in this browser looked like one of
 * ours, and renaming it, zoning it, or marking it as facing the entrance wrote
 * to local storage and never reached Kyro. The change held until the next
 * refresh and then vanished, with no error to explain it.
 *
 *   node tests/test_rename_reaches_kyro.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "dashboard/src/lib/CameraContext.tsx"), "utf8");

// The rule, lifted from the source so the test can't drift from it.
const from = src.indexOf("function isOurs(");
const isOursSrc = src.slice(from, src.indexOf("\n}", from) + 2)
  .replace("function isOurs(cameraId: string): boolean", "function isOurs(cameraId)");
const make = (saved) => new Function("loadLocalAddedCameras", `${isOursSrc}; return isOurs;`)(() => saved);

// What addCamera() saves here, and what Camera Mode registers with Kyro.
const MINE   = { camera_id: "web-m3k2x-4f1a", stream_url: "webcam://abc" };
const THEIRS = "web-7h2k9q:web-5f2";          // <device id>:<key>, both "web-"
const BOX    = "box-1:usb-0";

// 1. The bug, stated plainly.
{
  ok("the old rule mistook a Camera Mode camera for a local one",
     THEIRS.startsWith("web-") === true);
  ok("the new rule does not", make([MINE])(THEIRS) === false);
}

// 2. A camera this browser really did save for itself still is one — otherwise
//    the fix would break the cameras the rule was written for.
{
  ok("a camera saved in this browser is still ours", make([MINE])(MINE.camera_id) === true);
}

// 3. A camera on an installed camera computer was never ours.
{
  ok("a camera computer's camera is not ours", make([MINE])(BOX) === false);
}

// 4. Nothing saved here at all: nothing is ours, so every change goes to Kyro.
{
  ok("with nothing saved locally, nothing is ours", make([])(THEIRS) === false);
  ok("not even an id shaped like one of ours", make([])(MINE.camera_id) === false);
}

// 5. The branches that decide where a change is written both use the rule.
{
  const update = src.slice(src.indexOf("const updateCamera"), src.indexOf("const addCamera"));
  const del = src.slice(src.indexOf("const deleteCamera"));
  ok("renaming asks the list", /if \(isOurs\(cameraId\)\)/.test(update));
  ok("deleting asks the list", /if \(isOurs\(cameraId\)\)/.test(del));
  ok("neither guesses from the id any more",
     !/cameraId\.startsWith\("web-"\)/.test(update) && !/cameraId\.startsWith\("web-"\)/.test(del));
}

// 6. And the change really is sent on — a rename of a Kyro-known camera must
//    reach the server call, not return early.
{
  const update = src.slice(src.indexOf("const updateCamera"), src.indexOf("const addCamera"));
  ok("a camera Kyro knows about is sent to Kyro", /edgeVenueApi\.updateCamera\(/.test(update));
  ok("with the name, zone, seats, position and direction",
     /name:/.test(update) && /zone_name:/.test(update) && /zone_capacity:/.test(update)
     && /location:/.test(update) && /inward:/.test(update));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. A rename reaches Kyro and survives a refresh.");
process.exit(fails ? 1 : 0);
