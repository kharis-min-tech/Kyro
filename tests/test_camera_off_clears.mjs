/**
 * Switching a camera off has to look like switching a camera off.
 *
 * Two complaints, one morning, about the same screen:
 *
 *   "turned off my camera but the old images are still there"
 *   "the red icons are not working so i actually cant delete any of them"
 *
 * Both were true, and both were the same mistake made twice: Kyro recorded
 * what went wrong and never recorded what came right.
 *
 *   1. Stopping counting said nothing. The website only noticed the silence
 *      after forty-five seconds, and for those forty-five seconds Live
 *      Cameras showed that camera's last picture — in colour, full frame,
 *      under a pulsing green "Live". A photograph is the most convincing
 *      thing that can be on a screen and no label beside it can argue.
 *
 *   2. The browser reported a black or frozen picture and never reported the
 *      camera recovering. A problem is only ever cleared by the thing that
 *      failed working again — so one bad frame in a camera's life left a red
 *      line that nothing could shift. Unplug the camera and it got worse: now
 *      nothing existed that could ever report it well. Four such lines, no
 *      button, and the only red thing on the row was the ✗ icon, so that is
 *      what got clicked.
 *
 * What this guards:
 *
 *   - a camera says goodbye, and the website drops its picture there and then
 *   - a camera that is working says so, which clears its own problems
 *   - an administrator can put a problem aside, and putting aside is not
 *     deleting: it keeps the record and it comes back if it happens again
 *   - a deleted camera takes its complaints with it
 *
 *   node tests/test_camera_off_clears.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { Trouble } from "../worker/health.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "dashboard/src/app/live-cameras/page.tsx"), "utf8");
const view = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SystemHealth.tsx"), "utf8");

// ── Putting a problem aside, for real ───────────────────────────────────────
//
// Run against the record itself rather than the words around it: the point of
// the whole exercise is that putting aside is SAFE, and the only thing that
// makes it safe is that the record survives and a recurrence undoes it.
{
  const t = new Trouble(null);
  t.note("HD Pro Webcam C920", "The picture is black.", "9 times");
  t.note("HD Pro Webcam C920", "The same picture over and over.");
  t.note("Register of people", "Couldn't record who is here.");
  ok("three distinct problems, all live", t.list().length === 3 && t.list().every((p) => !p.fixed));

  const put = t.aside("HD Pro Webcam C920", "The picture is black.", "Ruth");
  ok("putting one aside takes exactly one", put === 1);
  ok("and nothing else is touched",
     t.list().filter((p) => !p.fixed).length === 2);
  ok("it is NOT deleted — the record is all still there", t.list().length === 3);
  const aside = t.list().find((p) => p.fixed);
  ok("the count it had is kept", aside.happened === 1 && aside.detail === "9 times");
  ok("and who put it aside is written down", aside.aside_by === "Ruth");

  // The whole defence. If it is still going wrong, it comes back by itself.
  t.note("HD Pro Webcam C920", "The picture is black.");
  ok("it happens once more and it is live again",
     t.list().find((p) => p.what === "The picture is black.").fixed === false);
  ok("with its history continued, not restarted",
     t.list().find((p) => p.what === "The picture is black.").happened === 2);

  // Everything at once, for somebody looking at a page of red after a service.
  const all = new Trouble(null);
  all.note("A", "one"); all.note("B", "two"); all.note("C", "three");
  let n = 0;
  for (const v of all.items.values()) if (!v.fixed) n += all.aside(v.where, v.what, "Ruth");
  ok("a whole page of them can go in one go", n === 3 && all.broken === false);
  ok("and all three are still in the record", all.list().length === 3);
}

// ── A camera that is gone takes its record with it ──────────────────────────
{
  const t = new Trouble(null);
  t.note("Camera 2", "The picture is black.");
  t.note("Camera 2", "The same picture over and over.");
  t.note("Register of people", "Couldn't record who is here.");
  ok("deleting a camera forgets its problems outright", t.forget("Camera 2") === 2);
  ok("and leaves everybody else's alone", t.list().length === 1 && t.list()[0].where === "Register of people");
  // Deleted is different from put aside: a put-aside problem is about
  // something that still exists and may fail again, so it is kept. A deleted
  // camera cannot fail again — there is no camera.
  ok("a camera that no longer exists leaves nothing behind", t.forget("Camera 2") === 0);
}

// ── Working again actually gets written down ────────────────────────────────
{
  // This was the quiet one. ok() was only saved when the LAST live problem
  // cleared, so with four showing, three of them coming right was never
  // written to storage and came back on the next reload.
  const t = new Trouble(null);
  t.note("Camera 1", "black"); t.note("Camera 2", "black");
  ok("clearing one of several reports that something changed", t.ok("Camera 1") === true);
  ok("clearing one that was already clear changes nothing", t.ok("Camera 1") === false);
  ok("and the other is untouched", t.broken === true);

  ok("so the website saves whenever something changed, not only when the last clears",
     /if \(t\.ok\(where\)\) await this\.ctx\.storage\.put\("trouble", t\.save\(\)\)/.test(worker));
}

// ── Stopping counting says so ───────────────────────────────────────────────
{
  ok("a camera can report that it is off", /status: "online" \| "error" \| "offline"/.test(cam));
  ok("stopping sends that before letting go of the cameras",
     /const open = \[\.\.\.cams\.current\.values\(\)\]\.filter\(\(c\) => c\.stream\);/.test(ctx)
     && /status: "offline" as const/.test(ctx));
  ok("and never lets a failed goodbye stop the stopping", /\.catch\(\(\) => \{ \/\* going off either way/.test(ctx));

  ok("the website marks it off at once rather than waiting for silence",
     /if \(c\.status === "offline"\) \{/.test(worker)
     && /status: "offline", updated_at: now/.test(worker));
  ok("throws the last picture away", /await this\.ctx\.storage\.delete\(`snap:\$\{camera_id\}`\);/.test(worker));
  ok("and closes that camera's problems, because it is off rather than failing",
     /await this\.working\(cams\[camera_id\]\.name\);/.test(worker));
  // Silence still has to work: a computer that is unplugged mid-service never
  // gets to say goodbye, and 45 seconds of silence must still mean offline.
  ok("silence still counts as offline after 45 seconds",
     /const OFFLINE_AFTER_MS = 45_000;/.test(worker)
     && /isOnline\(l\) \{ return !!l && Date\.now\(\) - l\.updated_at < OFFLINE_AFTER_MS && l\.status !== "offline"; \}/.test(worker));
}

// ── A camera that is working says so ────────────────────────────────────────
{
  ok("the browser sends the cameras that are fine right now", /const well = list$/m.test(ctx) || /const well = list\s/.test(ctx));
  ok("'fine' means open, not black, not frozen, and counting",
     /!c\.error && !c\.watch\.black && !c\.watch\.frozen/.test(ctx)
     && /Date\.now\(\) - c\.countedAt < 60_000/.test(ctx));
  ok("the report carries it", /well: string\[\] = \[\]/.test(cam) && /well: well\.slice\(0, 32\)/.test(cam));
  ok("and the website clears those cameras' problems",
     /if \(Array\.isArray\(body\.well\)\) \{/.test(worker) && /if \(where\) await this\.working\(where\);/.test(worker));
}

// ── The page stops showing a picture of a camera that is off ────────────────
{
  ok("the tile asks whether the camera is running, not just whether it has a picture",
     /const running = !cameraId \|\| !!zonesHere\?\.\[cameraId\]\?\.is_running;/.test(page));
  ok("and does not fetch a picture for one that isn't",
     /useEdgeSnapshot\(cameraId, edge && !liveHere && running, 20_000\)/.test(page));
  ok("not running shows 'this camera is off' however fresh the last picture was",
     /if \(!snap\.url \|\| !running\) \{/.test(page));
  ok("the reason is still spelled out", /is not a picture of now/.test(page));
}

// ── The button she was looking for ──────────────────────────────────────────
{
  ok("putting aside is admin-only on the website",
     /Only administrators can put a problem aside/.test(worker));
  ok("there is a route for it", /p === "\/api\/live\/health\/aside" && request\.method === "POST"/.test(worker));
  ok("one problem or all of them", /b\.all === true/.test(worker) && /this\.putAsideAll\(user\)/.test(worker));
  ok("and who did it is recorded", /t\.aside\(where, what, who\)/.test(worker));

  ok("the page offers it per problem", /putAside\(\{ where: p\.where, what: p\.what \}/.test(view));
  ok("and for the lot", /putAside\(\{ all: true \}, "all"\)/.test(view));
  ok("the red ✗ is decoration and says so", /<XCircle size=\{13\} aria-hidden/.test(view));
  ok("a put-aside problem shows who put it aside", /put aside by \$\{p\.aside_by\}/.test(view));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Off looks off, and a problem can be dealt with.");
process.exit(fails ? 1 : 0);
