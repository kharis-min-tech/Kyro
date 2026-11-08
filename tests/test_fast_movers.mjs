/**
 * Catching people who move fast through a doorway.
 *
 * The thing being guarded against: the entrance camera reported "0 in, 1 out"
 * with a service's worth of people walking through it. Two separate reasons,
 * both about how often that camera gets to look:
 *
 *   - cameras took strict turns, so with another camera on the room the door
 *     got a look about once a second;
 *   - and every look split the picture into five tiles — five AI runs — which
 *     is worth it for a wide hall and pointless a step from a doorway.
 *
 * Somebody walking normally crosses that view in well under a second. Seen
 * once, Kyro cannot tell which way they were going; seen not at all, there is
 * nothing to tell.
 *
 *   node tests/test_fast_movers.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-fast-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/countOrder.ts"),
  path.join(root, "dashboard/src/lib/personTracker.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { countOrder } = await import(path.join(tmp, "countOrder.js"));
const { PersonTracker } = await import(path.join(tmp, "personTracker.js"));

const cam = (key, isDoor = false) => ({ key, isDoor });
const keys = (list) => list.map((c) => c.key).join(" ");

// ── Whose turn it is ────────────────────────────────────────────────────────

// 1. Her setup exactly: one camera on the room, one on the door. The door
//    used to get every other look; it now gets two out of three.
{
  const order = countOrder([cam("room"), cam("door", true)]);
  ok("the door is looked at twice a round", order.filter((c) => c.isDoor).length === 2, keys(order));
  ok("the room still gets its look", order.filter((c) => !c.isDoor).length === 1, keys(order));
  ok("and the door's two looks are spread out, not back to back",
     keys(order) === "door room door", keys(order));
}

// 2. Two room cameras: the door gets three looks to their one each.
{
  const order = countOrder([cam("a"), cam("b"), cam("door", true)]);
  ok("more rooms means more door looks, not fewer",
     keys(order) === "door a door b door", keys(order));
}

// 3. Nothing to balance: no door camera, or nothing but door cameras.
{
  ok("rooms alone take plain turns", keys(countOrder([cam("a"), cam("b")])) === "a b");
  ok("a door alone already has every turn", keys(countOrder([cam("door", true)])) === "door");
  ok("two doors and no room likewise",
     keys(countOrder([cam("d1", true), cam("d2", true)])) === "d1 d2");
  ok("no cameras at all is no turns", countOrder([]).length === 0);
}

// 4. Every camera still gets looked at. Starving one to feed another would
//    trade a missed arrival for a room that stopped reporting.
{
  const order = countOrder([cam("a"), cam("b"), cam("d1", true), cam("d2", true)]);
  for (const k of ["a", "b", "d1", "d2"]) {
    ok(`${k} is still counted`, order.some((c) => c.key === k), keys(order));
  }
}

// ── What that buys at the door ──────────────────────────────────────────────

// 5. The point of the extra looks: at one look a second a fast walker is seen
//    once and cannot be counted, because one sighting says nothing about which
//    way they were walking. Seen twice, they are counted.
{
  const box = (left, top, w, h) => [left, top, left + w, top + h];
  const seenOnce = new PersonTracker();
  seenOnce.watchesDoorway("closer");
  seenOnce.update([{ box: box(100, 60, 70, 200) }], 1000);
  seenOnce.update([], 1000 + 16000);
  ok("seen once, there is nothing to say which way they went",
     seenOnce.entries === 0 && seenOnce.exits === 0,
     `in ${seenOnce.entries} out ${seenOnce.exits}`);

  const seenTwice = new PersonTracker();
  seenTwice.watchesDoorway("closer");
  seenTwice.update([{ box: box(100, 60, 70, 200) }], 1000);
  seenTwice.update([{ box: box(100, 120, 48, 124) }], 1400);   // 400 ms later, further away
  seenTwice.update([], 1400 + 16000);
  ok("seen twice, they are counted going out", seenTwice.exits === 1, `exits ${seenTwice.exits}`);
}

// 6. And the same person walking the other way is counted the other way.
{
  const box = (left, top, w, h) => [left, top, left + w, top + h];
  const tr = new PersonTracker();
  tr.watchesDoorway("closer");
  tr.update([{ box: box(100, 120, 48, 124) }], 1000);
  tr.update([{ box: box(100, 60, 70, 200) }], 1400);           // coming towards the camera
  tr.update([], 1400 + 16000);
  ok("walking in is counted in", tr.entries === 1 && tr.exits === 0,
     `in ${tr.entries} out ${tr.exits}`);
}

// ── The five-runs-a-count problem ───────────────────────────────────────────

// 7. A doorway camera must never split its picture into tiles. This is the
//    difference between about two looks a second and about one every two.
{
  const src = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("tiles are switched off for a doorway camera",
     /const useTiles = !c\.isDoor &&/.test(src));
  ok("and the periodic check that turns them back on is too",
     /const checking = !c\.isDoor &&/.test(src));
  ok("a camera knows whether it is on a door",
     /c\.isDoor = !!inward;/.test(src));
  ok("and the turns are taken in the order countOrder gives",
     /countOrder\(\[\.\.\.cams\.current\.values\(\)\]\)/.test(src));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. The door gets the looks, and fast walkers are counted.");
process.exit(fails ? 1 : 0);
