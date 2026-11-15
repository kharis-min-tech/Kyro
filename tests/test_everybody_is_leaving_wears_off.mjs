/**
 * "i also think you have replaces when somone went out from coming in"
 *
 * The direction itself is sound — walking towards a "closer" doorway
 * camera makes the box grow, and that is counted as coming in, and the
 * reverse as going out. This test checks that, because it is the claim.
 *
 * But there is one thing that overrules it entirely: "Everybody is leaving
 * now". It tells every doorway camera to stop judging which way people
 * walked and count them all the same way, which is right while a hall
 * empties through a door people also loiter in.
 *
 * It had no end. Set once, it stayed set — through the rest of that
 * service, through the next one, and through every service after. A church
 * that pressed it while the hall emptied on Sunday would have had every
 * arrival the following Sunday counted as a departure. That is exactly
 * what "in and out swapped" looks like from the outside, and nothing on
 * the screen said a mode was on.
 *
 * Half an hour now. A hall empties in far less, and anything still going
 * after that is better judged by watching people walk — which Kyro does
 * the rest of the time and does well.
 *
 *   node tests/test_everybody_is_leaving_wears_off.mjs
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

// ── The direction itself ──────────────────────────────────────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-dir-"));
  execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
    path.join(root, "dashboard/src/lib/personTracker.ts"),
    "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
  ], { stdio: "inherit" });
  const { wentIn, PersonTracker } = await import(path.join(tmp, "personTracker.js"));

  const far  = [600, 300, 660, 450];   // small and high up: a long way off
  const near = [560, 360, 720, 760];   // big and low down: right at the lens
  ok("walking towards a 'closer' door is coming in", wentIn(far, near, "closer") === true);
  ok("and walking away from it is going out", wentIn(near, far, "closer") === false);
  ok("an 'away' door is the other way round", wentIn(far, near, "away") === false);
  ok("left to right past a 'right' door is coming in",
     wentIn([200, 300, 260, 450], [900, 300, 960, 450], "right") === true);
  ok("and right to left is going out",
     wentIn([900, 300, 960, 450], [200, 300, 260, 450], "right") === false);

  // …and the whole way through, counted.
  const look = (i) => ({ top: [(i * 53 % 255) / 255, (i * 97 % 255) / 255, (i * 29 % 255) / 255],
    bottom: [(i * 131 % 255) / 255, (i * 17 % 255) / 255, (i * 211 % 255) / 255],
    shape: 2.2 + (i % 7) * 0.12, height: 0.4 + (i % 5) * 0.05 });
  const see = (tr, b, t, l) => tr.update(b.map((x) => ({ box: x, score: 0.9 })), t, undefined, l);
  const walk = (tr, who, dir, startT) => {
    let time = startT;
    for (let f = 0; f < 7; f++) {
      const k = f / 6, sc = dir > 0 ? 0.35 + k * 0.5 : 0.85 - k * 0.5;
      const h = 400 * sc, w = h * 0.4, cy = 360 + (dir > 0 ? k * 80 : -k * 80);
      time += 1000 / 6;
      see(tr, [[640 - w / 2, cy - h / 2, 640 + w / 2, cy + h / 2]], time, [look(who)]);
    }
    return time;
  };
  const tr = new PersonTracker("door", true);
  tr.watchesDoorway("closer");
  let t = 1000;
  for (const p of [1, 2, 3]) { t = walk(tr, p, +1, t); t += 5000; see(tr, [], t, []); }
  t += 20_000; see(tr, [], t, []);
  ok("three people walking in are three arrivals and no departures",
     tr.entries === 3 && tr.exits === 0, `${tr.entries} in, ${tr.exits} out`);
  for (const p of [1, 2]) { t = walk(tr, p, -1, t); t += 5000; see(tr, [], t, []); }
  t += 20_000; see(tr, [], t, []);
  ok("then two of them leaving leaves one inside",
     tr.entries === 3 && tr.exits === 2 && tr.entries - tr.exits === 1,
     `${tr.entries} in, ${tr.exits} out`);
}

// ── …and the mode that overrules it does not last for ever ───────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-mode-"));
  fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
  for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
    const p = path.join(tmp, f);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
      /^import \{ DurableObject \} from "cloudflare:workers";/m,
      "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
  }
  const { VenueHub } = await import(path.join(tmp, "venue.js"));
  const hub = (door) => {
    const store = new Map();
    if (door) store.set("door_mode", door);
    const h = Object.create(VenueHub.prototype);
    h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); },
                         delete: async (k) => { store.delete(k); } }, waitUntil: () => {} };
    return h;
  };
  const now = Date.now();
  ok("with nothing set, Kyro judges for itself",
     (await hub(null).doorMode()) === "auto");
  ok("just pressed, everybody is leaving",
     (await hub({ mode: "out", by: "ruth", at: now }).doorMode()) === "out");
  ok("ten minutes later it still holds",
     (await hub({ mode: "out", by: "ruth", at: now - 10 * 60_000 }).doorMode()) === "out");
  ok("an hour later Kyro is judging for itself again",
     (await hub({ mode: "out", by: "ruth", at: now - 60 * 60_000 }).doorMode()) === "auto");
  ok("and LAST SUNDAY's press does not count this Sunday's arrivals as departures",
     (await hub({ mode: "out", by: "ruth", at: now - 7 * 24 * 3600_000 }).doorMode()) === "auto");
  ok("the same for 'everybody is arriving'",
     (await hub({ mode: "in", by: "ruth", at: now - 60 * 60_000 }).doorMode()) === "auto");
  ok("and an old press takes its name off the screen with it",
     (await hub({ mode: "out", by: "ruth", at: now - 60 * 60_000 }).doorModeRaw()) === null);
}

// ── Nothing reads the stored value behind the expiry's back ───────────────
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  const raw = worker.match(/await this\.get\("door_mode", null\)/g) || [];
  ok("only doorModeRaw reads it directly", raw.length === 1, `${raw.length} places read it raw`);
  ok("and both things that report it go through the expiry",
     (worker.match(/door_mode: await this\.doorMode\(\),/g) || []).length === 2);
  ok("half an hour, written down once",
     /const DOOR_MODE_LASTS_MS = 30 \* 60_000;/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. In is in, and 'everybody is leaving' wears off.");
process.exit(fails ? 1 : 0);
