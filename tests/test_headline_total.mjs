/**
 * The big number at the top of Attendance.
 *
 * The thing being guarded against: the page added the cameras counting in this
 * browser on top of what the server reported. That was right when a camera
 * plugged into someone's laptop was invisible to the server. It isn't any
 * more — a browser reports its people like any other camera — so every one of
 * them was counted twice. Twenty in the room, forty in the headline, which is
 * exactly what she saw: "the total is saying 40-45, and the count is saying
 * 19-20".
 *
 *   node tests/test_headline_total.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-headline-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/headlineTotal.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { headlineTotal } = await import(path.join(tmp, "headlineTotal.js"));

const parts = (over = {}) => ({
  base: 20, manualToday: 0, browserNow: 20,
  serverHasBrowserCameras: true, isToday: true, metric: "people", ...over,
});

// 1. Her exact case: two cameras in this browser, both reporting to Kyro.
{
  ok("the headline matches the cameras, not double it", headlineTotal(parts()) === 20,
     `got ${headlineTotal(parts())} (the old way gave 40)`);
}

// 2. No server to report to — the browser's own counts are all there is, and
//    dropping them would show nothing at all.
{
  ok("without a server the browser's counts are used",
     headlineTotal(parts({ serverHasBrowserCameras: false })) === 40);
}

// 3. Counted by hand is a separate tally and is still added.
{
  ok("hand counts are still added", headlineTotal(parts({ manualToday: 12 })) === 32);
}

// 4. A past day is whatever was recorded; nothing from today is added to it.
{
  const r = headlineTotal(parts({ isToday: false, base: 300, manualToday: 12, browserNow: 20 }));
  ok("a past day is left alone", r === 300);
}

// 5. Occupancy is a percentage. Adding people to a percentage is nonsense.
{
  ok("people are not added to a percentage",
     headlineTotal(parts({ metric: "occupancy", base: 61, manualToday: 12 })) === 61);
  ok("nor to departures", headlineTotal(parts({ metric: "exits", base: 4, manualToday: 12 })) === 4);
}

// 6. Arrivals are a headcount and behave like people.
{
  ok("arrivals take hand counts too", headlineTotal(parts({ metric: "entries", base: 29, manualToday: 3 })) === 32);
  ok("and don't double the browser's either", headlineTotal(parts({ metric: "entries", base: 29 })) === 29);
}

// 7. Nothing counted anywhere is nothing, not a stray number.
{
  ok("an empty building reads zero",
     headlineTotal(parts({ base: 0, browserNow: 0, manualToday: 0 })) === 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. 20 people in the room now reads 20, not 40.");
process.exit(fails ? 1 : 0);
