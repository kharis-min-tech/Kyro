/**
 * Moving around Kyro must never reload the page.
 *
 * The thing being guarded against: the browser IS the counter. A reload
 * unloads the AI, closes the cameras and sets every figure back to nothing.
 * One row on the Attendance page sent people to the Seat Map with
 * window.location.href, so opening the Seat Map mid-service wiped the count —
 * "when I leave the section, the count goes".
 *
 * Signing in and out are different: they are meant to start afresh.
 *
 *   node tests/test_no_reload_navigation.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(root, "dashboard/src");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

// Leaving Kyro altogether is allowed to reload; moving inside it is not.
const LEAVING = /^\/login/;
const offenders = [];
for (const file of walk(srcDir)) {
  const text = fs.readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    const m = line.match(/(?:window\.)?location\.(?:href\s*=|assign\()\s*["'`](\/[^"'`]*)/);
    if (!m || LEAVING.test(m[1])) return;
    offenders.push(`${path.relative(root, file)}:${i + 1} → ${m[1]}`);
  });
}

ok("no page inside Kyro is reached by reloading the browser", offenders.length === 0,
   offenders.join("\n   "));

// The row that caused it specifically.
{
  const att = fs.readFileSync(path.join(srcDir, "app/attendance/page.tsx"), "utf8");
  ok("the Attendance row opens the Seat Map without a reload",
     /router\.push\("\/seating"\)/.test(att) && !/location\.href\s*=\s*"\/seating"/.test(att));
}

// Signing in and out still may, because starting afresh is the point.
{
  const guard = fs.readFileSync(path.join(srcDir, "components/ui/PageGuard.tsx"), "utf8");
  ok("being signed out still starts afresh", /location\.href\s*=\s*"\/login"/.test(guard));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Moving between sections keeps the count.");
process.exit(fails ? 1 : 0);
