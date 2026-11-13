/**
 * Kyro working out its own Counting sensitivity.
 *
 * The card told her to count the room by hand, compare with Kyro, and
 * adjust. Counting the room by hand is the job Kyro is for, so in practice
 * the setting never moves off Normal. Kyro has a second opinion already: a
 * camera on the door counts everybody who walks through, close and face-on.
 *
 * The trap is the whole difficulty. "the room camera cannot see the whole
 * room" — so a room camera short of the door is NORMAL, and no setting
 * fixes it. Comparing the two numbers and suggesting Sensitive whenever the
 * room is lower would suggest it for ever and be wrong nearly every time.
 *
 * What tells them apart is what the camera is throwing away: the same
 * pictures with the bar moved. If being less fussy would find the missing
 * people, the bar is wrong. If it would barely change the number, they are
 * not in shot, and saying so is the honest answer.
 *
 *   node tests/test_kyro_suggests_the_setting.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-hint-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

/**
 * One hall camera and one door camera.
 * `now` is what the hall counts at the current setting; `sensitive` and
 * `careful` are what the same pictures would have given at either end.
 */
function hub({ now = 40, sensitive = 40, careful = 35, setting = 0.3, seats = 0, rooms = 1 } = {}) {
  const store = new Map();
  const cams = {}, live = {};
  for (let i = 0; i < rooms; i++) {
    cams[`box:hall${i}`] = { camera_id: `box:hall${i}`, name: `Hall ${i + 1}`, zone_name: `Hall ${i + 1}`,
                             location: "indoor", zone_capacity: seats, capacity_from: seats ? "admin" : null };
    live[`box:hall${i}`] = { at_sensitive: Math.round(sensitive / rooms), at_careful: Math.round(careful / rooms) };
  }
  store.set("cameras", cams);
  store.set("live", live);
  store.set("counting", { count_confidence: setting });
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } } };
  h.store = store;
  const zones = Object.values(cams).map((c, i) => ({
    camera_id: c.camera_id, zone_name: c.zone_name, camera_name: c.name,
    location: "indoor", is_running: true, current: Math.round(now / rooms),
  }));
  return { h, zones };
}

// ── 1. A cutoff in the wrong place ────────────────────────────────────────
//
// 78 through the door, the hall sees 40, and being less fussy would find 22
// more it is nearly sure about. Those people are in shot and being dropped.
{
  const { h, zones } = hub({ now: 40, sensitive: 62, careful: 30 });
  const hint = await h.suggestSensitivity(zones, 78);
  ok("1. Kyro speaks up", !!hint, JSON.stringify(hint));
  ok("1. and suggests Sensitive", hint?.name === "Sensitive" && hint?.setting === 0.2, JSON.stringify(hint));
  ok("1. with both figures in the reason",
     /78/.test(hint.why) && /40/.test(hint.why), hint.why);
  ok("1. and what it would become", /62/.test(hint.then), hint.then);
}

// ── 2. A camera that cannot see the whole room ────────────────────────────
//
// The same gap — 78 against 40 — but being less fussy would find 2 more.
// The other 36 are not in the picture at all. No setting fixes that, and
// suggesting one would be a confident wrong answer.
{
  const { h, zones } = hub({ now: 40, sensitive: 42, careful: 38 });
  const hint = await h.suggestSensitivity(zones, 78);
  ok("2. Kyro does not suggest a setting", hint?.setting === null, JSON.stringify(hint));
  ok("2. and says where the people actually are",
     /not in shot/.test(hint?.then ?? ""), hint?.then);
  ok("2. naming the camera and both figures",
     /Hall 1/.test(hint.why) && /78/.test(hint.why) && /40/.test(hint.why), hint.why);
}

// ── 3. …and the line between them is not a cliff ──────────────────────────
{
  const short = 78 - 40;
  const askFor = async (gain) => (await (async () => {
    const { h, zones } = hub({ now: 40, sensitive: 40 + gain, careful: 35 });
    return h.suggestSensitivity(zones, 78);
  })());
  ok("3. two more found is not a sensitivity problem", (await askFor(2))?.setting === null);
  ok("3. nor is a tenth of the gap", (await askFor(Math.round(short * 0.1)))?.setting === null);
  ok("3. half the gap is", (await askFor(Math.round(short * 0.5)))?.setting === 0.2);
  ok("3. and all of it certainly is", (await askFor(short))?.setting === 0.2);
}

