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
  h.told = [];
  h.ctx = {
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } },
    // Telling a phone is work that outlives the request. Here it is just
    // noted, so a test can check that she IS told.
    waitUntil: (p) => { h.told.push(p); },
  };
  h.env = {};
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
  // Worked out where the door's figure and the rooms' are both in hand,
  // and acted on there rather than offered to anybody.
  ok("7. and the answer is reached where those figures are",
     /await this\.maybeSetSensitivity\(await this\.suggestSensitivity\(zones, doorPeople\)\);/.test(worker));
}

// ── 8. Kyro sets it itself ───────────────────────────────────────────────
//
// "to be honest, i have a lot on my hands, its better for you to do it
// yourself, just let me know that you have changed it, so you can remove it
// off my screen."
//
// So the control is gone and this does it — which means the person who
// would have looked at the two figures and said "no, the back of the hall
// is out of shot" is gone too. Everything that kept the suggestion cautious
// has to hold on its own now.
{
  const wrong = () => hub({ now: 40, sensitive: 62, careful: 30 });
  const t0 = 1_000_000;

  // One reading is not a reason to move anything.
  {
    const { h, zones } = wrong();
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0);
    ok("8. one reading changes nothing", (await h.counting()).count_confidence === 0.3);
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0 + 60_000);
    ok("8. nor does a minute of it", (await h.counting()).count_confidence === 0.3);
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0 + 4 * 60_000);
    ok("8. three minutes of the same answer does", (await h.counting()).count_confidence === 0.2,
       `${(await h.counting()).count_confidence}`);
  }

  // …and it is written down, with the figures behind it.
  {
    const { h, zones } = wrong();
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0);
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0 + 4 * 60_000);
    const note = h.store.get("sensitivity_set");
    ok("8. the change is recorded", !!note && note.to === 0.2 && note.from === 0.3, JSON.stringify(note));
    ok("8. with why", /78/.test(note.why) && /40/.test(note.why), note.why);
    ok("8. and what it was before, so it can be put back", note.from === 0.3);
    ok("8. and it joins a list rather than replacing it",
       (h.store.get("sensitivity_log") ?? []).length === 1);
  }

  // Nothing moves twice in twenty minutes, whatever the figures do.
  {
    const { h, zones } = wrong();
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0);
    await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0 + 4 * 60_000);
    // Now it reads as over-counting, steadily, for four minutes.
    const over = hub({ now: 95, sensitive: 110, careful: 74, setting: 0.2 });
    over.h.store.set("sensitivity_set", h.store.get("sensitivity_set"));
    const at = t0 + 5 * 60_000;
    await over.h.maybeSetSensitivity(await over.h.suggestSensitivity(over.zones, 78), at);
    await over.h.maybeSetSensitivity(await over.h.suggestSensitivity(over.zones, 78), at + 4 * 60_000);
    ok("8. and it will not move again inside twenty minutes",
       (await over.h.counting()).count_confidence === 0.2, `${(await over.h.counting()).count_confidence}`);
    // Twenty minutes later it will.
    const later = t0 + 30 * 60_000;
    await over.h.maybeSetSensitivity(await over.h.suggestSensitivity(over.zones, 78), later);
    await over.h.maybeSetSensitivity(await over.h.suggestSensitivity(over.zones, 78), later + 4 * 60_000);
    ok("8. but it will once that is past",
       (await over.h.counting()).count_confidence === 0.4, `${(await over.h.counting()).count_confidence}`);
  }

  /**
   * An answer that keeps changing its mind moves nothing at all.
   *
   * The same building, minute by minute, reading "Sensitive" and then
   * "nothing to say" and then "Sensitive" again — a hall where somebody
   * walks a row, or the door is busy for a moment while the hall has not
   * caught up. Three minutes means three minutes of the SAME answer.
   */
  {
    const { h, zones } = wrong();
    for (let i = 0; i < 40; i++) {
      const hint = i % 2 === 0 ? await h.suggestSensitivity(zones, 78) : null;
      await h.maybeSetSensitivity(hint, t0 + i * 60_000);
    }
    ok("8. an answer that keeps flipping moves nothing",
       (await h.counting()).count_confidence === 0.3, `${(await h.counting()).count_confidence}`);
    ok("8. …and nothing is written down about it", !h.store.get("sensitivity_set"));
  }

  // And it never acts where no setting would help.
  {
    const { h, zones } = hub({ now: 40, sensitive: 42, careful: 38 });
    for (let i = 0; i < 20; i++) {
      await h.maybeSetSensitivity(await h.suggestSensitivity(zones, 78), t0 + i * 60_000);
    }
    ok("8. and never where the people are simply not in shot",
       (await h.counting()).count_confidence === 0.3 && !h.store.get("sensitivity_set"));
  }
}

// ── 9. She is told, and can put it back ──────────────────────────────────
{
  const worker = read("worker/venue.js");
  ok("9. the live figures carry what was changed and why",
     /sensitivity_set: await \(async \(\) => \{/.test(worker));
  ok("9. and it stops being shown after a few hours",
     /Date\.now\(\) - n\.at < AUTO_SET_SHOW_MS/.test(worker));
  ok("9. her phone is told too", /kind: "sensitivity"/.test(worker));
  const index = read("worker/index.js");
  ok("9. and that alert has something to say",
     /Kyro adjusted the counting/.test(index)
     && /"sensitivity"\]\.includes\(body\.kind\)/.test(index));

  const card = read("dashboard/src/components/ui/AutoServices.tsx");
  ok("9. the service card says what it did", /Kyro set the counting to/.test(card));
  ok("9. with the reason it did it", /\{sens\.why\}/.test(card));
  ok("9. and one press to put it back", /Put it back how it was/.test(card)
     && /putBack\(sens\.from\)/.test(card));

  const cameras = read("dashboard/src/app/cameras/page.tsx");
  ok("9. and the setting is off her screen",
     !/<CountingSensitivity/.test(cameras)
     && !fs.existsSync(path.join(root, "dashboard/src/components/ui/CountingSensitivity.tsx")));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
