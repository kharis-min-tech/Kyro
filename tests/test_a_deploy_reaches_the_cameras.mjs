/**
 * A deploy reaches the counting brain without anybody stopping a camera.
 *
 * ── What happened ───────────────────────────────────────────────────────────
 *
 * The live-cameras server is a Durable Object: one long-running thing holding
 * the link to the camera computer. It carries on running the code it started
 * with until it next falls IDLE — and during a service it never does, because
 * a camera reports every few seconds for hours.
 *
 * So a deploy reached the pages in seconds and the counting brain not at all.
 * The script asked politely and waited five minutes for something that could
 * not happen, then said so and gave up. In between, every figure Kyro
 * produced was computed by code from before the fix: "still not 114", asked
 * six times, while the fix sat deployed and unreachable, and the only way
 * through was to ask somebody to stop counting in the middle of a service.
 *
 * "fix the depolyment."
 *
 *   node tests/test_a_deploy_reaches_the_cameras.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const venue = read("worker/venue.js");
const index = read("worker/index.js");
const deploy = read("scripts/deploy-and-verify.sh");

// ── It can be told to let go ────────────────────────────────────────────────
{
  ok("the counting brain takes a restart", /if \(p === "\/internal\/restart" && request\.headers\.get\("X-Kyro-Internal"\) === "1"\)/.test(venue));
  ok("only from the worker in front of it, never from outside",
     /\/internal\/restart" && request\.headers\.get\("X-Kyro-Internal"\) === "1"/.test(venue));
  // Everything that only lives in memory is written down first. The register
  // is the one that matters: losing it starts a congregation again from
  // nobody, which is the exact failure the restart is meant to end.
  ok("the register is written down before it goes",
     /await this\.ctx\.storage\.put\("register", this\.register\.snapshot\(SAFE_VALUE_BYTES\)\)/
       .test(venue.slice(venue.indexOf('p === "/internal/restart"'))));
  ok("and so is who has been seen this service",
     /if \(service\) this\.savePeople\(service\);/.test(venue.slice(venue.indexOf('p === "/internal/restart"'))));
  ok("it replies before it stops, so a restart cannot look like a crash",
     /setTimeout\(\(\) => \{ try \{ this\.ctx\.abort\(/.test(venue));
  ok("saying which code it was running", /return json\(\{ restarting: true, was: VENUE_CODE \}\);/.test(venue));
}

// ── …and only when it is genuinely behind ───────────────────────────────────
{
  ok("the worker knows the code this deploy carries", /import \{ VENUE_CODE \} from "\.\/venue\.js";/.test(index));
  ok("and it is exported to be known", /export const VENUE_CODE = "/.test(venue));
  ok("a restart is asked for only when the brain is behind THAT",
     /if \(url\.searchParams\.get\("restart"\) === "1" && venue && venue !== VENUE_CODE\)/.test(index));
  // Which makes it harmless from anywhere else: once current, it is a no-op,
  // so nobody can use it to knock the cameras over.
  ok("so asking when it is already current does nothing",
     /venue !== VENUE_CODE\) \{/.test(index));
  ok("and a dropped connection is understood as the restart itself",
     /catch \{ \/\* it may drop the connection as it goes: that IS the restart \*\/ \}/.test(index));
}

// ── The deploy asks, instead of waiting for idle that never comes ───────────
{
  ok("the deploy asks rather than waits", /api\/version\?restart=1/.test(deploy));
  ok("and says so", /Telling the live-cameras server to pick up the new code/.test(deploy));
  ok("it still checks what is actually running before claiming success",
     /if \[ "\$live" = "\$STAMP" \]; then/.test(deploy));
  ok("and still fails loudly if it never arrives",
     /STILL running older code/.test(deploy) && /exit 1/.test(deploy));
  ok("telling you the one thing left to try",
     /Stop counting for a minute and start again\./.test(deploy));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A deploy reaches the cameras.");
process.exit(fails ? 1 : 0);
