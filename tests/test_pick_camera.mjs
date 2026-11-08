/**
 * Finding the camera a saved record means.
 *
 * The thing being guarded against: a camera plugged into this computer is
 * stored as webcam://<deviceId>, and that identifier is not dependable — the
 * browser withholds it until access is granted, scrambles it per website, and
 * Safari changes it between sessions. The tile took it or gave up, and
 * reported giving up as "needs HTTPS and MediaDevices" — so a camera that was
 * plugged in, open and counting 13 people showed a message about the website
 * being insecure.
 *
 *   node tests/test_pick_camera.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-pick-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/pickCamera.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { pickCamera, deviceIdFrom } = await import(path.join(tmp, "pickCamera.js"));

const HUDDLE  = { deviceId: "a1b2c3", label: "HuddleCamHD (2e7e:0737)" };
const BUILTIN = { deviceId: "zz9",    label: "FaceTime HD Camera" };

// 1. Normal case — the identifier still matches.
{
  const r = pickCamera("webcam://a1b2c3", "HuddleCamHD (2e7e:0737)", [BUILTIN, HUDDLE]);
  ok("a good identifier is used as it is", r.deviceId === "a1b2c3" && r.how === "id");
}

// 2. Her case: saved with no identifier at all. The name still finds it, and
//    it must NOT settle for the built-in webcam sitting next to it.
{
  const r = pickCamera("webcam://", "HuddleCamHD (2e7e:0737)", [BUILTIN, HUDDLE]);
  ok("an empty identifier doesn't stop it being found", r.deviceId === "a1b2c3", `got ${r.deviceId}`);
  ok("it was the name that found it", r.how === "name");
  ok("the built-in webcam is not grabbed by mistake", r.deviceId !== BUILTIN.deviceId);
}

// 3. The identifier has changed since it was saved — Safari, a new session,
//    a different USB socket.
{
  const moved = { deviceId: "NEW-after-replug", label: "HuddleCamHD (2e7e:0737)" };
  const r = pickCamera("webcam://a1b2c3", "HuddleCamHD (2e7e:0737)", [BUILTIN, moved]);
  ok("a stale identifier falls back to the name", r.deviceId === "NEW-after-replug" && r.how === "name");
}

// 4. The operator renamed it in Kyro, adding words around the label.
{
  const r = pickCamera("webcam://gone", "Main Service — HuddleCamHD (2e7e:0737)", [BUILTIN, HUDDLE]);
  ok("a camera renamed around its label is still found", r.deviceId === "a1b2c3" && r.how === "name");
}

// 5. Nothing matches but there is only one camera — no room for confusion.
{
  const r = pickCamera("webcam://gone", "Something else entirely", [HUDDLE]);
  ok("with one camera it just uses it", r.deviceId === "a1b2c3" && r.how === "only");
}

// 6. Several cameras and nothing to go on — say so rather than show the wrong
//    room. Picking the first would be worse than admitting it.
{
  const r = pickCamera("webcam://gone", "Something else entirely", [BUILTIN, HUDDLE]);
  ok("several cameras and no clue is reported honestly", r.how === "none" && r.deviceId === null);
}

// 7. Before access is granted the browser gives blank names and identifiers.
//    One camera: open it and let the browser ask. Several: don't guess.
{
  const blank = [{ deviceId: "", label: "" }];
  const r = pickCamera("webcam://", "HuddleCamHD (2e7e:0737)", blank);
  ok("one nameless camera is opened so the browser can ask", r.how === "only" && r.deviceId === null);

  const twoBlank = [{ deviceId: "", label: "" }, { deviceId: "", label: "" }];
  ok("two nameless cameras are not guessed between", pickCamera("webcam://", "x", twoBlank).how === "none");
}

// 8. The address itself.
{
  ok("the identifier is read out of the address", deviceIdFrom("webcam://abc") === "abc");
  ok("a network address carries no identifier", deviceIdFrom("rtsp://192.168.1.64/stream") === "");
  ok("a missing address is handled", deviceIdFrom(undefined) === "");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails
  ? `\n${fails} failed`
  : "\nAll good. A plugged-in camera is found by name when its identifier has gone.");
process.exit(fails ? 1 : 0);
