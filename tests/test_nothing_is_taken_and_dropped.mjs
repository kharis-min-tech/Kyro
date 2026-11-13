/**
 * Taken from a queue, then thrown away.
 *
 * The same mistake three times over, in three different places, and each
 * one loses something quietly:
 *
 *   · the register's doubts — taken in full, twelve turned into questions,
 *     the rest discarded AND marked as already asked, so a full church got
 *     twelve questions a morning for ever;
 *   · a doorway's newly counted people — taken in full, twenty-five sent,
 *     the rest discarded and their tracks already flagged as kept, so a
 *     busy minute at a door vanished from the website's record of who it
 *     had counted, and every one of them was counted again after a reload;
 *   · (and the question slots themselves, fixed earlier.)
 *
 * The shape to watch for: a method that EMPTIES something, with a cap
 * applied by whoever called it. The cap is fine; emptying past it is not.
 *
 *   node tests/test_nothing_is_taken_and_dropped.mjs
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
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-drop-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const known = () => ({ look: { top: [1, 2, 3], bottom: [4, 5, 6], shape: 2.5, height: 0.5 },
  face: null, countedIn: true, countedOut: false, uniqued: false, at: Date.now() });

// ── 1. A burst at the door is reported, not lost ──────────────────────────
{
  const t = new PersonTracker("door", true);
  for (let i = 0; i < 60; i++) t.freshlyKnown.push(known());
  let sent = 0, reports = 0;
  while (t.freshlyKnown.length && reports < 20) { sent += t.takeNewlyRemembered(25).length; reports++; }
  ok("1. sixty people through a door in one burst all reach the website",
     sent === 60, `${sent} of 60 over ${reports} reports`);
  ok("1. none left stranded", t.freshlyKnown.length === 0, `${t.freshlyKnown.length}`);
  ok("1. and a few at a time, not all at once", reports > 1, `${reports} reports`);
}

// ── 2. Asking for more than there is takes what there is ──────────────────
{
  const t = new PersonTracker("door", true);
  for (let i = 0; i < 3; i++) t.freshlyKnown.push(known());
  ok("2. three people come back as three", t.takeNewlyRemembered(25).length === 3);
  ok("2. and the queue is empty", t.freshlyKnown.length === 0);
  ok("2. an empty queue gives nothing", t.takeNewlyRemembered(25).length === 0);
}

// ── 3. With no limit it still takes everything, as it always did ──────────
{
  const t = new PersonTracker("door", true);
  for (let i = 0; i < 40; i++) t.freshlyKnown.push(known());
  ok("3. no limit means all of them", t.takeNewlyRemembered().length === 40);
}

// ── 4. The caller asks for a number instead of cutting afterwards ─────────
{
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("4. the report asks for twenty-five",
     /c\.tracker\.takeNewlyRemembered\(25\)\.map/.test(ctx));
  ok("4. and does not drain and then cut",
     !/takeNewlyRemembered\(\)\.slice/.test(ctx));
}

// ── 5. Nowhere else empties a queue and then cuts what it took ────────────
//
// The shape, wherever it is: take…() with no argument, followed by a cap.
{
  const files = ["dashboard/src/lib/CountingContext.tsx", "worker/venue.js", "worker/identity.js"];
  const bad = [];
  for (const f of files) {
    read(f).split("\n").forEach((line, i) => {
      if (/\btake[A-Z]\w*\(\)\s*(\?\?\s*\[\])?\s*\.\s*slice\(/.test(line)) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  ok("5. nothing takes a whole queue and then throws part of it away",
     bad.length === 0, bad.join("\n   "));
}

// ── 6. The doubts the worker cannot put yet go back ───────────────────────
//
// The first of the three, kept here so all three are guarded together.
{
  const worker = read("worker/venue.js");
  ok("6. asks there was no room for are put back",
     /this\.register\?\.putBackAsks\?\.\(waitTheirTurn\);/.test(worker));
  const identity = read("worker/identity.js");
  ok("6. at the front, so the oldest doubt is asked first",
     /this\.asks = \[\.\.\.list, \.\.\.this\.asks\];/.test(identity));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
