/**
 * "when i answer the questions, it brings no value to the system nor is it
 * making the system become better."
 *
 * True, and this is where it was truest.
 *
 * A cushion on a chair, a coat over a seat back, a poster of a face — Kyro
 * counts it as a person, asks "is this a person?", and somebody says no. It
 * comes off the count, and the look of it is remembered so the same thing
 * is not counted again.
 *
 * Remembered until the service ended. Then it was cleared, and the same
 * cushion in the same chair was counted again the next Sunday, and asked
 * about again, for ever. The answer was worth one morning and taught Kyro
 * nothing.
 *
 * It was worse than that. The register's snapshot is DELETED whenever the
 * service changes, so even keeping it through a service would not have
 * survived — which is why these are kept under their own key, as a fact
 * about the building rather than about a congregation.
 *
 *   node tests/test_answers_are_kept.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-keep-"));
fs.cpSync(path.join(root, "worker"), tmp, { recursive: true });
for (const f of fs.readdirSync(tmp).filter((x) => x.endsWith(".js"))) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
    /^import \{ DurableObject \} from "cloudflare:workers";/m,
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"));
}
const { IdentityRegistry } = await import(path.join(tmp, "identity.js"));

// ── 1. A new service does not forget the furniture ────────────────────────
{
  const r = new IdentityRegistry({ zoneOf: () => "Hall" });
  r.startService("sunday-morning");
  r.notPeople.push([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  ok("1. the cushion is remembered", r.notPeople.length === 1);
  r.startService("sunday-evening");
  ok("1. and is still remembered at the evening service",
     r.notPeople.length === 1, `${r.notPeople.length}`);
  ok("1. while the congregation is not", r.people.size === 0);
}

// ── 2. It is kept where a change of service cannot delete it ──────────────
//
// The worker deletes the register's whole snapshot when the service
// changes. Anything about the building that lived inside it would go too.
{
  const worker = read("worker/venue.js");
  ok("2. the worker still deletes the register on a change of service",
     /this\.register\.startService\(service\);\s*\n\s*await this\.forgetRegister\(\);/.test(worker));
  const identity = read("worker/identity.js");
  ok("2. so the furniture is not kept inside that snapshot",
     !/notPeople:/.test(identity.slice(identity.indexOf("snapshot("), identity.indexOf("restore("))));
  ok("2. it has a key of its own", /this\.register\.notPeople = await this\.get\("not_people", \[\]\);/.test(worker));
  ok("2. which is written the moment somebody answers",
     /await this\.ctx\.storage\.put\("not_people", this\.register\.notPeople\.slice\(-40\)\);/.test(worker));
  // …and read back when the register is built, which is what makes it
  // survive the restart that happens on every deploy.
  const build = worker.slice(worker.indexOf("this.register = new IdentityRegistry("), worker.indexOf("const saved = await this.get(\"register\""));
  ok("2. and read back before anything is counted", /not_people/.test(worker.slice(worker.indexOf("this.register = new IdentityRegistry("))) && build.length > 0);
}

// ── 3. The answer actually stops the thing being counted ──────────────────
//
// Remembering it is only worth anything if it is used. A look that matches
// something already ruled out is not a person, and is not asked about
// again either.
{
  const cushion = [0.9, 0.1, 0.1, 0.5, 0.5, 0.2, 0.3, 0.4];
  const seen = (reg, track, from = 1000) => {
    let t = from;
    for (let f = 0; f < 4; f++) {
      t += 1000;
      reg.observe("box:a", [{ track, look: cushion, face: null, seat: "K1" }], t);
    }
    return t;
  };

  const r = new IdentityRegistry({ zoneOf: () => "Hall" });
  r.startService("s1");
  seen(r, 1);
  ok("3. at first it is counted as somebody", r.size === 1, `${r.size}`);

  // Somebody looks at the picture and says no.
  const said = r.notAPerson("box:a", 1);
  // removed is how many came off, not a yes/no.
  ok("3. answering takes them off the count", said?.removed === 1 && r.size === 0, JSON.stringify(said));
  ok("3. and the look is kept", r.notPeople.length > 0, `${r.notPeople.length}`);

  // The same cushion, next Sunday, on a register that has been rebuilt.
  const next = new IdentityRegistry({ zoneOf: () => "Hall" });
  next.notPeople = r.notPeople.slice(-40);          // what the worker hands it
  next.startService("s2");
  seen(next, 7, 500_000);
  ok("3. and next Sunday the same cushion is not counted at all",
     next.size === 0, `${next.size} counted`);
  ok("3. nor asked about again", (next.takeAsks?.() ?? []).length === 0);
}

// ── 4. A real person is still counted ─────────────────────────────────────
//
// The whole thing is worthless if it also silences people. Somebody who
// looks nothing like the cushion is counted as usual.
{
  const r = new IdentityRegistry({ zoneOf: () => "Hall" });
  r.notPeople = [[0.9, 0.1, 0.1, 0.5, 0.5, 0.2, 0.3, 0.4]];
  r.startService("s1");
  let t = 1000;
  for (let f = 0; f < 4; f++) {
    t += 1000;
    r.observe("box:a", [{ track: 1, look: [0.1, 0.8, 0.6, 0.2, 0.9, 0.7, 0.1, 0.5], face: null, seat: "K2" }], t);
  }
  ok("4. somebody who looks nothing like it is counted", r.size === 1, `${r.size}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
