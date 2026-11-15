/**
 * "your showing me the same pictures constantly, theres a bug"
 *
 * The same two people, put up again and again, with the same two pictures.
 *
 * The register keeps a map called `ruled`: every pair of people somebody
 * has already been asked about, and what they said. Nothing is asked twice
 * because of it — and it lived only in memory.
 *
 * The website is a Durable Object. It is put to sleep whenever it goes
 * quiet and built again on the next request, several times an hour on a
 * normal morning. The register itself survives that, because it is written
 * down. `ruled` was not. So every time the website woke up:
 *
 *   · every pair already asked about became askable again, and
 *   · every pair somebody had ANSWERED became askable again too.
 *
 * Which is also why answering the questions never seemed to help — "when i
 * answer the questions, it brings no value to the system". The answer was
 * written into the thing that was about to be forgotten.
 *
 * It is written down now, with the register and not beside it: a pair names
 * two people by their number in THIS morning's register, and next week's
 * register gives those numbers to somebody else.
 *
 *   node tests/test_what_was_asked_is_remembered.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IdentityRegistry } from "../worker/identity.js";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const reg = () => new IdentityRegistry({ zoneOf: (c) => c, createsIdentities: () => true });

// ── What was asked survives being put to sleep ────────────────────────────
{
  const before = reg();
  before.ruled.set("hall#7|3", true);      // answered: the same person
  before.ruled.set("hall#9|4", false);     // answered: different people
  before.ruled.set("hall#11|5", null);     // asked, still on the screen

  const written = before.rulings();
  ok("all three are written down", written.length === 3, `${written.length}`);
  ok("the answered ones are first, so they are the last to be dropped",
     written[0][1] !== null && written[1][1] !== null && written[2][1] === null,
     JSON.stringify(written));

  // …the website goes to sleep, and is built again.
  const after = reg();
  after.restoreRulings(JSON.parse(JSON.stringify(written)));
  ok("the answered pairs come back", after.ruled.get("hall#7|3") === true
     && after.ruled.get("hall#9|4") === false);
  ok("and so does the one still waiting", after.ruled.has("hall#11|5"));
  ok("so none of the three can be asked about again",
     ["hall#7|3", "hall#9|4", "hall#11|5"].every((p) => after.ruled.has(p)));
  ok("a pair nobody has been asked about is still askable",
     !after.ruled.has("hall#12|6"));
}

// ── Reading back rubbish changes nothing ──────────────────────────────────
{
  const r = reg();
  r.ruled.set("hall#1|1", true);
  for (const junk of [null, undefined, "nonsense", 42, [null], [[]], [[1, 2]]]) {
    r.restoreRulings(junk);
  }
  ok("nothing it cannot read is let in", r.ruled.size === 1, `${r.ruled.size}`);
  // …and what is already known is not overwritten by a later, emptier copy.
  r.restoreRulings([["hall#1|1", null]]);
  ok("an answer is not downgraded to 'asked' by a stale copy",
     r.ruled.get("hall#1|1") === true);
}

// ── A new service starts clean ────────────────────────────────────────────
{
  const r = reg();
  r.ruled.set("hall#7|3", true);
  r.startService("sunday-2");
  ok("a new service forgets them, because the numbers mean somebody else now",
     r.ruled.size === 0, `${r.ruled.size}`);
}

// ── The website writes them down, and throws them out with the register ───
{
  const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("they are read back when the register is",
     /this\.register\.restoreRulings\(await this\.get\("ruled", \[\]\)\);/.test(worker));
  const save = worker.slice(worker.indexOf("async saveRegister()"), worker.indexOf("async forgetRegister()"));
  ok("and written whenever the register is written",
     /await this\.saveRuled\(\);/.test(save));
  // …but never able to fail the register's own save. Losing the record of
  // what was asked costs a repeated question; losing the register costs
  // the morning's attendance. The small one does not get to break the big
  // one — the mistake the doorway's memory made.
  ok("and never able to take the register down with it",
     /try \{\n\s*await this\.saveRuled\(\);\n\s*\} catch/.test(save));
  ok("thrown away with the register, not kept past it",
     /await this\.ctx\.storage\.delete\("ruled"\);/.test(worker));
  ok("and capped by bytes, since one stored value holds 128 KB",
     /if \(bytes \+ size > SAFE_VALUE_BYTES\) break;/.test(worker));
}

// ── The cap keeps the answers and drops the rest ──────────────────────────
// A pair is a short string, but "short" is not a number to guess at — so
// this measures what actually fits and checks the right things survive.
{
  const SAFE = Number(/const SAFE_VALUE_BYTES = ([0-9_]+)/.exec(
    fs.readFileSync(path.join(root, "worker/venue.js"), "utf8"))?.[1].replace(/_/g, ""));
  ok("the website says how much room one value has", SAFE > 0, `${SAFE}`);

  const r = reg();
  for (let i = 0; i < 20_000; i++) r.ruled.set(`camera-one#${i}|${i % 900}`, null);
  for (let i = 0; i < 500; i++) r.ruled.set(`camera-one#a${i}|${i}`, true);   // answered
  const all = r.rulings();
  const kept = [];
  let bytes = 2;
  for (const e of all) {
    const size = JSON.stringify(e).length + 1;
    if (bytes + size > SAFE) break;
    kept.push(e); bytes += size;
  }
  ok("a morning's worth of pairs still fits inside one value",
     bytes <= SAFE, `${bytes} bytes`);
  ok("and every answer somebody gave is kept",
     kept.filter(([, v]) => v !== null).length === 500,
     `${kept.filter(([, v]) => v !== null).length} of 500 answers survived`);
  console.log(`   (${kept.length} of ${all.length} pairs fit in ${bytes} of ${SAFE} bytes)`);
}

console.log(fails ? `\n${fails} failed` : "\nAll good. What was asked stays asked.");
process.exit(fails ? 1 : 0);
