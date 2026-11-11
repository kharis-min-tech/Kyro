/**
 * When somebody comes in it is logged, so that when they go out it can be
 * closed — and so that coming back is a second visit, not a second person.
 *
 * "make sure when people come in you log them in case they come out."
 *
 * ── What was missing ───────────────────────────────────────────────────────
 *
 * The register knew when somebody was FIRST seen and when they were LAST
 * seen. Those are not the same as coming in and going out. Somebody who
 * arrives at ten, steps out at half past and comes back at twenty to eleven
 * has their last-seen time moved forward — and the fact that they left
 * disappears entirely. That is right for the attendance figure, which must
 * not count them twice, and useless for the question a church asks at the
 * end of a service, which is whether the building is clear.
 *
 * So every visit is kept with its own end. One person, one entry in the
 * register, two visits.
 *
 *   node tests/test_comings_and_goings.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry, VISITS_KEPT } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ComingsAndGoings.tsx"), "utf8");

const look = (n) => {
  const a = (n * 2.399) % (Math.PI * 2);
  return [0.333 + 0.10 * Math.cos(a), 0.333 + 0.10 * Math.sin(a), 0.35 + 0.02 * ((n % 5) - 2),
    0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45 + 0.02 * ((n % 3) - 1),
    2.5 + 0.1 * ((n % 4) - 1.5), 0.5 + 0.02 * ((n % 7) - 3)];
};
const reg = () => new IdentityRegistry({ zoneOf: () => "room" });
const FIVE = 5 * 60_000;

// ── In, out, and back again ────────────────────────────────────────────────
{
  const r = reg();
  let t = 1_000;
  const see = (who) => r.observe("cam", who.map((n) => ({ track: n, look: look(n), face: null })), (t += 5_000));

  for (let i = 0; i < 8; i++) see([1]);
  const p = [...r.people.values()][0];
  ok("coming in opens a visit", p.spells.length === 1 && p.spells[0].out === null);
  ok("and the building has one person in it", r.inBuilding() === 1);
  const cameIn = p.spells[0].in;

  // They step out. Nothing happens for five minutes — somebody behind a
  // pillar has not left — and then the visit is closed.
  const lastSeen = p.lastAt;
  t += 2 * 60_000;
  ok("two minutes out of sight is not leaving", r.closeDeparted(t, FIVE).length === 0);
  ok("and they are still counted as inside", r.inBuilding() === 1);

  t += 4 * 60_000;
  const gone = r.closeDeparted(t, FIVE);
  ok("six minutes is", gone.length === 1 && gone[0].id === p.id);
  ok("the building is empty", r.inBuilding() === 0);
  // The time matters: they left when they were last seen, not when Kyro
  // became sure of it four minutes later.
  ok("and they left when they were last seen, not when Kyro noticed",
     p.spells[0].out === lastSeen, `${p.spells[0].out} vs ${lastSeen}`);

  // They come back.
  for (let i = 0; i < 6; i++) see([1]);
  ok("coming back is a SECOND visit", p.spells.length === 2, `${p.spells.length}`);
  ok("and the first one is left exactly as it was",
     p.spells[0].in === cameIn && p.spells[0].out === lastSeen);
  ok("the new one is open", p.spells[1].out === null);
  ok("they are inside again", r.inBuilding() === 1);
  // The whole point: still ONE person in the attendance figure.
  ok("and they are still one person, not two", r.size === 1);
  ok("which is counted, so it can be looked at", (r.stats.cameBack ?? 0) === 1);
}

// ── Several people, some in, some out ──────────────────────────────────────
{
  const r = reg();
  let t = 1_000;
  const see = (who) => r.observe("cam", who.map((n) => ({ track: n, look: look(n), face: null })), (t += 5_000));
  for (let i = 0; i < 8; i++) see([1, 30, 64]);
  ok("three people, three inside", r.size === 3 && r.inBuilding() === 3);
  // One stays, two leave.
  for (let i = 0; i < 8; i++) see([1]);
  t += 6 * 60_000;
  see([1]);
  r.closeDeparted(t + 5_000, FIVE);
  ok("two leaving leaves one inside", r.inBuilding() === 1, `${r.inBuilding()}`);
  ok("but all three are still in the register", r.size === 3);
  const v = r.visits();
  ok("and every visit is listed", v.length === 3);
  ok("newest first", v[0].in >= v[v.length - 1].in);
  ok("with the ones still here left open", v.filter((x) => x.out === null).length === 1);
}

// ── An usher on the door all morning ───────────────────────────────────────
{
  const r = reg();
  let t = 1_000;
  for (let trip = 0; trip < VISITS_KEPT + 6; trip++) {
    for (let i = 0; i < 6; i++) r.observe("cam", [{ track: trip + 1, look: look(1), face: null }], (t += 5_000));
    t += 6 * 60_000;
    r.closeDeparted(t, FIVE);
  }
  const p = [...r.people.values()][0];
  ok("thirty trips in and out is still one person", r.size === 1, `${r.size}`);
  ok("and the visits are capped, so the register still fits",
     p.spells.length <= VISITS_KEPT, `${p.spells.length}`);
  ok("with the cap written down and modest", VISITS_KEPT === 24);
}

// ── It survives a restart ──────────────────────────────────────────────────
{
  const r = reg();
  let t = 1_000;
  for (let i = 0; i < 8; i++) r.observe("cam", [{ track: 1, look: look(1), face: null }], (t += 5_000));
  t += 6 * 60_000;
  r.closeDeparted(t, FIVE);
  for (let i = 0; i < 6; i++) r.observe("cam", [{ track: 2, look: look(1), face: null }], (t += 5_000));

  const back = reg();
  back.restore(r.snapshot());
  const p = [...back.people.values()][0];
  ok("a restart keeps both visits", p.spells.length === 2, `${p.spells.length}`);
  ok("including which one is still open", p.spells[1].out === null);
  ok("so the building does not appear to empty and refill at the restart",
     back.inBuilding() === 1);
}

// ── The website writes them down, and takes them back out ──────────────────
{
  ok("visits have their own table, one row per visit",
     /CREATE TABLE IF NOT EXISTS visits \(service TEXT NOT NULL, person INTEGER NOT NULL, in_at INTEGER NOT NULL, out_at INTEGER, PRIMARY KEY \(service, person, in_at\)\)/.test(worker));
  ok("written with the people, so the two cannot disagree",
     /INSERT INTO visits \(service, person, in_at, out_at\) VALUES \(\?, \?, \?, \?\)/.test(worker)
     && /ON CONFLICT \(service, person, in_at\) DO UPDATE SET out_at = excluded\.out_at/.test(worker));
  ok("departures are recorded on every report", /this\.register\?\.closeDeparted\?\.\(now, LEFT_AFTER_MS\);/.test(worker));
  ok("a correction takes somebody's visits with it",
     /DELETE FROM visits WHERE service = \? AND person = \?/.test(worker));
  ok("a deleted person's visits never show, since the log joins on them",
     /JOIN people p ON p\.service = v\.service AND p\.person = v\.person AND p\.deleted_at IS NULL/.test(worker));
  ok("how many are inside is published with the figures",
     /in_building_now: this\.register\?\.inBuilding\?\.\(\) \?\? 0,/.test(worker));
  ok("and the log can be read, by an administrator or operator",
     /p === "\/api\/live\/visits" && request\.method === "GET"/.test(worker)
     && /Only administrators and operators can see this/.test(worker));
}

// ── The page ───────────────────────────────────────────────────────────────
{
  ok("it says how many are still inside", /<strong>\{inside\.length\}<\/strong> still inside/.test(panel));
  ok("each row says in, and out or still here", /in \{at\(v\.in\)\}/.test(panel) && /still here/.test(panel));
  ok("and how long they have been", /forHowLong\(v\.in, v\.out\)/.test(panel));
  ok("a person is a number, and the page says what that means",
     /A person here is a number, for this service only/.test(panel));
  ok("and that Kyro cannot recognise anybody from one Sunday to the next",
     /cannot recognise anybody from one Sunday to the next/.test(panel));
  ok("it says when somebody counts as having left, and from when",
     /no camera has seen them for five minutes/.test(panel)
     && /the time shown is when they were last seen, not\s*\n?\s*when Kyro became sure of it/.test(panel)
     || /when they were last seen, not when Kyro became sure of it/.test(panel.replace(/\s+/g, " ")));
  ok("and shows nothing at all when there is nothing to show",
     /if \(!log\?\.service \|\| !log\.visits\.length\) return null;/.test(panel));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. In is logged, out closes it, back again is a second visit.");
process.exit(fails ? 1 : 0);
