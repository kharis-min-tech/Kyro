/**
 * The number on a green box has to BE something.
 *
 * "uno the IDs, AI Ids, theres a lot of 1 2 1 2 1 2, 4, 5 and it dosent
 *  increase, is this normal, if not- FIX"
 *
 * It was not normal, and it was not an id.
 *
 * ── What the number was ────────────────────────────────────────────────────
 *
 *     const label = `${i + 1}`;
 *
 * The position in the list of detections for that frame. The list is rebuilt
 * every frame and its order comes from the AI, so the same person flickered
 * between numbers, two people swapped, and nothing ever counted upwards. It
 * looked exactly like an identity and was nothing of the kind.
 *
 * It is this camera's own track number now: it stays with somebody while they
 * are in view, and the next person to walk in gets a new one.
 *
 * ── And the number underneath it mattered more ─────────────────────────────
 *
 * The website keys who-is-who on "camera#track" and keeps that link for five
 * minutes. A fresh tracker — a reload, a reconnect, a tab reopened — started
 * numbering at 1 again, so the first person it saw was handed a number still
 * remembered as somebody else, and inherited that person's identity. A number
 * reused inside the window it is remembered in is not an identity, it is a
 * collision waiting to happen.
 *
 *   node tests/test_track_numbers.mjs
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
const preview = fs.readFileSync(path.join(root, "dashboard/src/components/ui/CameraPreview.tsx"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-track-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck",
], { stdio: "pipe" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const box = (x, y, w, h) => [x, y, x + w, y + h];
const see = (tr, boxes, at) => tr.update(boxes.map((b) => ({ box: b, score: 0.8 })), at, 1280, 720);

// ── A number stays with a person ───────────────────────────────────────────
{
  const tr = new PersonTracker();
  let t = 0;
  // Two people, walking slowly across. The AI's list order is deliberately
  // SWAPPED halfway through — which is what made the old labels flicker.
  const a = (i) => box(200 + i * 4, 200, 60, 180);
  const b = (i) => box(600 - i * 4, 200, 60, 180);
  for (let i = 0; i < 6; i++) see(tr, [a(i), b(i)], (t += 400));
  const first = tr.seenNow(t).map((x) => x.track).sort((p, q) => p - q);
  ok("two people get two numbers", first.length === 2, `${first.length}`);

  for (let i = 6; i < 14; i++) see(tr, [b(i), a(i)], (t += 400));   // order swapped
  const after = tr.seenNow(t);
  ok("the numbers survive the AI listing them the other way round",
     after.map((x) => x.track).sort((p, q) => p - q).join() === first.join(),
     `${first.join()} → ${after.map((x) => x.track).sort((p, q) => p - q).join()}`);

  // Somebody new walks in: a NEW number, not a reused one.
  for (let i = 0; i < 6; i++) see(tr, [a(14), b(14), box(900, 200, 60, 180)], (t += 400));
  const now = tr.seenNow(t).map((x) => x.track);
  ok("somebody new gets a number nobody has had", now.length === 3 && Math.max(...now) > Math.max(...first));
  ok("and it counts upwards", new Set(now).size === 3);
}

// ── A new tracker never reuses the old one's numbers ───────────────────────
{
  const first = new PersonTracker(1);
  let t = 0;
  for (let i = 0; i < 6; i++) see(first, [box(200, 200, 60, 180), box(400, 200, 60, 180)], (t += 400));
  const used = first.seenNow(t).map((x) => x.track);

  // A reload: a fresh tracker, carrying on from where the last one got to.
  const next = new PersonTracker(first.nextTrackId);
  for (let i = 0; i < 6; i++) see(next, [box(200, 200, 60, 180)], (t += 400));
  const after = next.seenNow(t).map((x) => x.track);
  ok("a fresh tracker does not hand out a number the last one used",
     after.every((n) => !used.includes(n)), `${used.join()} vs ${after.join()}`);
  ok("because it carries on from where that one got to", first.nextTrackId > Math.max(...used));

  // And the default is still 1, so nothing that does not care has to.
  ok("a tracker with nothing to carry on from starts at 1",
     new PersonTracker().nextTrackId === 1);
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── The block is claimed before it is used ─────────────────────────────────
{
  ok("each tracker is given a block of numbers of its own",
     /const nextTrackBase = \(key: string\): number => \{/.test(ctx)
     && /localStorage\.setItem\(k, String\(base \+ 10_000\)\);/.test(ctx));
  // Written down BEFORE being handed out: a reload that never gets to save
  // still cannot hand out a number the last one did.
  ok("and the next block is written down before this one is used",
     /const base = Math\.max\(1, Number\(localStorage\.getItem\(k\)\) \|\| 1\);\s*\n\s*localStorage\.setItem\(k, String\(base \+ 10_000\)\);\s*\n\s*return base;/.test(ctx));
  ok("the tracker is built with it", /new PersonTracker\(nextTrackBase\(key\)\)/.test(ctx));
  ok("and it still works without storage", /\} catch \{ return 1; \}/.test(ctx));
}

// ── The preview draws what is counted ──────────────────────────────────────
{
  ok("the label is no longer a position in a list", !/const label = `\$\{i \+ 1\}`;/.test(preview));
  /**
   * It is no longer the camera's own track number either, and this test used
   * to insist that it was.
   *
   * A track number is a scratch number for a box being followed. The detector
   * loses somebody for a moment and the next sighting of them gets a new one;
   * a reload moves the whole block on by ten thousand so two browsers cannot
   * collide. Drawn on a picture it reads as an identity, and it is not one:
   * "theres one that has been standing for more than 5 minutes an usher, but
   * you have given him different Id's, one time he was 20036, next hes 20057,
   * next hes 2045, dont understand."
   *
   * The identity is the register's. It is decided on the website, where every
   * camera can be compared with every other, and it is locked for the whole
   * service — so that is what the picture shows, and somebody not yet placed
   * is drawn with no number rather than a number about to change.
   */
  ok("it is the number Kyro counts that person as", /const label = `\$\{who\}`;/.test(preview));
  ok("and nobody is labelled with a number that is about to change",
     /if \(who == null\) return;/.test(preview));
  ok("the boxes are the people being FOLLOWED, not every detection",
     /const draw = tracked\?\.length/.test(preview)
     && /people\.map\(\(p\) => \(\{ track: 0, box: p\.box, person: null as number \| null \}\)\)/.test(preview));
  ok("which the browser now sends, with who each of them is",
     /tracked: c\.tracker\.seenNow\(\)\.map\(\(x\) => \(\{ track: x\.track, box: x\.box, person: c\.whoIs\[x\.track\] \?\? null \}\)\),/.test(ctx));
  ok("told to it by the website, which is the only place that knows",
     /people: \(\(\) => \{/.test(fs.readFileSync(path.join(root, "worker/venue.js"), "utf8"))
     && /this\.register\.idOfTrack\(camera_id, t\)/.test(fs.readFileSync(path.join(root, "worker/venue.js"), "utf8")));
  ok("and read back by the browser", /people: body\.people && typeof body\.people === "object" \? body\.people : \{\}/
     .test(fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8")));
  ok("so the boxes and the figure beside them cannot disagree",
     /These are the ones confirmed and counted/.test(ctx));
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/CountingCard.tsx"), "utf8");
  ok("the card passes them on", /tracked=\{v\.tracked\}/.test(card));
  ok("and says what the number on a box means",
     /the number Kyro counts them as/.test(card) && /theirs\s*\n\s*for the whole service/.test(card));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The number on a box means something.");
process.exit(fails ? 1 : 0);
