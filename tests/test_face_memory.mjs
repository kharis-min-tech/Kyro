/**
 * Face codes live for one service, and really do go when it ends.
 *
 * They were held in memory only, which sounded like the careful choice and was
 * not. The live-cameras server restarts on every deploy; each restart lost
 * every face, and the congregation had to be recognised by their coats alone.
 * Twenty five people became twenty nine — four counted twice by a privacy
 * measure that protected nobody, because the data was being processed either
 * way, just badly.
 *
 * Keeping them is only defensible if ending the service really removes them.
 * That is what this checks: not that the code says so, but that after each of
 * the ways a service can end there is nothing left.
 *
 *   node tests/test_face_memory.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};
const root = path.resolve(import.meta.dirname, "..");

// ── A stand-in for the Durable Object's SQL, so the real statements run ────
class FakeSql {
  constructor() { this.rows = []; }
  exec(q, ...args) {
    const like = (s) => q.replace(/\s+/g, " ").includes(s);
    if (like("CREATE TABLE")) return { toArray: () => [] };
    if (like("INSERT OR REPLACE INTO faces")) {
      const [service, person, code, at] = args;
      this.rows = this.rows.filter((r) => !(r.service === service && r.person === person));
      this.rows.push({ service, person, code, at });
      return { toArray: () => [] };
    }
    if (like("SELECT person, code FROM faces")) {
      const [service, after] = args;
      return { toArray: () => this.rows.filter((r) => r.service === service && r.at > after) };
    }
    if (like("DELETE FROM faces WHERE service != ? OR at <= ?")) {
      const [keep, older] = args;
      this.rows = this.rows.filter((r) => r.service === keep && r.at > older);
      return { toArray: () => [] };
    }
    if (like("DELETE FROM faces")) { this.rows = []; return { toArray: () => [] }; }
    return { toArray: () => [] };
  }
}

// The real methods, lifted out of the worker and given that SQL.
const src = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const cut = (name, until) => {
  const from = src.indexOf(`\n  ${name}`);
  return src.slice(from, src.indexOf(`\n  ${until}`));
};
const body = cut("saveFaces(service, now) {", "async theBuilding()");
ok("the three face methods were found", /saveFaces/.test(body) && /loadFaces/.test(body) && /wipeFaces/.test(body));

const FACE_MAX_AGE_MS = Number((src.match(/const FACE_MAX_AGE_MS = ([^;]+);/) || [])[1]
  ?.replace(/[^0-9*]/g, "").split("*").reduce((a, b) => a * Number(b), 1)) || 12 * 3600_000;
ok("faces expire in hours, not days", FACE_MAX_AGE_MS <= 24 * 3600_000, `${FACE_MAX_AGE_MS / 3600_000} h`);

// Node's Buffers are POOLED: `Buffer.from(...).buffer` is the whole pool, not
// just this buffer, so reading it back as a Float32Array gives somebody else's
// bytes. It cost half an hour and looked exactly like the face matching being
// broken.
const packFace = (v) => Buffer.from(Float32Array.from(v).buffer).toString("base64");
const unpackFace = (b64) => {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};
const Host = new Function("packFace", "unpackFace", "FACE_MAX_AGE_MS", `
  return class { constructor(ctx, register) { this.ctx = ctx; this.register = register; }
    wrong() { return Promise.resolve(); }
    ${body}
  };`)(packFace, unpackFace, FACE_MAX_AGE_MS);

const face = (n) => Float32Array.from({ length: 8 }, (_, i) => Math.sin(n * 3.1 + i));
function registerWith(n, service) {
  const r = new IdentityRegistry({ zoneOf: () => "Main" });
  r.startService(service);
  for (let i = 1; i <= n; i++) {
    r.people.set(i, { id: i, firstAt: 0, lastAt: 0, seen: 3, uncertain: 0, cameras: new Set(["west"]),
      lastCamera: "west", looks: [], faces: [face(i)], seat: null, seatKey: null, seatAt: 0, seatCamera: "" });
  }
  r.nextId = n + 1;
  return r;
}

// ── Kept for the service ───────────────────────────────────────────────────
{
  const sql = new FakeSql();
  const reg = registerWith(25, "svc-morning");
  const host = new Host({ storage: { sql } }, reg);
  const now = 1_000_000;
  const wrote = host.saveFaces("svc-morning", now);
  ok("every face is written once", wrote === 25 && sql.rows.length === 25, `${wrote} written`);
  ok("writing again writes nothing new", host.saveFaces("svc-morning", now + 1000) === 0);

  // The server restarts: a new register, restored from the snapshot, with no
  // faces on it — exactly what happens on a deploy.
  const after = new IdentityRegistry({ zoneOf: () => "Main" });
  after.restore(JSON.parse(JSON.stringify(reg.snapshot())));
  ok("a restored register has no faces of its own", [...after.people.values()].every((p) => !p.faces.length));
  const host2 = new Host({ storage: { sql } }, after);
  const back = host2.loadFaces("svc-morning", now + 2000);
  ok("and they are all given back", back === 25, `${back} restored`);
  ok("so everybody can be recognised again",
     [...after.people.values()].every((p) => p.faces.length === 1));
}

// ── The thing this is actually for ─────────────────────────────────────────
//
// Twenty five people, a restart, and the same people seen again on new track
// numbers. This is the measurement that was 29 before.
{
  const sql = new FakeSql();
  const look = (n) => {
    const a = (n * 2.399) % (Math.PI * 2);
    return [0.333 + 0.1 * Math.cos(a), 0.333 + 0.1 * Math.sin(a), 0.35,
      0.333 + 0.09 * Math.cos(a + 1.1), 0.333 + 0.09 * Math.sin(a + 1.1), 0.45, 2.5, 0.5];
  };
  const bigFace = (n) => {
    let seed = (n * 2654435761) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
    const v = new Float32Array(128);
    for (let i = 0; i < 128; i++) v[i] = rand();
    let m = 0; for (const x of v) m += x * x; m = Math.sqrt(m);
    for (let i = 0; i < 128; i++) v[i] /= m;
    return v;
  };
  const r = new IdentityRegistry({ zoneOf: () => "Main" });
  r.startService("svc-1");
  let t = 1000;
  for (let i = 1; i <= 25; i++) {
    for (let f = 0; f < 3; f++) { t += 400; r.observe("west", [{ track: i, look: look(i), face: bigFace(i), seat: `K${i}` }], t); }
  }
  ok("twenty five people", r.size === 25, `${r.size}`);
  const host = new Host({ storage: { sql } }, r);
  host.saveFaces("svc-1", t);

  // The backend restarts mid-service.
  const r2 = new IdentityRegistry({ zoneOf: () => "Main" });
  r2.restore(JSON.parse(JSON.stringify(r.snapshot())));
  const host2 = new Host({ storage: { sql } }, r2);
  host2.loadFaces("svc-1", t + 1000);
  for (let i = 1; i <= 25; i++) {
    for (let f = 0; f < 3; f++) { t += 400; r2.observe("west", [{ track: 9000 + i, look: look(i), face: bigFace(i), seat: `K${i}` }], t); }
  }
  console.log(`\n  25 people, backend restart, all seen again on new track numbers: Kyro counts ${r2.size}\n`);
  ok("nobody is counted twice after a restart", r2.size === 25, `${r2.size}`);
}

// ── And it really does go ──────────────────────────────────────────────────
{
  const sql = new FakeSql();
  const host = new Host({ storage: { sql } }, registerWith(10, "svc-a"));
  host.saveFaces("svc-a", 1_000_000);
  ok("ten faces kept", sql.rows.length === 10);

  // The service ends.
  host.wipeFaces();
  ok("the service ending removes every one", sql.rows.length === 0, `${sql.rows.length} left`);

  // A different service starts while the last one's faces are still there.
  // Two services, whose people are both numbered 1..5 — which is exactly how
  // a new service numbers them, and how "already saved" could skip them.
  host.register = registerWith(5, "svc-b");
  ok("the second service's faces are written despite the same numbers",
     host.saveFaces("svc-b", 2_000_000) === 5);
  host.register = registerWith(5, "svc-c");
  ok("and the third's too", host.saveFaces("svc-c", 2_100_000) === 5);
  ok("two services' faces are present", sql.rows.length === 10);
  host.wipeFaces("svc-c", 2_200_000);
  ok("starting a new service removes the old one's",
     sql.rows.every((r) => r.service === "svc-c") && sql.rows.length === 5, `${sql.rows.length}`);

  // The service NEVER ends — a camera computer switched off, a timer that
  // failed. The age limit must hold anyway: this is the case where a promise
  // about biometric data would otherwise quietly become indefinite.
  host.wipeFaces("svc-c", 2_100_000 + FACE_MAX_AGE_MS + 1);
  ok("faces go on age alone, even if the service never ended",
     sql.rows.length === 0, `${sql.rows.length} left after ${FACE_MAX_AGE_MS / 3600_000} h`);
}

// ── Nothing writes a face while face matching is off ───────────────────────
{
  ok("nothing is written while face matching is off",
     /const facesAllowed = \(await this\.privacy\(\)\)\.face_matching;[\s\S]{0,140}else this\.wipeFaces\(\);/.test(src));
  ok("switching it off removes what was written",
     /Switched off means switched off[\s\S]{0,220}this\.wipeFaces\(\);/.test(src));
  ok("a finished service removes them",
     /this\.faceCodes\.clear\(\);\s*\n\s*this\.wipeFaces\(\);/.test(src));
  ok("and the register goes with them", /this\.register\?\.startService\(null\);/.test(src));
  // A face code is never part of anything that leaves Kyro for a person to read.
  const diag = src.slice(src.indexOf("async healthReport()"), src.indexOf("async troubles()"));
  ok("no face data is in the health report", !/face.*code|faces:/i.test(diag));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Kept for the service, gone when it ends.");
process.exit(fails ? 1 : 0);
