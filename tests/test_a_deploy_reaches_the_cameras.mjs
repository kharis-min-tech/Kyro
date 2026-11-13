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
  // The register is written in as many parts as it needs now — one
  // stored value stopped at about seven hundred people. See saveRegister.
  ok("the register is written down before it goes",
     /await this\.saveRegister\(\)/
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
  /**
   * …and then leaves it alone.
   *
   * The server is evicted a few seconds after its last request, and that
   * eviction is what makes it pick up new code. Checking whether it has
   * restarted is itself a request to it — so a check every five seconds was
   * a request every five seconds, and the loop waiting for an idle moment
   * was the thing preventing one. It would have waited for ever and blamed
   * the server.
   */
  ok("it asks once rather than on every pass",
     /curl -s -o \/dev\/null "\$SITE\/api\/version\?restart=1"/.test(deploy));
  ok("and then stays quiet long enough for the server to fall idle",
     /sleep 30/.test(deploy) && !/sleep 5\b/.test(deploy));
  ok("the check itself no longer asks for a restart every time",
     /live=\$\(curl -s "\$SITE\/api\/version"/.test(deploy));
  ok("and says so", /Telling the live-cameras server to pick up the new code/.test(deploy));
  ok("it still checks what is actually running before claiming success",
     /if \[ "\$live" = "\$STAMP" \]; then/.test(deploy));
  ok("and still fails loudly if it never arrives",
     /STILL running older code/.test(deploy) && /exit 1/.test(deploy));
  /**
   * …and it is honest about the one deploy this cannot help.
   *
   * The handler that takes the restart lives inside the thing being
   * restarted, so the deploy that first introduces it still has to wait for
   * an idle moment. Measured the hard way: the pages went live, the server
   * stayed on yesterday's code, and the script reported a failure that was
   * really a bootstrap.
   */
  ok("it explains why the first one has to wait",
     /can only/.test(deploy) && /already running a version that contains it/.test(deploy));
  /**
   * It no longer GUESSES at what is keeping the server awake — it asks and
   * prints the answer. "my tab is not open … i dont know what your seeing"
   * was a fair reply to a message that blamed the browser tab five times
   * running without ever having looked.
   */
  ok("and names what is really keeping the server awake, from what it measures",
     /Something is keeping it awake\./.test(deploy)
     && /how many live/.test(deploy)
     && /it is not only this/.test(deploy));
}

// ── And when it does not arrive, it says WHY ────────────────────────────────
//
// "my tab is not open, deploy it because my tab is closed, i dont know what
// your seeing."
//
// A fair thing to say to a program that will not tell you. This server only
// picks up new code when it is evicted, and it is only evicted when nothing
// has spoken to it for a few seconds — and for five deploys running, all
// anybody could do was guess at what was holding it open: a browser tab, the
// counting computer, a phone, somebody else's laptop.
//
// Neither fact is a secret. How many live connections it holds and how long
// since anything spoke to it say nothing about anybody in the building.
{
  const venue = read("worker/venue.js");
  ok("the server counts the live connections holding it open", /this\.ctx\.getWebSockets\(\)\.length/.test(venue));
  ok("and says how long since anything spoke to it", /idle_s: Math\.round\(\(Date\.now\(\) - \(this\.lastSpokenTo \?\? 0\)\) \/ 1000\)/.test(venue));
  ok("which is recorded on every request it takes",
     /this\.lastSpokenTo = Date\.now\(\);/.test(venue));
  ok("it survives not being able to ask", /catch \{ sockets = -1; \}/.test(venue));
  const index = read("worker/index.js");
  ok("the version also says what the deployed pages EXPECT",
     /expects: VENUE_CODE/.test(index));
  ok("and only reports what is holding it when it is actually behind",
     /if \(body && body\.venue !== VENUE_CODE\) \{/.test(index));
  ok("the deploy prints it while it waits", /"holding":\{"sockets"/.test(deploy));
  ok("and stops blaming the browser tab alone",
     /the computer doing the counting holds a connection/.test(deploy));
}

// ── The check that was comparing against nothing ───────────────────────────
//
// The stamp line became `export const VENUE_CODE` the day the worker started
// importing it. This script's pattern only matched `^const`, so from that
// moment the stamp was never written into the file: every deploy genuinely
// succeeded, and the script sat waiting for the live server to report a stamp
// that had never been deployed. Six "it is still running old code" failures,
// every one of them false, and six messages sent to somebody telling her to
// close tabs that had nothing to do with it.
{
  ok("the stamp is found whether or not the line is exported",
     /\^\\\(export \\\)\*const VENUE_CODE/.test(deploy));
  ok("and writing it keeps the export", /\\1const VENUE_CODE = /.test(deploy));
  // The part that matters more than the pattern: never take it on trust.
  ok("and if the stamp does not go in, the script stops dead",
     /Could not write the stamp into worker\/venue\.js\./.test(deploy));
  ok("saying why that is worse than a failed deploy",
     /checking for code that was never deployed/.test(deploy));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A deploy reaches the cameras.");
process.exit(fails ? 1 : 0);
