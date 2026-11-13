/**
 * The doorway's memory, and the size it could not be.
 *
 * The door keeps its own record of who it has already counted, so the usher
 * who is in and out all morning is one person and not forty. Each entry is
 * a coat reading and — while face matching is on — a face code.
 *
 * ── The arithmetic nobody did ──────────────────────────────────────────────
 *
 * One remembered person costs about 427 bytes with a face. The cap was
 * eight hundred people. One stored value on this server holds 128 KB.
 *
 *     200 people .....  83 KB ✓        400 people ..... 167 KB ✗
 *                                      800 people ..... 334 KB ✗
 *
 * So at roughly three hundred people through a door, with faces on, the
 * write threw — and it was not inside a try, so it took the WHOLE report
 * down with it. Every camera on that computer stopped being counted, and
 * the page said counts were not reaching Kyro.
 *
 *   node tests/test_the_door_remembers_everybody.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-door-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { VenueHub } = await import(path.join(tmp, "venue.js"));

/** What one value on this server may actually hold. */
const LIMIT = 131_072;
const face = Buffer.from(new Uint8Array(256)).toString("base64");
const person = (i) => ({ l: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 2.5, 0.5], f: face, i: 1, o: 0, u: 1, at: 1000 + i });

function hub() {
  const store = new Map();
  const h = Object.create(VenueHub.prototype);
  h.ctx = {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => {
        const b = JSON.stringify(v).length;
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

// ── 1. A door that sees a cathedral ───────────────────────────────────────
for (const n of [400, 800, 5000]) {
  const h = hub();
  const people = Array.from({ length: n }, (_, i) => person(i));
  let err = null;
  try { await h.saveDoorKnown("box:door", "svc", people); } catch (e) { err = e.message; }
  ok(`1. ${n} people through the door can be written down`, err === null, err);
  const back = await h.doorKnown("box:door");
  ok(`1. …and all ${n} read back (${back.people.length})`, back.people.length === n);
  ok("1. with every part inside the limit",
     [...h.store.values()].every((v) => JSON.stringify(v).length <= LIMIT));
}

// ── 2. It is not allowed to take the counting down with it ────────────────
//
// The worst a failure here can do on its own is count somebody twice. That
// is a far smaller thing than counting nobody at all, which is what it did.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("2. the write is inside a try",
     /try \{\s*\n\s*await this\.saveDoorKnown\(camera_id, service, list\);\s*\n\s*\} catch/.test(worker));
  ok("2. and a failure is reported rather than swallowed",
     /Couldn't write down who the door has already counted/.test(worker));
}

// ── 3. A browser is handed back only what it will keep ────────────────────
//
// It holds 800 and splices the oldest off the front, so sending five
// thousand is a megabyte of faces over the wire to be dropped on arrival.
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("3. the newest ones are sent, not all of them",
     /const fits = had\.people\.slice\(-MOST_HANDED_BACK\);/.test(worker));
  const browser = fs.readFileSync(path.join(root, "dashboard/src/lib/personTracker.ts"), "utf8");
  const keeps = /const MOST_REMEMBERED = (\d+);/.exec(browser)?.[1];
  const sends = /const MOST_HANDED_BACK = (\d+);/.exec(worker)?.[1];
  ok("3. and that is exactly what the browser keeps", keeps === sends, `${sends} sent, ${keeps} kept`);
}

// ── 4. A shrinking service does not read back strangers ───────────────────
{
  const h = hub();
  await h.saveDoorKnown("box:door", "svc", Array.from({ length: 1000 }, (_, i) => person(i)));
  const was = [...h.store.keys()].filter((k) => /^door_known:box:door:\d+$/.test(k)).length;
  await h.saveDoorKnown("box:door", "svc", [person(1)]);
  const now = [...h.store.keys()].filter((k) => /^door_known:box:door:\d+$/.test(k)).length;
  ok("4. the leftover parts go", now < was, `${was} → ${now}`);
  ok("4. and it reads back as itself", (await h.doorKnown("box:door")).people.length === 1);
}

// ── 5. The faces go when the service does ─────────────────────────────────
//
// These entries hold face codes, and the rule is that face data lives for
// one service. The register's copy has always gone at this moment. The
// door's had no such moment at all — it sat in storage until some later
// service happened to write over it.
{
  const h = hub();
  await h.saveDoorKnown("box:door", "svc", Array.from({ length: 500 }, (_, i) => person(i)));
  ok("5. it is there while the service runs",
     [...h.store.keys()].some((k) => k.startsWith("door_known:")));
  await h.forgetDoorKnown("box:door");
  ok("5. and every part of it goes when told",
     [...h.store.keys()].filter((k) => k.startsWith("door_known:")).length === 0,
     [...h.store.keys()].filter((k) => k.startsWith("door_known:")).join(" "));
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("5. which is what the end of a service does",
     /await this\.forgetDoorKnown\(c\.camera_id\)/.test(worker.slice(worker.indexOf("async endSession"))));
}

// ── 6. A record written before this change is still readable ──────────────
{
  const h = hub();
  await h.ctx.storage.put("door_known:box:door", { service: "svc", people: [person(1), person(2)] });
  const back = await h.doorKnown("box:door");
  ok("6. the old shape is read as it always was", back.people.length === 2, `${back.people.length}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
