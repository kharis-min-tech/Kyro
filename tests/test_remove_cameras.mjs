/**
 * Clearing out cameras that have gone.
 *
 * Old cameras pile up — a browser that registered again, a webcam tried once,
 * something called "m". Each is a row of red on the health panel saying
 * something true and useless, and the real problems get lost among them.
 *
 * Removing one must be easy, must say what it costs before it happens, and
 * must never quietly take the counts with it.
 *
 *   node tests/test_remove_cameras.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};
const root = path.resolve(import.meta.dirname, "..");
const view = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SystemHealth.tsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");

// ── The button ─────────────────────────────────────────────────────────────
{
  ok("every camera row has a remove button", /aria-label=\{`Remove \$\{c\.name\}`\}/.test(view));
  ok("and it is for administrators only", /\{admin && \(\s*\n\s*<button onClick=\{\(\) => \{ setRemoving\(c\)/.test(view));
  ok("there is one for the whole pile of dead ones",
     /Remove the \{gone\.length\} that have gone/.test(view));
  ok("which only offers cameras that have stopped reporting",
     /h\.cameras\.filter\(\(c\) => c\.state === "not reporting"\)/.test(view));
  ok("and only appears when there is more than one", /gone\.length > 1/.test(view));
}

// ── Asked first, in Kyro's own words ───────────────────────────────────────
{
  ok("it asks before removing one", /Remove “\{removing\.name\}” from Kyro\?/.test(view));
  ok("and before removing the pile", /Remove \{gone\.length\} cameras that have stopped reporting\?/.test(view));
  ok("the pile is listed by name, so nobody removes one they wanted",
     /\{gone\.map\(\(c\) => \(/.test(view));
  ok("it says what is lost", /Its name, its room, its seats and its settings go/.test(view));
  ok("and what is NOT lost, which is the part people worry about",
     /<strong>The counts it has already\s*\n?\s*recorded stay<\/strong>/.test(view.replace(/\s+/g, " "))
     || /The counts it has already recorded stay/.test(view.replace(/\s+/g, " ")));
  ok("and that a camera still plugged in will come back",
     /it comes back as a new camera and Kyro asks whether to/.test(view));
  // Asked in the page, not in one of the browser's own boxes — those appear
  // for reloads too and teach people to click through warnings.
  ok("nothing uses a browser confirm box", !/window\.confirm|confirm\(/.test(view));
}

// ── It does what it says ───────────────────────────────────────────────────
{
  ok("removing really removes, rather than hiding",
     /edgeVenueApi\.removeCamera\(removing\.camera_id, true\)/.test(view));
  // Bounded forwards from the method itself: slicing to a landmark that
  // happens to sit EARLIER in the file gives an empty string, and an empty
  // string passes any "does not contain" check silently.
  const from = worker.indexOf("async removeCamera(camera_id, permanent = false)");
  const remove = worker.slice(from, from + 1200);
  ok("the method was found", from > 0 && remove.includes("permanent ||"));
  ok("the camera, its seats and its last picture go", /storage\.delete\(`layouts:\$\{camera_id\}`\)/.test(remove)
     && /storage\.delete\(`snap:\$\{camera_id\}`\)/.test(remove));
  ok("but nothing touches the recorded counts", !/history/.test(remove), remove.slice(0, 200));
  ok("a half-finished tidy-up says so rather than claiming success",
     /Removed what it could, then stopped at \$\{c\.name\}/.test(view));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Easy to clear out, hard to do by accident.");
process.exit(fails ? 1 : 0);
