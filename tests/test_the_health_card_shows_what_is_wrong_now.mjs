/**
 * What is wrong now, and nothing else.
 *
 * The health card carried two things she asked to be rid of:
 *
 *   · "Fixed, but worth knowing about" — everything that had gone wrong and
 *     then come right, with how many times and over what stretch, standing
 *     there for ever. A fixed problem is not a job, and a list of what used
 *     to be wrong is the thing somebody reads and scrolls past before they
 *     can see what IS wrong.
 *   · "⚠ No register yet, so attendance is each camera's own count" — a
 *     caveat about a figure whose own card already says what it is.
 *
 * The one thing that must not change with them is the record itself. "Do
 * not delete or rewrite historical records to make the dashboard appear
 * correct." Nothing here deletes anything: the server keeps every problem,
 * fixed or not, exactly as it did. It is no longer printed.
 *
 *   node tests/test_the_health_card_shows_what_is_wrong_now.mjs
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
const onScreen = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const card = onScreen(read("dashboard/src/components/ui/SystemHealth.tsx"));

// ── 1. Off the card ───────────────────────────────────────────────────────
{
  ok("1. the list of already-fixed problems is gone",
     !/Fixed, but worth knowing about/.test(card) && !/p\.fixed\)\.slice/.test(card));
  ok("1. and the debugging line under it",
     !/live-cameras code \{h\.code\}/.test(card) && !/Checked \{when\(h\.checked_at\)\}/.test(card));
  ok("1. and the warning about where attendance comes from",
     !/No register yet/.test(card));
  ok("1. …while it still says so when there IS a register",
     /Attendance is the register of people/.test(card));
}

// ── 2. The record is not touched ──────────────────────────────────────────
//
// This is the half that matters. Taking something off a screen and deleting
// it are different acts, and only one of them is what was asked for.
{
  const health = read("worker/health.js");
  const body = (name) => {
    const at = health.indexOf(`\n  ${name}(`);
    return at < 0 ? "" : health.slice(at, health.indexOf("\n  }", at));
  };
  ok("2. a problem that comes right is marked fixed, not removed",
     /v\.fixed = true; v\.fixedAt = now;/.test(body("ok")) && !/delete\(/.test(body("ok")));
  ok("2. and putting one aside only marks it too",
     /v\.fixed = true; v\.fixedAt = now; v\.asideBy =/.test(body("aside")) && !/delete\(/.test(body("aside")));
  /**
   * Two places DO delete, and both are right to.
   *
   * forget() is for a camera that no longer exists, which is somebody
   * saying so. prune() caps the store — and refuses to drop a live problem
   * to make room, which is how a failure vanishes from a dashboard with
   * nobody having fixed it.
   */
  ok("2. nothing else deletes anything",
     (health.match(/\.delete\(/g) ?? []).length === 2
     && /forget\(where\)/.test(health)
     && /filter\(\(\[, v\]\) => v\.fixed\)/.test(body("prune")),
     `${(health.match(/\.delete\(/g) ?? []).length} deletes`);
  ok("2. the server still hands over every problem it has",
     /const problems = t\.list\(now\);/.test(read("worker/venue.js")));
}

// ── 3. "Put aside" still says what it does ────────────────────────────────
//
// It used to say the problem "moves down to Fixed, but worth knowing
// about". That place no longer exists, and a button that describes where
// something went to a place that is not there is worse than no note.
{
  ok("3. it does not point at a section that is gone",
     !/moves down to/.test(card));
  ok("3. it says the problem is kept, not deleted",
     /doesn&apos;t delete it — it is kept, it stops being shown here/.test(card));
  ok("3. and that it comes back if it happens again",
     /comes\s+straight back if it happens again/.test(card));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
