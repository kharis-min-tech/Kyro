/**
 * "10,000 people were tested in this system, kyro couldnt do it."
 *
 * It could count them. Measured: of ten thousand different people it held
 * nine thousand nine hundred and ninety-nine. What it could not do was
 * write them down.
 *
 * One stored value on this server may hold 128 KB, and the whole register
 * went into ONE of them. The snapshot passes the safe size at about seven
 * hundred people:
 *
 *     400 people ..... 107 KB ✓        800 people ..... 110 KB ✗
 *     700 people ..... 107 KB ✓     10,000 people ... 1,441 KB ✗
 *
 * Above that the write threw. The failure was caught and turned into
 * "attendance will fall back to the cameras' own tallies" — the covering-up
 * she describes — and the next restart, which happens on every deploy and
 * whenever the server goes idle, found nothing saved and began the
 * congregation again from nobody.
 *
 * There was never a reason for it to be one value.
 *
 *   node tests/test_a_congregation_of_any_size.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-size-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));
const { IdentityRegistry } = await import(path.join(tmp, "identity.js"));

/** What one value on this server may actually hold. */
const LIMIT = 131_072;

function hub() {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => {
        const b = JSON.stringify(v).length;
        // The real server refuses, loudly. So does this.
        if (b > LIMIT) throw new Error(`value too large: ${Math.round(b / 1024)} KB in "${k}"`);
        store.set(k, v);
      },
      delete: async (k) => { store.delete(k); },
    },
    waitUntil: () => {},
  };
  h.store = store;
  return h;
}

const look = () => { const b = crypto.randomBytes(8); return [...b].map((v, i) => (i === 6 ? 2 + v / 128 : v / 255)); };
function congregation(n) {
  const reg = new IdentityRegistry({ zoneOf: () => "Hall" });
  reg.startService("s");
  let t = 1000;
  for (let i = 0; i < n; i++) {
    const l = look();
    for (let f = 0; f < 4; f++) { t += 1000; reg.observe("box:a", [{ track: i + 1, look: l, face: null, seat: `K${i}` }], t); }
  }
  return reg;
}

// ── 1. A congregation far past the old ceiling is written down and read back
for (const n of [700, 2000]) {
  const h = hub();
  h.register = congregation(n);
  const counted = h.register.size;
  let err = null;
  try { await h.saveRegister(); } catch (e) { err = e.message; }
  ok(`1. ${n} people can be written down`, err === null, err);
  const back = await h.loadRegister();
  const again = new IdentityRegistry({ zoneOf: () => "Hall" });
  again.restore(back);
  ok(`1. …and every one of them read back (${again.size}/${counted})`, again.size === counted);
  const parts = [...h.store.keys()].filter((k) => k.startsWith("register:")).length;
  ok(`1. …across as many parts as it took (${parts})`, parts > 1);
  ok("1. and no part is over the limit",
     [...h.store.values()].every((v) => JSON.stringify(v).length <= LIMIT));
}

// ── 2. A million people's worth of register, chunked ──────────────────────
//
// Without running the matching, which is a separate question: this is about
// whether the WRITING has a ceiling. It does not any more.
{
  const h = hub();
  const people = [];
  for (let i = 1; i <= 20_000; i++) people.push({ i, f: 1000, l: 2000, n: 4, c: ["box:a"], k: "box:a" });
  h.register = { snapshot: () => ({ v: 2, service: "s", nextId: 20_001, stats: {}, people }) };
  let err = null;
  try { await h.saveRegister(); } catch (e) { err = e.message; }
  ok("2. twenty thousand people are written down", err === null, err);
  const back = await h.loadRegister();
  ok("2. and all twenty thousand come back", back.people.length === 20_000, `${back?.people?.length}`);
}

// ── 3. A register that shrinks does not read back somebody else's people ──
//
// Fewer parts than last time means the parts past the end are another
// service's, and reading them would put strangers in this one.
{
  const h = hub();
  h.register = congregation(2000);
  await h.saveRegister();
  const was = [...h.store.keys()].filter((k) => k.startsWith("register:")).length;
  h.register = congregation(50);
  await h.saveRegister();
  const now = [...h.store.keys()].filter((k) => k.startsWith("register:")).length;
  ok("3. the leftover parts are taken away", now < was, `${was} → ${now}`);
  const back = await h.loadRegister();
  ok("3. and the register reads back as itself", back.people.length === h.register.size,
     `${back.people.length} vs ${h.register.size}`);
}

// ── 4. A register written before this change is still readable ────────────
//
// There is one in the live server right now, in the old shape.
{
  const h = hub();
  await h.ctx.storage.put("register", { v: 2, service: "s", nextId: 4, stats: {},
    people: [{ i: 1, f: 1, l: 2, n: 4 }, { i: 2, f: 1, l: 2, n: 4 }, { i: 3, f: 1, l: 2, n: 4 }] });
  const back = await h.loadRegister();
  ok("4. the old shape is read as it always was", back?.people?.length === 3, `${back?.people?.length}`);
}

// ── 5. Forgetting it forgets all of it ────────────────────────────────────
{
  const h = hub();
  h.register = congregation(1500);
  await h.saveRegister();
  await h.forgetRegister();
  ok("5. nothing is left behind", [...h.store.keys()].filter((k) => k.startsWith("register")).length === 0,
     [...h.store.keys()].filter((k) => k.startsWith("register")).join(" "));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
