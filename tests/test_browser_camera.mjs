/**
 * A camera plugged into this computer has to survive leaving the page.
 *
 * The camera computer can't see a camera plugged into someone's laptop, so it
 * is never in the list the server sends back. Show the server's list on its
 * own and the camera the operator just added vanishes the moment they move to
 * another page — which is exactly what it looked like from the outside.
 *
 *   node tests/test_browser_camera.mjs
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
const src = fs.readFileSync(path.join(root, "dashboard/src/lib/CameraContext.tsx"), "utf8");

// Lift the two exported helpers out of the context file — the rest of it is
// React and can't run here.
const start = src.indexOf("export function isBrowserCameraUrl");
const end = src.indexOf("function loadLocalAddedCameras");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-cams-"));
const file = path.join(tmp, "merge.ts");
fs.writeFileSync(file, "interface Camera { camera_id: string; stream_url: string }\n"
  + src.slice(start, end).replace(/\bCamera\[\]/g, "Camera[]"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"),
  [file, "--outDir", tmp, "--module", "es2022", "--target", "es2022"], { stdio: "inherit" });
const { mergeCameras, isBrowserCameraUrl } = await import(path.join(tmp, "merge.js"));

const USB  = { camera_id: "web-abc123", stream_url: "webcam://2e7e0737-huddlecam" };
const IP   = { camera_id: "cam-7",      stream_url: "rtsp://192.168.1.64:554/Streaming/Channels/101" };

// 1. The church has no camera computer, so the server has nothing to say.
//    The USB camera must still be there on every page.
{
  const r = mergeCameras([], [USB]);
  ok("a USB camera survives when the server reports nothing", r.length === 1 && r[0].camera_id === USB.camera_id);
}

// 2. With a camera computer running too, both appear — neither wipes the other.
{
  const r = mergeCameras([IP], [USB]);
  ok("the camera computer's cameras come through", r.some((c) => c.camera_id === IP.camera_id));
  ok("the USB camera is not pushed out by them", r.some((c) => c.camera_id === USB.camera_id));
  ok("nothing is counted twice", r.length === 2);
}

// 3. Navigating back and forth must not multiply it.
{
  let r = mergeCameras([], [USB]);
  r = mergeCameras([], [USB]);
  r = mergeCameras([], [USB]);
  ok("three page loads still show one camera", r.length === 1);
}

// 4. If the server ever learns about the same camera, the server wins and it
//    is not listed twice.
{
  const r = mergeCameras([{ ...USB }], [USB]);
  ok("a camera known to both sides appears once", r.length === 1);
}

// 5. Only real browser cameras are kept locally — a stray entry can't smuggle
//    an address the browser could never open into every page's list.
{
  const r = mergeCameras([], [USB, IP]);
  ok("a network address is not carried in the local list", r.length === 1 && r[0].camera_id === USB.camera_id);
  ok("webcam:// is what marks a camera as this computer's", isBrowserCameraUrl(USB.stream_url) && !isBrowserCameraUrl(IP.stream_url));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. A camera plugged into this computer stays on every page.");
process.exit(fails ? 1 : 0);
