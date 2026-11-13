/**
 * A bare 0 on the page, with nothing to explain it.
 *
 * "remove this, why is that there" — a lone nought above a card on the
 * Cameras page.
 *
 * In React, `{x && <Thing/>}` renders NOTHING when x is false, null or
 * undefined — and renders THE NUMBER when x is 0. So a guard that counts
 * something ("how many cameras are each in their own zone") prints a 0 on
 * the page on every screen where there is nothing to say. It is the one
 * falsy value that is not invisible, and it looks like a bug in the
 * figures rather than a bug in a condition.
 *
 * This walks every guard in every page and component, resolves what it is
 * bound to, and fails on any that can be a number.
 *
 *   node tests/test_no_stray_numbers_on_the_page.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const SRC = path.resolve(import.meta.dirname, "..", "dashboard/src");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (f.endsWith(".tsx")) files.push(f);
  }
})(SRC);

/** Can this expression be the number 0? */
function canBeZero(annotation, init) {
  if (/number/.test(annotation)) return true;
  return /return\s+0\s*;/.test(init)          // an IIFE or helper that gives up with 0
    || /^\s*0\s*[;,)]/.test(init)             // = 0
    || /\.length\s*[;,)]/.test(init)          // = something.length
    || /:\s*0\s*[;,)\n]/.test(init);          // … ? n : 0
}

const bad = [];
let guards = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\{\s*([^{}\n]*?)\s*&&\s*[(<]/g)) {
    const lhs = m[1].trim();
    const last = lhs.split("&&").pop().trim();
    // Only bare names: anything with a comparison in it has already said
    // what it means.
    if (!/^[A-Za-z_$][\w$]*$/.test(last)) continue;
    guards++;
    const d = new RegExp(`\\b(?:const|let)\\s+${last}\\b\\s*(:[^=]*)?=\\s*([\\s\\S]{0,400})`).exec(src);
    if (!d) continue;
    if (canBeZero(d[1] ?? "", d[2])) {
      const line = src.slice(0, m.index).split("\n").length;
      bad.push(`${f.replace(SRC + "/", "")}:${line}  {${lhs} && …   ← ${last} can be 0`);
    }
  }
}

ok(`no guard can print a bare number (${guards} guards in ${files.length} files)`,
   bad.length === 0, bad.join("\n   "));

// …and the one that did is written the way it should be.
{
  const cameras = fs.readFileSync(path.join(SRC, "app/cameras/page.tsx"), "utf8");
  ok("the two-cameras-one-room warning asks whether there are any, not whether it is truthy",
     /!loading && sameRoomWarning > 0 && \(/.test(cameras));
  ok("…and it is still a count, so the sentence beneath it still has a number to use",
     /You have \{sameRoomWarning\} cameras/.test(cameras));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
