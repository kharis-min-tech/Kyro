/**
 * A tab nobody is looking at does not hold the counting server open.
 *
 * ── Why this matters far more than it sounds ────────────────────────────────
 *
 * The live-cameras server is evicted a few seconds after its last request,
 * and being evicted is the ONLY way it picks up newly deployed code.
 *
 * The attendance page asked it for the figures every TWO SECONDS, for as long
 * as the page existed, whether or not the tab was in front of anybody. So one
 * Kyro tab left open in the background — which is exactly what anybody
 * watching a service has — guaranteed the server could never fall idle, and
 * no deploy could ever reach it.
 *
 * Four deploys in a row landed on the pages and never on the counting. Every
 * fix in them looked like it had failed. The honest answer each time was that
 * a forgotten tab was holding the door open, and nothing anywhere said so.
 *
 *   node tests/test_a_hidden_tab_is_quiet.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

/**
 * Everything that asks the live-cameras server for something on a timer.
 * Each one has to stop while the tab is hidden, and each one has to catch up
 * the moment it is looked at again — a page that has been quiet must never be
 * a page showing stale figures.
 */
const POLLS = [
  ["dashboard/src/app/attendance/page.tsx", "the figures"],
  ["dashboard/src/lib/CameraContext.tsx", "the camera list"],
  ["dashboard/src/lib/ReviewContext.tsx", "the questions"],
];

for (const [file, what] of POLLS) {
  const src = read(file);
  ok(`${what}: nothing is asked while the tab is hidden`, /document\.hidden\) return;|if \(!document\.hidden\)/.test(src), file);
}

{
  const page = read("dashboard/src/app/attendance/page.tsx");
  ok("the figures catch up the moment the tab is looked at again",
     /document\.addEventListener\("visibilitychange", onShow\);/.test(page));
  ok("and the listener is let go with the timer",
     /clearInterval\(t\); document\.removeEventListener\("visibilitychange", onShow\);/.test(page));
  const cams = read("dashboard/src/lib/CameraContext.tsx");
  ok("so does the camera list", /document\.addEventListener\("visibilitychange", onShow\);/.test(cams)
     && /clearInterval\(id\); document\.removeEventListener\("visibilitychange", onShow\);/.test(cams));
}

{
  // And the reason, written where somebody changing the interval will read it.
  const page = read("dashboard/src/app/attendance/page.tsx");
  ok("the cost of a background tab is written down beside the poll",
     /being evicted is the ONLY way it picks up newly deployed code/.test(page));
  ok("and nothing is lost by being quiet, which is said too",
     /It catches up the\s*\n\s*\* moment it is looked at again/.test(page));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A hidden tab is quiet.");
process.exit(fails ? 1 : 0);
