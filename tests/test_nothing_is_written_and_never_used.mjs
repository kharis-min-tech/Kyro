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

// ── The same question, asked of the pages ──────────────────────────────────
//
// Methods nothing calls have an exact twin in the browser: components nothing
// renders. Asking found two whole settings that existed, worked, saved
// properly, and were on no page at all —
//
//   CountingSensitivity — "how sure must the AI be before it counts someone",
//     which is the dial for the complaint that ran through two days: a wall
//     counted as people at one end, a packed room counted as two at the other.
//   FindCameras — the whole route for adding a network camera.
//
// Neither was reachable. Both are now on the Cameras page.
{
  const SRC = path.join(root, "dashboard/src");
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
    }
    return out;
  };
  const files = walk(SRC);
  const whole = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  /**
   * Named one by one rather than pattern-matched, so leaving something out
   * of the pages is a decision somebody makes on purpose.
   *
   * Heatmap: a picture of where people sat, built for a page that was never
   * finished. InfoTooltip and ThemeAutoNote: spare furniture.
   * isUserChosenDemo: a second way of asking something there is already a way
   * to ask.
   */
  const ON_PURPOSE = new Set(["Heatmap", "InfoTooltip", "ThemeAutoNote", "isUserChosenDemo"]);
  const orphans = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const [, name] of src.matchAll(/^export (?:async )?function ([A-Z]\w*)/gm)) {
      if (ON_PURPOSE.has(name)) continue;
      if ([...whole.matchAll(new RegExp("\\b" + name + "\\b", "g"))].length <= 1) {
        orphans.push(`${f.replace(SRC + "/", "")} → ${name}`);
      }
    }
  }
  ok("every panel the pages define is rendered somewhere", orphans.length === 0, orphans.join("\n   "));
  const cameras = fs.readFileSync(path.join(root, "dashboard/src/app/cameras/page.tsx"), "utf8");
  ok("the counting-sensitivity dial is on the Cameras page", /<CountingSensitivity \/>/.test(cameras));
  ok("and so is Find cameras", /<FindCameras$/m.test(cameras) || /<FindCameras /.test(cameras));
}

// ── A threshold nothing applies is a setting that does nothing ─────────────
//
// The third shape of the same bug. A method nothing calls, a panel nothing
// renders, and a number nothing reads: all of them look like working code,
// all of them pass review, and none of them does anything. The first two cost
// a congregation's faces on every restart and a room-full alert that never
// once went out.
{
  const dirs = [path.join(root, "worker"), path.join(root, "dashboard/src")];
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(f, out); }
      else if (/\.(ts|tsx|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(f);
    }
    return out;
  };
  const files = dirs.flatMap((d) => walk(d));
  const code = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
  // Tests count as a use: a threshold may be exported purely so a test can
  // check the value it is set to, which is a real use and a good one.
  const everywhere = Object.values(code).join("\n")
    + fs.readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".mjs"))
        .map((f) => fs.readFileSync(path.join(root, "tests", f), "utf8")).join("\n");
  const dead = [];
  for (const f of files) {
    for (const [, name] of code[f].matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]{3,})\s*=/gm)) {
      if ([...everywhere.matchAll(new RegExp("\\b" + name + "\\b", "g"))].length <= 1) {
        dead.push(`${f.replace(root + "/", "")} → ${name}`);
      }
    }
  }
  ok("every threshold and limit is applied somewhere", dead.length === 0, dead.join("\n   "));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. Nothing is written and left unused.");
process.exit(fails ? 1 : 0);
