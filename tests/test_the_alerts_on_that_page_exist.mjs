/**
 * Every alert the Notifications page lists can actually happen.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * "this page is not even working at all."
 *
 * It lists four rules. Of the four:
 *
 *   Overcrowding and Filling up were real, and silent for a different reason
 *   — the method that raises them was never called from anywhere in Kyro.
 *
 *   "AI review question" had no sender at all. Kyro asking a question that
 *   nobody is told about is Kyro not asking.
 *
 *   "Camera went offline" had no sender either, AND a switch beside it that
 *   wrote to the browser it was pressed in and governed nothing. A switch for
 *   an alert that cannot happen.
 *
 * A page of switches for things that cannot happen is worse than a page with
 * fewer switches.
 *
 *   node tests/test_the_alerts_on_that_page_exist.mjs
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
const index = read("worker/index.js");
const venue = read("worker/venue.js");
const page = read("dashboard/src/app/notifications/page.tsx");
const push = read("dashboard/src/lib/edgePush.ts");

/**
 * Every rule the page shows, and the kind of alert that has to exist for it
 * to be a promise rather than a decoration.
 */
const RULES = [
  ["Overcrowding — critical", "camera"],
  ["Filling up — warning", "camera"],
  ["AI review question", "question"],
  ["Camera went offline", "offline"],
];

for (const [label, kind] of RULES) {
  ok(`"${label}" is on the page`, page.includes(label));
  ok(`…and something can send a "${kind}" alert`,
     new RegExp(`kind: "${kind}"`).test(venue), `nothing in venue.js sends kind: "${kind}"`);
  ok(`…and it is worded for a person`,
     new RegExp(`ev\\.kind === "${kind}"|kind === "${kind}"`).test(index) || kind === "camera");
}

// ── The sending itself ─────────────────────────────────────────────────────
{
  ok("the room-filling alerts are actually raised now",
     /await this\.capacityAlerts\(cams, live\);/.test(venue));
  ok("a camera that stops is announced", /kind: "offline", zone: cams\[camera_id\]/.test(venue));
  ok("…but only one that was counting a moment ago",
     /live\[camera_id\]\.status !== "offline" && this\.isOnline\(live\[camera_id\]\)/.test(venue));
  ok("a question is announced", /kind: "question"/.test(venue));
  ok("…at most one in ten minutes, however many there are",
     /now - \(this\.toldAboutQuestions \?\? 0\) > ASK_ALERT_GAP_MS/.test(venue)
     && /const ASK_ALERT_GAP_MS = 10 \* 60_000;/.test(venue));
  ok("and five questions light a phone once, not five times",
     /tag: "kyro-question"/.test(index));
}

// ── The switch now governs something ───────────────────────────────────────
{
  ok("the camera-offline switch reaches the server",
     /offline: typeof body\.offline === "boolean" \? body\.offline : \(prev\.offline \?\? true\)/.test(index));
  ok("the page sends it", /updateEdgeThresholds\(warn, crit, offline\)/.test(page));
  ok("…and it is carried with the rest", /offline: thresholds\.offline \?\? storedThresholds\(\)\.offline/.test(push));
  ok("a phone that switched it off is not told",
     /if \(kind === "offline"\) subs = subs\.filter\(\(s\) => s\.offline !== false\);/.test(index));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. Every rule on that page can happen.");
process.exit(fails ? 1 : 0);
