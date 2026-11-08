/**
 * What "Scan" says when a camera is plugged in.
 *
 * The thing being guarded against: the page notes which cameras were there
 * when you opened it, then calls anything else "new". Plug the camera in
 * first — the normal thing to do — and it is in that list, so nothing is new
 * and the page announced "nothing was plugged in" about a camera it could see.
 * It only ever worked before the browser was granted camera access for good,
 * because until then every camera looks new.
 *
 *   node tests/test_camera_scan.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-scan-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/cameraScan.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { scanOutcome } = await import(path.join(tmp, "cameraScan.js"));

const CAM  = { id: "usb-capture-1", label: "USB Video" };
const BUILT = { id: "facetime-1", label: "FaceTime HD Camera" };

// The old rule, kept here so the test says what changed.
const oldWay = (found, already) => {
  const fresh = found.filter((c) => !already.has(c.id));
  return fresh.length === 0
    ? { shown: [], said: "No new camera found — nothing was plugged in." }
    : { shown: fresh, said: "" };
};

// 1. The exact situation she hit: camera plugged in BEFORE opening Kyro.
{
  const found = [BUILT, CAM];
  const already = new Set([BUILT.id, CAM.id]);   // access granted, so both are known

  const before = oldWay(found, already);
  ok("the old way offered nothing at all", before.shown.length === 0);
  ok("the old way claimed nothing was plugged in", before.said.includes("nothing was plugged in"));

  const r = scanOutcome(found, already);
  ok("nothing is reported as a fault", r.problem === null, `problem: ${r.problem}`);
  ok("the full list opens on its own", r.showAll === true);
  ok("it says how many cameras it can see", r.note?.includes("2 cameras"), `note: ${r.note}`);
  ok("it says why nothing is flagged as new", r.note?.includes("before opening Kyro"));
  ok("it never claims nothing was plugged in", !(r.note ?? "").includes("nothing was plugged in"));
}

// 2. Plugged in while the page is open — the camera must still stand out on
//    its own, which is the whole point of noticing what was there before.
{
  const r = scanOutcome([BUILT, CAM], new Set([BUILT.id]));
  ok("a camera plugged in just now is picked out", r.fresh.map((c) => c.id).join() === CAM.id);
  ok("the built-in webcam isn't offered alongside it", r.fresh.length === 1);
  ok("the full list stays tucked away", r.showAll === false);
  ok("and nothing needs explaining", r.note === null && r.problem === null);
}

// 3. Genuinely nothing there — that IS a fault, and it should name the cable.
{
  const r = scanOutcome([], new Set());
  ok("no cameras at all is reported as a problem", r.problem !== null);
  ok("the cable is the first thing it mentions", r.problem.includes("cable"));
  ok("nothing is offered to pick", r.fresh.length === 0 && r.showAll === false);
  ok("and it isn't dressed up as normal", r.note === null);
}

// 4. First visit, before the browser hands over the identifiers: everything
//    looks new. This is why it appeared to work to begin with.
{
  const r = scanOutcome([BUILT, CAM], new Set());
  ok("before access is granted every camera looks new", r.fresh.length === 2);
}

// 5. One camera reads as "It's listed below", not "They're".
{
  const r = scanOutcome([CAM], new Set([CAM.id]));
  ok("one camera is described in the singular", r.note.includes("1 camera ") && r.note.includes("It's"), `note: ${r.note}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  fails
    ? `\n${fails} failed`
    : "\nAll good. Plugging the camera in before opening Kyro now lists it instead of\n"
      + "saying nothing was plugged in.",
);
process.exit(fails ? 1 : 0);
