/**
 * "On" has to mean it is working.
 *
 * Face matching was switched on this morning and the card said so: On,
 * running now, during the service. What it could not say — and what was
 * actually being asked — is whether any faces were being read at all.
 *
 * The face AI is a 10 MB download that runs in whichever browser is doing the
 * counting. If it fails to load, that browser carries on counting without it,
 * which is right for the count and silent in the wrong place: the person who
 * switched face matching on is looking at a card that says it is running.
 *
 *   node tests/test_face_status.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const worker = fs.readFileSync(path.join(root, "worker/venue.js"), "utf8");
const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/FaceMatching.tsx"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");

// 1. The website counts the cameras that actually sent face readings, and the
//    faces in them — not whether a switch is on.
{
  ok("the website reports how many cameras are sending faces", /face_cameras: faceFresh\.length/.test(worker));
  ok("and how many faces were in them", /face_people: faceFresh\.reduce/.test(worker));
  ok("counted from readings that are still fresh",
     /faceFresh = \[\.\.\.this\.faceCodes\.entries\(\)\]\.filter\(\(\[, f\]\) => faceNow - f\.at < FACE_FRESH_MS\)/.test(worker));
}

// 2. A browser that can't load the face AI says so, instead of going quiet.
{
  ok("the counting browser remembers why faces failed", /faceErr\.current = `The face AI wouldn't load/.test(ctx));
  ok("and sends it with the counts, alongside everything else that went wrong",
     /sendReport\(reports, \{ error: faceErr\.current, ready: !!faceEngine\.current \}, problems\.current\)/.test(ctx));
  ok("the report has somewhere to put it", /faces_error: faces\.error \?\? null/.test(cam));
  ok("the website keeps it", /await this\.ctx\.storage\.put\("face_error"/.test(worker));
  ok("and forgets it once faces work again",
     /body\.faces_error === null && await this\.get\("face_error", null\)/.test(worker)
     && /this\.ctx\.storage\.delete\("face_error"\)/.test(worker));
  ok("stale trouble isn't shown for ever", /faceNow - faceTrouble\.at < 5 \* 60_000/.test(worker));
}

// 2b. "Nobody's face is visible" is not "it isn't working". The browser says
//     whether the face AI is loaded and looking, separately from whether it
//     found anyone — a room of people facing the front shows the backs of
//     their heads, and nothing is wrong.
{
  ok("the browser says the AI is loaded and looking",
     /ready: !!faceEngine\.current/.test(ctx));
  ok("the website keeps that", /if \(body\.faces_ready\) await this\.ctx\.storage\.put\("face_ready_at", now\)/.test(worker));
  ok("and only counts it as now", /faceNow - faceReadyAt < 30_000/.test(worker));
  ok("the card has a state for it", /the face AI is loaded and looking at every count/.test(card));
  ok("and says 'working' for both good states",
     (card.match(/Working — /g) ?? []).length === 2);
}

// 3. The card says which of the three it is.
{
  ok("it says when faces are being read", /reading faces on \{faceCams\}/.test(card));
  ok("and says plainly when the AI isn't running", /On, but the face AI isn&apos;t running\./.test(card));
  ok("it shows the actual reason when there is one", /\{faceErr\s*\?\s*\n?\s*faceErr/.test(card.replace(/\s+/g, " ")) || /faceErr\s*\?\s*faceErr/.test(card.replace(/\s+/g, " ")));
  ok("and never claims the count is affected", /counting\s+itself is unaffected either way/.test(card));
}

// 4. Still only during a service, and still wiped when one ends — none of
//    this loosens what face data is for or how long it lives.
{
  ok("faces are read only during a service",
     /const faceOn = \(await this\.privacy\(\)\)\.face_matching && !!\(await this\.get\("service_live", null\)\)/.test(worker));
  // Wiped when it ends — BOTH the live copies and the ones written down. Face
  // codes are now kept for the length of a service rather than only in
  // memory, because holding them in memory alone meant a restart lost them
  // and people already counted were counted again. Keeping them is only
  // defensible if ending the service really removes them.
  ok("and wiped when it ends, in memory and on disk",
     /this\.faceCodes\.clear\(\);\s*\n\s*this\.wipeFaces\(\);/.test(worker));
  ok("switching face matching off wipes them too",
     /Switched off means switched off[\s\S]{0,200}this\.wipeFaces\(\);/.test(worker));
  ok("and nothing is written unless faces are allowed",
     /if \(await this\.facesAllowed\(\)\) this\.saveFaces\(service, now\);\s*\n\s*else this\.wipeFaces\(\);/.test(worker));
  ok("with a limit that does not depend on anything working",
     /const FACE_MAX_AGE_MS = /.test(worker)
     && /DELETE FROM faces WHERE service != \? OR at <= \?/.test(worker));
}

// 5. Reading faces often enough to be worth having.
//
//    Faces were read once every four seconds, for everybody in the picture.
//    At a doorway, where face matching is the whole point — people step out
//    and come back and must not be counted as arriving twice — someone
//    crosses in a second or two, so most people were never looked at once.
//    Switched on, and never read anybody.
{
  ok("a doorway camera reads faces much more often",
     /const DOOR_FACES_EVERY_MS = 1_200;/.test(ctx)
     && /c\.isDoor \? DOOR_FACES_EVERY_MS : FACES_EVERY_MS/.test(ctx));
  ok("rooms are unchanged", /const FACES_EVERY_MS = 4_000;/.test(ctx));
  // Which is only affordable because the cost is capped.
  ok("only the nearest few faces are read", /const MOST_FACES_AT_ONCE = 3;/.test(ctx)
     && /\.slice\(0, MOST_FACES_AT_ONCE\)/.test(ctx));
  ok("the nearest are chosen by how big they are", /size: p\.box\[3\] - p\.box\[1\]/.test(ctx));
  // And only if the codes come back against the right people. A list in the
  // wrong order would hand people each other's faces, which is worse than no
  // faces at all: it would merge two strangers into one person.
  ok("codes are lined up with the people they belong to",
     /const codes: \(Float32Array \| null\)\[\] = c\.people\.map\(\(\) => null\);/.test(ctx)
     && /nearest\.forEach\(\(person, k\) => \{ codes\[person\] = read\[k\] \?\? null; \}\);/.test(ctx));
  ok("and nothing is read when nobody is there", /if \(!c\.people\.length\) return null;/.test(ctx));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. On says whether it is working.");
process.exit(fails ? 1 : 0);
