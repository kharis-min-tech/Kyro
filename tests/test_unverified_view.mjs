/**
 * Looking at figures Kyro won't stand behind.
 *
 * Nothing is ever deleted: the arrivals and departures from before Kyro
 * counted at a doorway by direction of travel are still stored, they are
 * simply kept out of the charts. An administrator can ask to see the shape of
 * a day anyway — so long as it is plain what they are looking at.
 *
 * The thing being guarded against is those figures leaking into the ordinary
 * ones, where they would be read as counts of people.
 *
 *   node tests/test_unverified_view.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-unver-"));
const src = fs.readFileSync(path.join(root, "dashboard/src/lib/edgeVenue.ts"), "utf8");

// Lift edgeCounterSeries out — the rest of that file is React and hooks.
const from = src.indexOf("export function edgeCounterSeries");
const body = src.slice(from, src.indexOf("\n}", src.indexOf("return Object.values(by)", from)) + 2)
  .replace(/: EdgeHistoryPoint\[\]/, "")
  .replace(/\): \{ t: number; entries: number; exits: number \}\[\]\[\] \{/, ") {")
  .replace(/const by: Record<string, \{ t: number; entries: number; exits: number \}\[\]> =/, "const by =");
fs.writeFileSync(path.join(tmp, "s.mjs"), body.replace("export function", "export function"));
const { edgeCounterSeries } = await import(path.join(tmp, "s.mjs"));

const row = (min, { known, entries, exits }) => ({
  camera_id: "cam-1",
  timestamp: new Date(Date.parse("2026-11-08T10:00:00Z") + min * 60_000).toISOString(),
  in_out_known: known,
  total_entries: known ? entries : null,
  total_exits: known ? exits : null,
  raw_entries: entries,
  raw_exits: exits,
});

// This morning: big figures Kyro won't stand behind, then small honest ones.
const day = [
  row(0,   { known: false, entries: 300, exits: 40 }),
  row(60,  { known: false, entries: 500, exits: 90 }),
  row(150, { known: true,  entries: 2,   exits: 1 }),
  row(160, { known: true,  entries: 6,   exits: 4 }),
];

// 1. The ordinary view keeps the withheld readings out entirely.
{
  const s = edgeCounterSeries(day);
  ok("only the readings Kyro stands behind are used", s[0].length === 2, `${s[0]?.length} points`);
  ok("and none of the morning's figures come with them",
     s[0].every((p) => p.entries < 10), JSON.stringify(s[0]));
}

// 2. The unverified view shows the lot, using the figures as recorded.
{
  const s = edgeCounterSeries(day, true);
  ok("asking for them shows every reading", s[0].length === 4);
  ok("including the morning's as they were recorded",
     s[0][0].entries === 300 && s[0][1].entries === 500);
  ok("and the honest ones are still there too", s[0][3].entries === 6);
}

// 3. Asking must be deliberate: the default is off.
{
  ok("the default leaves them out", edgeCounterSeries(day).length
     && edgeCounterSeries(day)[0].length === 2);
}

// 4. A day with nothing withheld looks the same either way.
{
  const clean = [row(0, { known: true, entries: 1, exits: 0 }), row(10, { known: true, entries: 4, exits: 2 })];
  ok("a clean day is unchanged by the switch",
     JSON.stringify(edgeCounterSeries(clean)) === JSON.stringify(edgeCounterSeries(clean, true)));
}

// 5. The view says what it is, and the server keeps the figures to show.
{
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
  ok("the switch is labelled", /Show unverified/.test(card) && /Showing unverified/.test(card));
  ok("and says plainly they are not counts of people",
     /These figures are not counts of people/.test(card));
  // The tiles carry the label too. They now also say WHICH stretch they
  // cover — "all day", or "this session" after a fresh start — so the check is
  // that both parts are there, not one fixed sentence.
  ok("the tiles say so as well",
     /Came in, this session/.test(card) && /Came in, all day/.test(card)
     && /unverified \? " \(unverified\)" : ""/.test(card));

  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("the server sends them under their own name, not the ordinary one",
     /raw_entries: r\.entries, raw_exits: r\.exits/.test(worker));
  ok("while the ordinary figures are still withheld",
     /total_entries: trusted \? r\.entries : null/.test(worker));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. Kept, shown on request, and never mistaken for counts.");
process.exit(fails ? 1 : 0);
