/**
 * A camera Kyro will not use says so, and can be used anyway.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "not working" — about a wireless transmitter with a USB receiver, which is
 * exactly the kind of thing that SHOULD just work: a receiver makes the
 * transmitter a normal webcam.
 *
 * Kyro drops a camera whose NAME looks like a laptop lid, a phone or a
 * virtual camera. That is right nearly always — nobody counts a congregation
 * on a FaceTime camera, and a virtual camera is usually OBS. It did it in
 * silence, and that is the fault. Several capture devices and transmitter
 * receivers carry "Virtual" in their names, and one of those simply never
 * appeared, with nothing anywhere to say a camera had been set aside or why.
 *
 * Guessing wrong about a name should cost one click, not an evening.
 *
 *   node tests/test_no_camera_is_hidden_in_silence.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/CountingCard.tsx"), "utf8");

/** The rule itself, lifted out so it can be run against real camera names. */
const NOT_A_ROOM_CAMERA = new RegExp(
  /const NOT_A_ROOM_CAMERA = \/([^/]+)\/i;/.exec(cam)[1], "i");
const kept = (label, allowed = []) => !NOT_A_ROOM_CAMERA.test(label) || allowed.includes(label);

// ── The rule still does its job ────────────────────────────────────────────
{
  ok("a laptop's own camera is set aside", !kept("FaceTime HD Camera"));
  ok("a phone is set aside", !kept("iPhone Camera"));
  ok("OBS is set aside", !kept("OBS Virtual Camera"));
  ok("and a real camera is kept", kept("HD Pro Webcam C920"));
  ok("…including a capture stick", kept("USB Video"));
  ok("…and a HuddleCam", kept("HuddleCamHD"));
}

// ── …but never in silence ──────────────────────────────────────────────────
{
  ok("the ones set aside can be listed", /export async function setAsideCameras/.test(cam));
  ok("each with a reason somebody can read",
     /built into this computer/.test(cam) && /a phone or tablet/.test(cam)
     && /a virtual camera, not a real one/.test(cam));
  ok("the card shows them", /not using, going by/.test(card));
  ok("and offers to use one anyway", /Use this one/.test(card) && /useThisCamera\(deviceId\)/.test(card));
  ok("which is remembered", /localStorage\.setItem\(USE_ANYWAY_KEY/.test(cam));
  ok("and then it really is used", /\(!NOT_A_ROOM_CAMERA\.test\(d\.label\) \|\| allowed\.includes\(d\.deviceId\)\)/.test(cam));
  ok("a camera already allowed is not offered again",
     /NOT_A_ROOM_CAMERA\.test\(d\.label\) && !allowed\.includes\(d\.deviceId\)/.test(cam));
  // The list is kept short: this is an override for a handful of devices,
  // not a second camera list.
  ok("the override cannot grow without limit", /\.slice\(-8\)/.test(cam));
  ok("and the card looks again when something is plugged in",
     /addEventListener\?\.\("devicechange", look\)/.test(card));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. No camera is hidden in silence.");
process.exit(fails ? 1 : 0);
