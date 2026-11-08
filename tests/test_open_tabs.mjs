/**
 * A deploy must not break the tab someone already has open.
 *
 * Next names every page file after its contents, so each deploy publishes a
 * new set and the old set stops existing. A tab that was already open still
 * asks for the old names the moment someone opens another section of Kyro —
 * gets nothing — and the app reloads itself in front of whoever is using it.
 * Deploy three times during a service and it happens three times, which is
 * exactly what was reported: "it's always refreshing".
 *
 * So the deploy carries the last few days of page files along with the new
 * ones. Nothing stale is served: the page decides which files to ask for, and
 * a reloaded page asks for the new ones.
 *
 *   node tests/test_open_tabs.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(root, "scripts/deploy-and-verify.sh"), "utf8");

// The real function, lifted out of the deploy script and run on a scratch copy.
const from = script.indexOf("keep_old_chunks() {");
const to = script.indexOf("\n}", from) + 2;
ok("the deploy script has the step", from > 0 && to > from);
const fn = script.slice(from, to);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-tabs-"));
const OUT = path.join(tmp, "out");
const ARCHIVE = path.join(tmp, "archive");
fs.mkdirSync(path.join(OUT, "_next/static/chunks"), { recursive: true });
fs.mkdirSync(path.join(ARCHIVE, "chunks"), { recursive: true });

// Yesterday's deploy left these behind; a tab opened then still wants them.
fs.writeFileSync(path.join(ARCHIVE, "chunks/page-OLDHASH.js"), "yesterday");
// …and a file whose name hasn't changed but whose contents have.
fs.writeFileSync(path.join(ARCHIVE, "chunks/webpack.js"), "yesterday's webpack");

// Today's build.
fs.writeFileSync(path.join(OUT, "_next/static/chunks/page-NEWHASH.js"), "today");
fs.writeFileSync(path.join(OUT, "_next/static/chunks/webpack.js"), "today's webpack");

execFileSync("bash", ["-c", `set -e; OUT="${OUT}"; ARCHIVE="${ARCHIVE}"; ${fn}; keep_old_chunks`], { stdio: "pipe" });

const served = (p) => fs.existsSync(path.join(OUT, "_next/static", p));
const text = (p) => fs.readFileSync(path.join(OUT, "_next/static", p), "utf8");

// 1. The open tab's file is there, so opening another section doesn't reload.
ok("yesterday's page file is still served", served("chunks/page-OLDHASH.js"));

// 2. Today's build is all there too.
ok("today's page file is served", served("chunks/page-NEWHASH.js"));

// 3. And the crucial one: a file that exists in BOTH must be today's. Serving
//    yesterday's copy of a same-named file would be shipping old code, which
//    is a far worse bug than the one being fixed.
ok("a file in both builds is today's, not yesterday's",
   text("chunks/webpack.js") === "today's webpack", `got "${text("chunks/webpack.js")}"`);

// 4. Today's files join the archive, so tomorrow's deploy keeps today's tabs.
ok("today's files are kept for tomorrow",
   fs.existsSync(path.join(ARCHIVE, "chunks/page-NEWHASH.js")));
ok("and the archive's copy of a changed file is updated too",
   fs.readFileSync(path.join(ARCHIVE, "chunks/webpack.js"), "utf8") === "today's webpack");

// 5. It doesn't grow for ever.
ok("old files are dropped after a few days", /-mtime \+3 -delete/.test(script));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good. A deploy no longer reloads the page someone is using.");
process.exit(fails ? 1 : 0);
