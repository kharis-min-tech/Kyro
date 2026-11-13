/**
 * Pressing Save puts it where Kyro will read it.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "i mark a zone called Entrance Exit, i try and save it — but nothing
 * happens" … "the seat editor ... dosent save nor is it working together with
 * kyro."
 *
 * Three faults, all the same shape: a save that succeeds and changes nothing.
 *
 *   ZONES went to /api/v1/zones — the separate Python backend, which this
 *   site does not run. When that failed, which it always did, they fell
 *   through to the browser's own storage with a console warning nobody would
 *   ever read. The zone was saved, on that one computer, and Kyro was never
 *   told.
 *
 *   A SAVED LAYOUT was never put to use. Seats are counted against the ACTIVE
 *   layout, and activating was a separate button further down a list she had
 *   no reason to think she needed. The drawing worked, the save worked, the
 *   message said "Saved", and the seat map went on showing what it showed
 *   before.
 *
 *   THE AUTOMATIC LAYOUT made when a camera is registered went to the same
 *   dead backend, with no live branch at all, so it has never once worked.
 *
 *   node tests/test_saving_reaches_kyro.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const api = fs.readFileSync(path.join(root, "dashboard/src/lib/api.ts"), "utf8");
const editor = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SeatLayoutEditor.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── Zones reach the website ────────────────────────────────────────────────
{
  const zones = api.slice(api.indexOf("export const zonesApi"), api.indexOf("export const seatsApi"));
  for (const [what, name] of [["drawing one", "create"], ["changing one", "update"], ["removing one", "delete"]]) {
    const fn = zones.slice(zones.indexOf(`  ${name}: async`));
    ok(`${what} goes to the live site first`, /if \(isEdgeLive\(\)\) \{/.test(fn.slice(0, 400)), name);
  }
  ok("and the whole list is written in one go, which is what the site keeps",
     /saveAll: async \(cameraId: string, zones: ZoneDef\[\]\)/.test(zones)
     && /method: "PUT", body: JSON\.stringify\(zones\)/.test(zones));
  ok("the website really does keep them", /async saveZones\(camera_id, request\)/.test(worker)
     && /all\[camera_id\] = list;/.test(worker));
  // The browser copy is still written, as a cache — but never INSTEAD of.
  ok("a failure is no longer hidden behind a browser-only save",
     !/backend unreachable — saving zone locally[\s\S]{0,200}isEdgeLive/.test(zones));
}

// ── A saved layout is the one in use ───────────────────────────────────────
{
  ok("saving a layout puts it to use", /await seatsApi\.activateLayout\(cameraId, layout\.id\); live = true;/.test(editor));
  ok("and says so", /seats, now in use/.test(editor));
  /**
   * …and when putting it to use fails, it says THAT, rather than claiming a
   * success it did not have. The layout really is saved; it is simply not
   * the one being counted against yet.
   */
  ok("a half-success is reported as one",
     /but Kyro is still using the old layout/.test(editor));
}

// ── The automatic one, which never worked at all ───────────────────────────
{
  const auto = api.slice(api.indexOf("  autoGenerateLayout:"));
  ok("the automatic layout uses the same route as every other save",
     /await seatsApi\.createLayout\(cameraId/.test(auto.slice(0, 900))
     && /await seatsApi\.activateLayout\(cameraId, layout\.id\)/.test(auto.slice(0, 900)));
  ok("and no longer goes straight to a backend this site does not run",
     !/api\/v1\/seats/.test(auto.slice(0, 900)));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. Save means saved, where Kyro reads it.");
process.exit(fails ? 1 : 0);
