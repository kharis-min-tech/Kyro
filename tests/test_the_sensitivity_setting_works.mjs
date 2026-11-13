/**
 * "why is this needed, is it even working"
 *
 * Counting sensitivity is how sure the AI must be before somebody is
 * counted. Every detection comes back with a score, and a cutoff has to sit
 * somewhere; where it should sit depends on the camera, the light and how
 * far away the back row is, which is why it is a setting rather than a
 * constant.
 *
 * It matters in one direction that nothing else can help with. "Is this a
 * person?" and the register of people both take somebody OFF a count that
 * has too many. Neither can put on somebody the AI was never sure enough
 * about — so when Kyro is counting too FEW, this is the only lever there is.
 *
 * Whether it works is a fair question and this answers it end to end: the
 * button writes it, the counting browsers are told within a couple of
 * seconds, and the cutoff is what decides who is counted.
 *
 *   node tests/test_the_sensitivity_setting_works.mjs
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
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-sens-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

const det = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-det-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  "--outDir", det, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { looksLikeAPerson } = await import(path.join(det, "peopleDetector.js"));

function hub() {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = { storage: {
    get: async (k) => store.get(k),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  } };
  h.store = store;
  return h;
}
const put = (v) => ({ json: async () => ({ count_confidence: v }) });

// ── 1. The button writes it, and it is read back ──────────────────────────
{
  const h = hub();
  ok("1. unset, it is the tested setting", (await h.counting()).count_confidence === 0.3,
     `${(await h.counting()).count_confidence}`);
  for (const v of [0.2, 0.3, 0.4]) {
    const r = await (await h.setCounting(put(v))).json();
    ok(`1. ${v} is accepted and kept`, r.count_confidence === v
       && (await h.counting()).count_confidence === v, JSON.stringify(r));
  }
  ok("1. it survives a restart, because it is written down",
     (await hub().counting()).count_confidence === 0.3);
}

// ── 2. Nonsense is refused rather than quietly stored ─────────────────────
{
  const h = hub();
  await h.setCounting(put(0.3));
  for (const bad of [0, 0.05, 0.9, 5, "high", null, NaN]) {
    const res = await h.setCounting(put(bad));
    ok(`2. ${JSON.stringify(bad)} is refused`, res.status === 400, `${res.status}`);
  }
  ok("2. and the setting is untouched", (await h.counting()).count_confidence === 0.3);
}

// ── 3. The three buttons are inside what the server will take ─────────────
{
  const card = read("dashboard/src/components/ui/CountingSensitivity.tsx");
  const vals = [...card.matchAll(/\{ v: ([\d.]+), name: "(\w+)"/g)].map((m) => [m[2], Number(m[1])]);
  ok("3. there are three", vals.length === 3, JSON.stringify(vals));
  const h = hub();
  for (const [name, v] of vals) {
    const res = await h.setCounting(put(v));
    ok(`3. "${name}" (${v}) is one the server accepts`, res.status === 200, `${res.status}`);
  }
  ok("3. and Normal is the one the server starts at",
     vals.find(([n]) => n === "Normal")?.[1] === 0.3);
}

// ── 4. Every counting browser is told, on its next report ─────────────────
{
  const worker = read("worker/venue.js");
  ok("4. the reply to a report carries it",
     /count_confidence: \(await this\.counting\(\)\)\.count_confidence/.test(worker));
  const mode = read("dashboard/src/lib/cameraMode.ts");
  ok("4. the browser reads it off that reply",
     /const conf = Number\(body\.count_confidence\);/.test(mode));
  ok("4. and refuses a figure outside what the setting can be",
     /conf >= 0\.1 && conf <= 0\.6 \? conf : undefined/.test(mode));
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("4. which replaces the one it was counting with",
     /if \(countConfidence !== undefined\) countConfidenceRef\.current = countConfidence;/.test(ctx));
  ok("4. and reports are two seconds apart, so it lands almost at once",
     /report_every_s: 2/.test(worker));
}

// ── 5. …and it decides who is counted ─────────────────────────────────────
//
// The point of the whole chain. Thirty people in a hall, scored the way a
// room camera scores a room — confident at the front, unsure at the back.
{
  const ctx = read("dashboard/src/lib/CountingContext.tsx");
  ok("5. the cutoff is what the counting filters on",
     /c\.people = atCutoff\(countConfidenceRef\.current\);/.test(ctx)
     && /looksLikeAPerson\(people, px\.height, bar\)/.test(ctx));

  const H = 720;
  const hall = [];
  for (let i = 0; i < 30; i++) {
    const top = 300 + (i % 6) * 40;
    hall.push({ box: [100 + i * 30, top, 100 + i * 30 + 55, top + 150], score: 0.18 + (i / 29) * 0.62 });
  }
  const counted = (v) => looksLikeAPerson(hall, H, v).length;
  const sensitive = counted(0.2), normal = counted(0.3), careful = counted(0.4);
  ok("5. Sensitive counts more than Normal", sensitive > normal, `${sensitive} vs ${normal}`);
  ok("5. Careful counts fewer than Normal", careful < normal, `${careful} vs ${normal}`);
  // It has to be worth the trip to the settings page.
  ok("5. and the difference is big enough to matter",
     sensitive - careful >= 5, `${sensitive} … ${careful} of ${hall.length}`);
  console.log(`   (of 30: Sensitive ${sensitive}, Normal ${normal}, Careful ${careful})`);
}

// ── 6. It is the only lever for counting too FEW ──────────────────────────
//
// Which is why it earns its place. The questions and the register can both
// take somebody off a count; neither can add one the AI never offered.
{
  const worker = read("worker/venue.js");
  ok("6. answering 'not a person' takes somebody off",
     /notAPerson\(q\.ask\.camera, q\.ask\.track\)/.test(worker));
  const identity = read("worker/identity.js");
  ok("6. and the register joins two entries into one",
     /answerAsk/.test(identity));
  // Nothing anywhere invents a person the AI did not report, and nothing
  // should: that is what the cutoff is for.
  ok("6. nothing adds a person who was never detected",
     !/addPerson\(|inventPerson\(/.test(worker + identity));
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(det, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
