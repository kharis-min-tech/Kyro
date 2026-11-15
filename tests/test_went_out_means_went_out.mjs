/**
 * "this shouldnt be accurate, it should be the people that actually leave,
 * not people who you dont see."
 *
 * A tile headed "Went out, since 9:53" reading 281, with "People nobody
 * has seen for five minutes" underneath it.
 *
 * She is right, and the card was arguing with itself. With a camera on the
 * door, that figure is people counted walking through it and "Went out" is
 * exactly what it is. Without one it comes from the register, where
 * somebody has "left" once nobody has seen them for five minutes — and
 * that is not leaving. That is being behind a pillar, out of shot, turned
 * away, or lost by a camera for a few minutes.
 *
 * The line underneath said so all along. The heading above it said they
 * went out, and a heading is what gets read.
 *
 * So the heading changes with the evidence, and the small print says what
 * would make it a real figure. The number itself does not change: it is
 * the best Kyro has either way, and nothing here rewrites it.
 *
 *   node tests/test_went_out_means_went_out.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const card   = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ArrivalTimes.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── Where each version of the figure comes from ───────────────────────────
{
  ok("the register's idea of leaving is not being seen for a while",
     /Anybody nobody has seen for five minutes has left/.test(worker));
  ok("and the card knows which source it is showing",
     /const usingRegister = !!movement && movement\.arrived\.length > 0 && !unverified;/.test(card));
}

// ── The heading only claims what was watched ──────────────────────────────
{
  ok('without a doorway it does not say "went out"',
     /usingRegister && heldLeft == null \? "Not seen for a while" : "Went out"/.test(card));
  ok("and with one, it does", /: "Went out"/.test(card));
  ok("the window is still on the heading either way",
     /`, since \$\{fmtTime\(sessionFrom\)\}`/.test(card) && /: ", all day"/.test(card));
}

// ── …and says what would make it real ─────────────────────────────────────
{
  const asRead = card.replace(/["`]\s*\n\s*\+\s*["`]/g, "");
  ok("it says plainly that this is not leaving",
     /Nobody has seen them for five minutes\. That is not the same as leaving/.test(asRead));
  ok("and names the one thing that would fix it",
     /set a camera on your entrance and Kyro can count who actually walks out/.test(asRead));
}

// ── The figure itself is untouched ────────────────────────────────────────
// Saying a number is not what it was called is not the same as changing it.
{
  ok("the value is the same number it always was",
     /value=\{\(heldLeft \?\? summary\.totalLeft\)\.toLocaleString\(\)\}/.test(card));
  ok("and the held version still says it is held",
     /Held with the figure beside it/.test(card));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Went out means went out.");
process.exit(fails ? 1 : 0);
