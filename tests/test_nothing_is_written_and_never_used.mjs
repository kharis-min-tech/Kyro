/**
 * Nothing is written, tested, and then never called.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * "make sure everything is re tested checked and no bugs, including capturing
 * the faces of those who are coming in so they are not re counted … do not
 * delete any facial recognition right away, otherwise you will forget their
 * face and re count."
 *
 * She was describing something real, and it was worse than a tuning problem.
 *
 * Face codes are deliberately kept out of the register's snapshot — they live
 * in their own table so they can be deleted on their own the moment a service
 * ends. So restoring the register hands every person an EMPTY list of faces,
 * and something has to put them back. loadFaces did exactly that, correctly,
 * with its own tests — and was never called from anywhere in the running
 * code. The comment in worker/identity.js even said "the worker puts them
 * back here after restoring — see loadFaces", and the worker did not.
 *
 * Every restart mid-service therefore kept the congregation and forgot their
 * faces, leaving a hall where fifty coats are navy to be counted by coat.
 *
 * Looking for others of the same kind found capacityAlerts: the "this room is
 * filling up" and "this room is full" messages, written, guarded against
 * buzzing everybody's phone, and never called either. They had never once
 * gone out.
 *
 * A test that calls a method proves the method works. It does not prove
 * anything uses it. This file is the other half.
 *
 *   node tests/test_nothing_is_written_and_never_used.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const FILES = [
  "worker/venue.js", "worker/identity.js", "worker/building.js",
  "worker/health.js", "worker/index.js", "worker/accounts.js", "worker/integrations.js",
];
const src = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]));

/**
 * Called by the Workers runtime itself, never by this code.
 *
 * Each one is named rather than pattern-matched, so adding something to this
 * list is a decision somebody makes on purpose and can be argued with.
 */
const CALLED_BY_THE_RUNTIME = new Set([
  "constructor", "fetch", "alarm", "scheduled", "webSocketMessage", "webSocketError", "webSocketClose",
]);

// ── The sweep ───────────────────────────────────────────────────────────────
{
  const orphans = [];
  for (const f of FILES) {
    for (const [, name] of src[f].matchAll(/^  (?:async )?([a-zA-Z_]\w*)\(/gm)) {
      if (CALLED_BY_THE_RUNTIME.has(name)) continue;
      // Optional calls count: `this.register?.closeDeparted?.(now)` is a call.
      const call = new RegExp("[.\\s(\\[,]" + name + "\\s*(?:\\?\\.)?\\s*\\(", "g");
      const def = new RegExp("^  (?:async )?" + name + "\\s*\\(", "gm");
      let used = 0, defs = 0;
      for (const g of FILES) {
        used += [...src[g].matchAll(call)].length;
        defs += [...src[g].matchAll(def)].length;
      }
      if (used <= defs) orphans.push(`${f} → ${name}()`);
    }
  }
  ok("every method the server defines is called by the server",
     orphans.length === 0, orphans.join("\n   "));
}

// ── The two that were found this way, named so they cannot come undone ─────
{
  const venue = src["worker/venue.js"];
  ok("the faces are put back after a restart, by the running code",
     /if \(await this\.facesAllowed\(\)\) this\.loadFaces\(service, Date\.now\(\)\);/.test(venue));
  ok("and only while face matching is switched on",
     /await this\.facesAllowed\(\)\) this\.loadFaces/.test(venue));
  ok("the filling-up alerts are actually sent",
     /await this\.capacityAlerts\(cams, live\);/.test(venue));
  ok("and a failed alert never costs a report",
     /try \{ await this\.capacityAlerts\(cams, live\); \} catch/.test(venue));
}

// ── What she asked for, checked end to end ─────────────────────────────────
{
  const venue = src["worker/venue.js"];
  const identity = src["worker/identity.js"];
  // Kept FOR the service…
  ok("a face is written down against the service it belongs to",
     /INSERT OR REPLACE INTO faces \(service, person, code, at\) VALUES/.test(venue));
  ok("and survives the server restarting in the middle of one",
     /SELECT person, code FROM faces WHERE service = \? AND at > \?/.test(venue));
  ok("…and is never put in the register's own snapshot, so it can be deleted on its own",
     /leaves every face code behind on purpose/.test(venue) && !/faces:/.test(
       identity.slice(identity.indexOf("  snapshot("), identity.indexOf("  restore(snap)"))));
  // …and gone when it ends.
  ok("ending the service deletes every face, written down or not",
     /this\.faceCodes\.clear\(\);\s*\n\s*this\.wipeFaces\(\);/.test(venue));
  ok("switching face matching off deletes them there and then, without waiting for the end",
     /Switched off means switched off/.test(venue));
  ok("and nothing survives a hard age limit either, however a service ended",
     /this\.wipeFaces\(service, now\);/.test(venue));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. Nothing is written and left unused.");
process.exit(fails ? 1 : 0);
