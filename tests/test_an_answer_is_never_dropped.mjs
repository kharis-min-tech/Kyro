/**
 * "i write questions, but its like its forgotten, like kyro forgets the
 * anser."
 *
 * It did forget them, and it said "ok" while doing it.
 *
 * The register of people — the thing an answer corrects — was only ever
 * built while handling a CAMERA'S REPORT. An answer is a different
 * request. The website is put to sleep when it goes quiet and built again
 * on the next one, and that happens after every deploy as well, which on
 * a day of fixing things is many times an hour.
 *
 * So when an answer was the request that woke it, there was no register:
 *
 *     if (said !== null && this.register && q.ask) { ... }
 *
 * The whole correction was skipped, and the reply still said ok — not even
 * the "that was too late to act on" flag, which exists precisely so nobody
 * is told their answer landed when it did not. It looked like success.
 *
 * Two fixes, and the second matters as much as the first:
 *
 *   · the register is built wherever it is needed, from what is on disk —
 *     the same thing the report path did all along;
 *   · and an answer that changed nothing says so, always. A reply of "ok"
 *     has to mean the answer was used.
 *
 *   node tests/test_an_answer_is_never_dropped.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── The register can be built by whoever needs it ─────────────────────────
{
  ok("there is one way to get a register, and it builds one if needed",
     /async ensureRegister\(cams, service\) \{/.test(worker));
  ok("it never throws away a register that already exists",
     /if \(this\.register\) return this\.register;/.test(worker));
  ok("the report path uses it rather than building its own",
     /await this\.ensureRegister\(cams, service\);/.test(worker));
  ok("and nothing builds a register any other way",
     (worker.match(/this\.register = new IdentityRegistry\(/g) || []).length === 1,
     `${(worker.match(/this\.register = new IdentityRegistry\(/g) || []).length} places build one`);
  // Everything a restored register needs must still be put back — these
  // were each their own bug once.
  const at = worker.indexOf("async ensureRegister(cams, service) {");
  const body = worker.slice(at, worker.indexOf("\n  /**", at + 100));
  ok("…and a built register still gets what somebody said is not a person",
     /this\.register\.notPeople = await this\.get\("not_people", \[\]\);/.test(body));
  ok("…every question already asked",
     /this\.register\.restoreRulings\(await this\.get\("ruled", \[\]\)\);/.test(body));
  ok("…the congregation", /this\.register\.restore\(saved\);/.test(body));
  ok("…and their faces", /if \(await this\.facesAllowed\(\)\) this\.loadFaces\(service, Date\.now\(\)\);/.test(body));
}

// ── Answering builds one before it gives up ───────────────────────────────
{
  const at = worker.indexOf('if (q.review_type === "same_person_question")');
  const branch = worker.slice(at, at + 2600);
  ok("an answer makes sure there is a register to correct",
     /await this\.ensureRegister\(await this\.get\("cameras", \{\}\),/.test(branch));
  ok("from the service that is actually running",
     /\(await this\.get\("service_live", null\)\)\?\.id \?\? null\);/.test(branch));
  ok("and the correction still only runs when there is something to correct",
     /if \(said !== null && this\.register && q\.ask\) \{/.test(branch));
}

// ── "ok" means the answer was used ────────────────────────────────────────
{
  const at = worker.indexOf('if (q.review_type === "same_person_question")');
  const branch = worker.slice(at, at + 3200);
  ok("an answer that was too late to act on says so",
     /return json\(\{ ok: true, \.\.\.result, stale: true \}\);/.test(branch));
  ok("and so does one that was never acted on at all",
     /if \(said !== null && !result\) \{\n\s*return json\(\{ ok: true, changed: false, stale: true \}\);/.test(branch));
  // The failure this closes: every other branch fell through to a bare ok.
  ok("so a bare ok is no longer reachable with an answer in hand",
     branch.indexOf("if (said !== null && !result)")
     < branch.indexOf("return json({ ok: true, ...(result ?? {}) });"),
     "the catch-all still comes first");
}

console.log(fails ? `\n${fails} failed` : "\nAll good. An answer is used, or it says it wasn't.");
process.exit(fails ? 1 : 0);
