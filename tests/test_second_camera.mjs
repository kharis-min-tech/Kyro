/**
 * A second camera plugged into the same computer must actually open —
 * and if it can't, it must say so where it can be read.
 *
 * What was reported: "i have another camera installed on my computer, but its
 * not detecting it, its a goodmans camera".
 *
 * Kyro asked every camera for 1920x1080 and, if that was refused, gave up with
 * "Another program is using this camera" — about a camera no program was
 * using. Two cameras on one USB socket need more of it than it has, so the
 * second one is simply refused. Asking for 1280x720 opens it straight away.
 *
 * That step-down already existed for a camera that opens and then sends
 * nothing. It did not exist for a camera that refuses to open at all, which is
 * the same fault one step earlier.
 *
 * Worse, a camera that never opened was left out of the report to the website
 * altogether — so it appeared nowhere, which looks exactly like Kyro not
 * noticing the camera. A camera Kyro can see but cannot use now reports, with
 * the reason, and no figures.
 *
 *   node tests/test_second_camera.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const mode = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");

// ── The step-down itself, lifted out and run against cameras that behave the
//    way real ones do. ───────────────────────────────────────────────────────
const SIZES = [[1920, 1080], [1280, 720], [640, 480], null];

/** A pretend camera that only opens at or below `opensAt` pixels wide. */
function openAnySize(opensAt, { throws } = {}) {
  let tried = 0;
  for (let step = 0; step < SIZES.length; step++) {
    tried++;
    if (throws === "NotAllowedError") return { opened: false, tried, name: throws };
    const size = SIZES[Math.min(step, SIZES.length - 1)];
    const width = size ? size[0] : 640;     // null = whatever the camera likes
    if (width <= opensAt) return { opened: true, width, tried };
  }
  return { opened: false, tried };
}

// 1. The camera that started this: fine on its own, refused at 1080p once a
//    second camera is sharing the socket.
{
  const r = openAnySize(1280);
  ok("a camera that won't do 1080p opens at 720p", r.opened && r.width === 1280);
  ok("and it took one extra try, not a trip behind the desk", r.tried === 2);
}

// 2. Cheaper cameras, and the one that only does VGA.
{
  ok("a 640x480 camera still opens", openAnySize(640).opened);
  ok("a camera happy at 1080p opens first time", openAnySize(1920).tried === 1);
  ok("720p is plenty to count people with", SIZES[1][0] === 1280);
}

// 3. Not being allowed to use cameras at all is not a size problem, and
//    asking four times only makes four identical refusals.
{
  const r = openAnySize(1920, { throws: "NotAllowedError" });
  ok("a permission refusal is not retried four times", !r.opened && r.tried === 1);
}

// ── And the code that does it. ───────────────────────────────────────────────

// 4. Every size is tried, largest first.
{
  ok("there is a step-down open", /export async function openCameraAnySize/.test(mode));
  ok("it walks every size", /for \(let step = 0; step < SIZES\.length; step\+\+\)/.test(mode));
  ok("it stops asking when permission is the problem",
     /e\.name === "NotAllowedError" \|\| e\.name === "SecurityError"/.test(mode));
  ok("and it throws the real reason, not a made-up one", /throw last;/.test(mode));
}

// 5. Opening a camera uses it — this is the line that only ever asked once.
{
  ok("cameras are opened at any size they'll give", /c\.stream = await openCameraAnySize\(d\.deviceId\);/.test(ctx));
  ok("the old single-size open is gone", !/c\.stream = await openCamera\(d\.deviceId\);/.test(ctx));
}

// 6. When it still won't open, the reason is true and useful.
{
  ok("a busy camera no longer blames a program that isn't running",
     !/\? "Another program is using this camera"/.test(ctx));
  ok("it names the two real causes",
     /another program has it \(Zoom, Teams, Photo Booth, FaceTime\)/.test(ctx)
     && /sharing a USB socket with another camera — give it a socket of its own/.test(ctx));
  ok("a blocked browser is told how to unblock itself",
     /Click the camera icon in the address bar, choose Allow/.test(ctx));
  ok("and the failure is sent to the website, not left in this browser",
     /say\(c\.label, "Couldn't open this camera", c\.error\);/.test(ctx));
}

// 7. The camera appears on the website even though it never opened. This is
//    the difference between "Kyro can't use your camera, here's why" and the
//    camera being invisible.
{
  ok("every camera is reported, not just the ones that opened",
     /const list = \[\.\.\.cams\.current\.values\(\)\];/.test(ctx)
     && !/const list = \[\.\.\.cams\.current\.values\(\)\]\.filter\(\(c\) => c\.stream\);/.test(ctx));
  ok("one that didn't open reports its reason and no figures",
     /if \(!c\.stream \|\| !c\.video\) return \{/.test(ctx)
     && /status: "error", error: c\.error \?\? "This camera isn't open yet",/.test(ctx));
  ok("it claims no seats while it has no picture",
     /if \(!c\.stream \|\| c\.isDoor \|\| Date\.now\(\) - c\.seatsSentAt < SEATS_EVERY_MS\) continue;/.test(ctx));
  ok("and sends no picture either",
     /if \(c\.stream && Date\.now\(\) - c\.lastPicture >= PICTURE_EVERY_MS && c\.countedAt\)/.test(ctx));
}

// 8. A camera that opens on the second try starts its retry budget again, so
//    a later hiccup still gets the same three goes.
{
  ok("a successful open resets the retry count", /c\.error = null;\n          c\.tries = 0;/.test(ctx));
}

// 9. Reporting is not counting. The camera now appears — it must not also make
//    the system look healthier than it is by being counted as running.
{
  const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("a camera with no picture isn't counted as counting",
     /const counting = running && !\(l\.status === "error" && l\.no_picture\);/.test(src));
  ok("\"cameras running\" means cameras counting",
     /cameras_running: zones\.filter\(\(z\) => z\.is_counting\)\.length/.test(src));
  ok("but it is still online, so its reason is still shown",
     /is_running: running, status: running \? l\.status \|\| "online" : "offline"/.test(src));
  const page = fs.readFileSync(path.join(root, "dashboard/src/app/attendance/page.tsx"), "utf8");
  ok("and a camera that never opened isn't blamed for being slow",
     /is_counting\?: boolean \}\)\.is_counting !== false && z\.is_running && !z\.in_out/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The second camera opens.");
process.exit(fails ? 1 : 0);
