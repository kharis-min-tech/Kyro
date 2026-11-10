/**
 * Kyro must never hide a failure to look healthy.
 *
 * Three failures in the path that produces the attendance figure were being
 * written to a console log inside a Cloudflare Worker — which is not somewhere
 * a church can look:
 *
 *   - the register of people failing, after which attendance falls back to
 *     each camera's own tally. That number counts the same congregation over
 *     and over. It does not LOOK different. It means something different.
 *   - seat states too big to store, after which the seat map freezes at its
 *     last good reading and goes on looking live.
 *   - service tracking failing, after which a service may never start or end.
 *
 * And two kinds of broken camera that pass every check a network connection
 * can make: one sending a black picture, and one sending the same frame over
 * and over since it froze.
 *
 *   node tests/test_honest_failures.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Trouble, cameraHealth } from "../worker/health.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");

// ── A problem stays until it is fixed ──────────────────────────────────────
{
  const t = new Trouble();
  t.note("Register of people", "Couldn't record who is here", "storage full");
  ok("a failure is recorded", t.list().length === 1 && t.broken);
  ok("with what it means, not just a code", /Couldn't record who is here/.test(t.list()[0].what));

  // It happens again, and again, and again.
  for (let i = 0; i < 500; i++) t.note("Register of people", "Couldn't record who is here", "storage full");
  ok("repeats are one problem with a count, not five hundred entries",
     t.list().length === 1 && t.list()[0].happened === 501, `${t.list().length} entries`);
  ok("and it is still broken", t.broken);

  // Nothing but the thing working again may clear it.
  t.note("Services", "Couldn't follow whether a service is running");
  t.ok("Register of people");
  ok("the register working again clears its problem", t.list().find((x) => x.where === "Register of people").fixed);
  ok("but the record is kept, with when it was happening",
     !!t.list().find((x) => x.where === "Register of people").since);
  ok("and the other problem is untouched", t.broken === true);
  t.ok("Services");
  ok("everything fixed means nothing broken", t.broken === false);
}

// ── A live problem is never dropped to make room ───────────────────────────
{
  const t = new Trouble();
  t.note("Camera 1", "Black picture");                       // the live one
  for (let i = 0; i < 200; i++) { t.note(`Old ${i}`, "something"); t.ok(`Old ${i}`); }
  const live = t.list().filter((x) => !x.fixed);
  ok("a live problem survives any amount of tidying",
     live.length === 1 && live[0].where === "Camera 1", JSON.stringify(live.map((x) => x.where)));
  ok("and the list stays a sensible size", t.list().length <= 61, `${t.list().length}`);
}

// ── Connected is not working ───────────────────────────────────────────────
{
  const now = 1_000_000;
  const fine = cameraHealth({ updated_at: now - 2000, fps: 5, counted_at: now - 2000 }, now);
  ok("a working camera passes", fine.ok && fine.state === "working", JSON.stringify(fine.checks));

  const black = cameraHealth({ updated_at: now - 2000, fps: 5, counted_at: now - 2000, black: true }, now);
  ok("a camera sending black is NOT working", !black.ok, JSON.stringify(black));
  ok("and is told it is black, with what to check", /black/i.test(black.worst) && /1920/.test(black.worst));

  const frozen = cameraHealth({ updated_at: now - 2000, fps: 5, counted_at: now - 2000, frozen: true }, now);
  ok("a frozen camera is NOT working", !frozen.ok);
  ok("and is told the camera has stopped even though it is connected",
     /stopped/.test(frozen.worst) && /connected/.test(frozen.worst));

  const quiet = cameraHealth({ updated_at: now - 300_000 }, now);
  ok("a camera that stopped reporting is not reporting", !quiet.ok && quiet.state === "not reporting");

  const slow = cameraHealth({ updated_at: now - 1000, fps: 1.3, counted_at: now - 1000 }, now, 3);
  ok("a doorway camera too slow for its job fails its check", !slow.ok, JSON.stringify(slow.checks));
  ok("and is told the actual numbers", /1\.3 counts a second, needs 3/.test(slow.worst), slow.worst);

  // Each question is answered separately. One word for four questions is how
  // a broken camera stays green.
  ok("the checks are separate and named",
     fine.checks.length >= 4 && fine.checks.every((c) => c.name && c.says));
}

// ── Black and frozen pictures, on real pixels ──────────────────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-pic-"));
  execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
    path.join(root, "dashboard/src/lib/pictureCheck.ts"),
    "--outDir", tmp, "--module", "es2022", "--target", "es2022",
  ], { stdio: "inherit" });
  const { PictureWatch } = await import(path.join(tmp, "pictureCheck.js"));

  const W = 320, H = 180;
  const frame = (fill) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, v = fill(x, y);
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
    return { data, width: W, height: H };
  };
  const black = frame(() => 2);
  const room = (t) => frame((x, y) => 60 + 50 * Math.sin((x + t * 9) / 20) + 40 * Math.cos((y + t * 5) / 14));

  const w1 = new PictureWatch();
  for (let i = 0; i < 12; i++) w1.saw(black);
  ok("a black picture is seen as black", w1.black === true);
  ok("and black is not mistaken for frozen alone", w1.frozen === true);   // it is also frozen: identical frames

  const w2 = new PictureWatch();
  for (let i = 0; i < 12; i++) w2.saw(room(i));
  ok("a room with movement is neither black nor frozen", !w2.black && !w2.frozen);

  const w3 = new PictureWatch();
  for (let i = 0; i < 5; i++) w3.saw(room(i));
  ok("a camera that was fine is fine", !w3.frozen);
  const stuck = room(99);
  for (let i = 0; i < 10; i++) w3.saw(stuck);
  ok("then freezes, and is caught", w3.frozen === true, `stuck for ${w3.stuckFor}`);
  w3.saw(room(123));
  ok("and recovers when the picture moves again", w3.frozen === false);

  // A still room is not a frozen camera: real frames differ in the noise.
  const w4 = new PictureWatch();
  const almostStill = (t) => frame((x, y) => 70 + 2 * Math.sin((x + t) / 7) + ((x * y + t) % 3));
  for (let i = 0; i < 20; i++) w4.saw(almostStill(i));
  ok("a still room with a live camera is not called frozen", !w4.frozen);

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── The failures that were hidden are hidden no longer ─────────────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("no failure in the counting path goes to a console log",
     !/console\.log\("register failed/.test(worker)
     && !/console\.log\("service tracking failed/.test(worker)
     && !/console\.log\("seat states too big/.test(worker));
  ok("the register's failure says what it does to the number",
     /attendance figure has fallen back to each camera's own count/.test(worker));
  ok("the seat map's failure names the camera and says it is frozen",
     /the seat map for this camera is frozen at its last good reading/.test(worker));
  ok("the service failure says what may go wrong",
     /may fail to start, fail to end, or record the wrong busiest figure/.test(worker));
  ok("and each is cleared only by working again",
     /await this\.working\("Register of people"\)/.test(worker) && /await this\.working\("Services"\)/.test(worker));

  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("the counting browser's failures are sent to the website",
     /sendReport\(reports, \{ error: faceErr\.current, ready: !!faceEngine\.current \}, problems\.current\)/.test(ctx));
  ok("including a camera it cannot count on", /say\(c\.label, "Counting failed on this camera"/.test(ctx));
  ok("and a seat list it could not send", /couldn't send them to Kyro/.test(ctx));
  ok("a black picture is acted on, not just reported", /if \(c\.watch\.black && c\.tries < 3\)/.test(ctx));

  const health = fs.readFileSync(path.join(root, "worker/health.js"), "utf8");
  ok("green means the checks passed", /ok: failed\.length === 0/.test(health));
  ok("and a live problem is never dropped to make room",
     /Only resolved problems may be forgotten/.test(health));
}

// ── The diagnostics view keeps the same rules ──────────────────────────────
{
  const view = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SystemHealth.tsx"), "utf8");
  ok("green only when every check passed", /h\.ok \? GOOD/.test(view) && /every check passed/.test(view));
  ok("live problems are shown without having to open anything",
     /Live problems are shown whether or not the panel is open/.test(view));
  // Checked on what the page can DO, not on the words in it — my first
  // version of this matched the comment explaining that problems cannot be
  // dismissed, and passed for the wrong reason.
  ok("the page can only read, so a problem cannot be dismissed from it",
     !/method: "POST"|method: "DELETE"|method: "PUT"/.test(view));
  ok("each camera's checks are listed one by one", /c\.checks\.map/.test(view));
  ok("and the attendance figure says which kind it is",
     /No register yet, so attendance is each camera's own count/.test(view));
  ok("Kyro not answering is itself reported", /Kyro isn&apos;t answering/.test(view));
  ok("a fixed problem is kept and shown", /Fixed, but worth knowing about/.test(view));
}

// ── Nothing invents a number to fill a gap ─────────────────────────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  // The register failing must NOT quietly produce a plausible figure: the
  // health report says outright which kind of number is on the screen.
  ok("the health report says where attendance came from",
     /attendance_is_from_register: !!this\.register\?\.size,/.test(worker));
  // And the live total still withholds in/out rather than guessing when no
  // camera can follow people properly — the rule from before this audit.
  ok("in and out are still withheld rather than guessed",
     /total_entries: trustInOut \? entries : null, total_exits: trustInOut \? exits : null,/.test(worker));
}

// ── The timer that ends a service ──────────────────────────────────────────
//
// It threw nowhere. An alarm that throws is retried by Cloudflare over and
// over, which does three things at once: the service never ends, the failure
// is invisible, and the live-cameras server never falls idle — so it never
// picks up new code either, and a deploy appears to do nothing. That last one
// is how this was found: a deploy that uploaded successfully and did not go
// live.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const alarm = worker.slice(worker.indexOf("  async alarm()"), worker.indexOf("async finishService"));
  ok("the service timer cannot throw into the retry loop", /catch \(e\) \{/.test(alarm));
  ok("and says what it means when it fails",
     /may keep recording after everyone has gone/.test(alarm));
  ok("it always leaves a next check set", /setAlarm\(now \+ 5 \* 60_000\)/.test(alarm));
  ok("but only while there is a service to watch", /if \(stillLive && !\(await this\.ctx\.storage\.getAlarm\(\)\)\)/.test(alarm));
  ok("and it clears itself when it works", /await this\.working\("Service timer"\)/.test(alarm));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Nothing is hidden to look healthy.");
process.exit(fails ? 1 : 0);
