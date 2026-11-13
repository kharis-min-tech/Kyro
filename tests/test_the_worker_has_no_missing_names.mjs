/**
 * Nothing in the worker calls something that does not exist.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * "theres a problem — These counts are not reaching Kyro. The website didn't
 * accept the counts (500)."
 *
 * Three separate names that were never declared, found in one afternoon:
 *
 *   `service` and `faceOk`, used in report() where neither exists, which
 *   threw on EVERY report and stopped counting reaching the website at all.
 *
 *   `packFace`, called by saveFaces since the day it was written. Nothing of
 *   that name has ever existed here, so every attempt to write a face threw,
 *   was swallowed by the try round the register, and reported as vague
 *   trouble with "Register of people". No face has ever been written down.
 *   The table they were supposedly kept in has always been empty — which
 *   makes the other face fault from today worse than it looked: the method
 *   to put them back was never called, and there was nothing to put back.
 *
 * The browser half of Kyro is TypeScript and could never have shipped any of
 * these. The worker is plain JavaScript, and nothing was checking it.
 *
 *   node tests/test_the_worker_has_no_missing_names.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");

/**
 * Globals the Cloudflare runtime provides and TypeScript does not know about
 * without the Workers types installed. Named one by one so that adding to
 * this list is a decision somebody makes, not a hole that widens.
 */
const FROM_THE_RUNTIME = /WebSocketPair|WebSocketRequestResponsePair|DurableObject/;

{
  let out = "";
  try {
    execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
      "--allowJs", "--checkJs", "--noEmit", "--target", "es2022",
      "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck",
      ...fs.readdirSync(path.join(root, "worker")).filter((f) => f.endsWith(".js"))
        .map((f) => path.join(root, "worker", f)),
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  // TS2304 "Cannot find name" and TS2552 "Cannot find name — did you mean"
  // are exactly the fault: something called that does not exist.
  const missing = out.split("\n")
    .filter((l) => /error TS2304|error TS2552/.test(l))
    .filter((l) => !FROM_THE_RUNTIME.test(l));
  ok("every name the worker uses is one that exists", missing.length === 0, missing.join("\n   "));
}

// ── The three that were found this way, named so they cannot come back ─────
{
  const venue = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
  ok("report() knows which service is running",
     /const service = \(await this\.get\("service_live", null\)\)\?\.id \?\? null;/.test(venue));
  /**
   * …in the code, not in the prose. The note explaining this very bug names
   * faceOk, and a check that cannot tell a comment from an expression would
   * fail on the explanation of the thing it is checking.
   */
  const reportBody = venue.slice(venue.indexOf("  async report(device, request) {"),
                                 venue.indexOf("  async rememberPeople"))
    .split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  ok("and uses its own name for whether faces may be read", !/faceOk/.test(reportBody));
  ok("which is faceOn, and it exists", /const faceOn = mayReadFaces/.test(venue));
  ok("a face can actually be written down", /^function packFace\(v\) \{/m.test(venue));
  ok("…in the same form it is read back in",
     /function unpackFace\(b64\)/.test(venue) && /128 numbers as float16, little/.test(venue));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. Nothing calls what isn't there.");
process.exit(fails ? 1 : 0);
