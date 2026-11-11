/**
 * A page left open says when it is out of date.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Every deploy publishes a new set of page files, each named after its
 * contents, and keeps the old set alongside for three days so a tab already
 * open never breaks halfway through a service. That is the right trade. It
 * has exactly one cost: a page left open goes on running the old code for
 * ever, in silence.
 *
 * That cost was paid in full in one evening. Four deploys were made during a
 * service while the page doing the counting ran the code from before any of
 * them. Every fix looked like it had failed — "still not 114", "this is not
 * working", "i dont understand" — and the honest answer each time was that
 * the fix had never reached the screen. Nothing on the page said so, because
 * nothing on the page knew.
 *
 * Now each build is named, the name is compiled into the pages and published
 * beside them, and a page that finds a different name says so.
 *
 *   node tests/test_an_open_page_knows_it_is_old.mjs
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
const deploy = read("scripts/deploy-and-verify.sh");
const banner = read("dashboard/src/components/ui/NewVersion.tsx");
const layout = read("dashboard/src/app/layout.tsx");

// ── The build gets a name, and both halves get the same one ─────────────────
{
  ok("each build is named", /^BUILD="\$\(git rev-parse --short HEAD/m.test(deploy));
  ok("the name is compiled into the pages",
     /NEXT_PUBLIC_KYRO_BUILD="\$BUILD" npm run build/.test(deploy));
  ok("and published beside them, as the same name",
     /printf '\{"build":"%s"\}' "\$BUILD" > "\$OUT\/build\.json"/.test(deploy));
  // Both from one variable, set once. Two stamps worked out separately would
  // differ by a second and every page would call itself out of date for ever.
  const uses = [...deploy.matchAll(/\$BUILD/g)].length;
  ok("from one variable, so the two can never disagree", uses >= 2, `${uses} uses`);
  ok("and the deploy says which build it is", /this build is \$BUILD/.test(deploy));
  // The archive is what makes this necessary; it must still be there.
  ok("old files are still kept, so an open tab never breaks",
     /rsync -a --ignore-existing "\$ARCHIVE\/" "\$OUT\/_next\/static\/"/.test(deploy));
}

// ── What the page does with it ──────────────────────────────────────────────
{
  ok("the page knows its own build", /process\.env\.NEXT_PUBLIC_KYRO_BUILD \?\? ""/.test(banner));
  ok("and asks the server what the current one is", /fetch\("\/build\.json", \{ cache: "no-store" \}\)/.test(banner));
  ok("never from a cache, since that is the whole question", /cache: "no-store"/.test(banner));
  ok("it says nothing when it cannot tell",
     /if \(!MINE\) return;/.test(banner) && /if \(!stop && theirs && theirs !== MINE\) setStale\(true\);/.test(banner));
  ok("and nothing when the check itself fails",
     /catch \{ \/\* offline, or the file isn't there: say nothing \*\/ \}/.test(banner));
  ok("it looks again when somebody comes back to the tab",
     /document\.addEventListener\("visibilitychange", onShow\);/.test(banner));
  ok("and lets go of both the timer and the listener",
     /clearInterval\(id\); document\.removeEventListener\("visibilitychange", onShow\);/.test(banner));
  ok("it offers the button that fixes it", /window\.location\.reload\(\)/.test(banner));
  // Never a forced reload: somebody counting a service decides when their
  // own screen restarts.
  ok("and never reloads the page by itself",
     !/useEffect\([^)]*window\.location\.reload/.test(banner)
     && /onClick=\{\(\) => window\.location\.reload\(\)\}/.test(banner));
  ok("it says what being out of date MEANS, not just that it is",
     /anything just fixed will not show here until it is reloaded/.test(banner));
}

// ── On every page, not just one ─────────────────────────────────────────────
{
  ok("it is in the layout, so every page has it", /<NewVersion \/>/.test(layout));
  ok("and imported there", /import \{ NewVersion \} from "@\/components\/ui\/NewVersion";/.test(layout));
}

// ── And it can be read off the screen ───────────────────────────────────────
//
// The banner only helps a page new enough to have it. A page older than the
// banner itself shows nothing — and finding out which version somebody is
// looking at meant fetching the live files and comparing them by hand, five
// times in one evening. So the version is printed where anybody can read it
// out: on "Is Kyro working?", which is the card you are already looking at
// when you doubt what Kyro is telling you.
{
  const health = read("dashboard/src/components/ui/SystemHealth.tsx");
  ok("the health card knows its own build", /const BUILD = process\.env\.NEXT_PUBLIC_KYRO_BUILD \?\? "";/.test(health));
  ok("and prints it", /This page is running \{BUILD\}/.test(health));
  ok("saying nothing when there is nothing to say", /\{BUILD && \(/.test(health));
}

// ── A figure that cannot be fixed here still says why ───────────────────────
//
// "its still not 114", six times, about a control that was never on her
// screen: the line offering to set the seat count renders only for somebody
// allowed to set one. For anybody else there was no control, no reason and
// no sign that a seat count was the missing thing. The failure and the
// silence looked identical.
{
  const card = read("dashboard/src/components/ui/ArrivalTimes.tsx");
  ok("a tile can carry something true it cannot act on", /note\?: string;/.test(card));
  ok("and says so when the seats cannot be set from here",
     /note=\{!onSetSeats && !seats && usingRegister/.test(card));
  ok("naming where they CAN be set",
     /An administrator can set it on the Cameras page\./.test(card));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. A page that is out of date says so.");
process.exit(fails ? 1 : 0);