// ── 4. Nothing is said when nothing is wrong ──────────────────────────────
{
  const { h, zones } = hub({ now: 76, sensitive: 80, careful: 70 });
  ok("4. a hall that matches the door is left alone",
     (await h.suggestSensitivity(zones, 78)) === null);
  const bare = hub({ now: 40, sensitive: 62, careful: 30 });
  ok("4. and with no door camera there is nothing to compare against",
     (await bare.h.suggestSensitivity(bare.zones, 0)) === null);
  const off = hub({ now: 40, sensitive: 62, careful: 30 });
  off.zones.forEach((z) => { z.is_running = false; });
  ok("4. nor is anything said about cameras that are not running",
     (await off.h.suggestSensitivity(off.zones, 78)) === null);
  const low = hub({ now: 40, sensitive: 62, careful: 30, setting: 0.2 });
  ok("4. and it never suggests a setting that is already on",
     (await low.h.suggestSensitivity(low.zones, 78)) === null);
}

// ── 5. Counting too MANY ──────────────────────────────────────────────────
{
  // More people seen than have come through the door.
  const { h, zones } = hub({ now: 95, sensitive: 110, careful: 74 });
  const hint = await h.suggestSensitivity(zones, 78);
  ok("5. Careful is suggested", hint?.name === "Careful" && hint?.setting === 0.4, JSON.stringify(hint));
  ok("5. with what it would become", /74/.test(hint.then), hint.then);

  // …and without a door camera at all, the seats are enough to be sure:
  // more people than the building holds cannot be right.
  const seated = hub({ now: 130, sensitive: 150, careful: 96, seats: 114 });
  const h2 = await seated.h.suggestSensitivity(seated.zones, 0);
  ok("5. more people than the building has seats is caught with no door",
     h2?.name === "Careful", JSON.stringify(h2));
  ok("5. and says so in those words", /114 seats/.test(h2?.why ?? ""), h2?.why);
}

// ── 6. Two cameras on one hall are added up, not taken one at a time ──────
{
  const { h, zones } = hub({ now: 40, sensitive: 62, careful: 30, rooms: 2 });
  const hint = await h.suggestSensitivity(zones, 78);
  ok("6. both cameras count towards the same gap", hint?.setting === 0.2, JSON.stringify(hint));
  const pointed = hub({ now: 40, sensitive: 42, careful: 38, rooms: 2 });
  const where = await pointed.h.suggestSensitivity(pointed.zones, 78);
  ok("6. and both are named when the answer is where they are pointed",
     /Hall 1 and Hall 2/.test(where?.why ?? ""), where?.why);
}

// ── 7. The cameras really do report the two numbers ───────────────────────
{
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("7. worked out from the same pictures with only the bar moved",
     /const atCutoff = \(bar: number\) => notHeldBySomebody\(/.test(ctx)
     && /c\.people = atCutoff\(countConfidenceRef\.current\);/.test(ctx));
  ok("7. at both ends of the setting",
     /c\.atSensitive = atCutoff\(SENSITIVE_CONFIDENCE\)\.length;/.test(ctx)
     && /c\.atCareful = atCutoff\(CAREFUL_CONFIDENCE\)\.length;/.test(ctx));
  ok("7. and sent with the report", /at_sensitive: c\.atSensitive, at_careful: c\.atCareful,/.test(ctx));
  const worker = read("worker/venue.js");
  ok("7. the website keeps them", /at_sensitive: num\(c\.at_sensitive, 0, 10000\)/.test(worker));
  ok("7. and the live figures carry the answer",
     /sensitivity_hint: await this\.suggestSensitivity\(zones, doorPeople\)/.test(worker));
}

// ── 8. It is on the card, with its reasoning and a way to refuse ─────────
{
  const card = read("dashboard/src/components/ui/CountingSensitivity.tsx");
  ok("8. the card reads Kyro's answer", /sensitivity_hint/.test(card));
  ok("8. and shows what it is reasoning from", /\{hint\.why\}/.test(card) && /\{hint\.then\}/.test(card));
  ok("8. with one press to take it", /Use \{hint\.name\}/.test(card)
     && /onClick=\{\(\) => choose\(hint\.setting!\)\}/.test(card));
  // Nothing applies itself. The point of showing the two figures is that
  // somebody can look at them and say no.
  ok("8. and nothing applies itself", !/choose\(hint\.setting\);/.test(card)
     && !/useEffect\([^)]*choose\(/.test(card));
  // …and no button at all when no setting would help.
  ok("8. no button when the people are simply not in shot",
     /hint\.setting !== null && Math\.abs/.test(card));
  // The old advice was to go and count the room by hand, which is the job
  // Kyro is for.
  ok("8. it no longer asks her to count the room herself",
     !/Count the people in the room yourself/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
