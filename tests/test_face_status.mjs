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
  ok("and sends it with the counts", /sendReport\(reports, faceErr\.current\)/.test(ctx));
  ok("the report has somewhere to put it", /faces_error: facesError/.test(cam));
  ok("the website keeps it", /await this\.ctx\.storage\.put\("face_error"/.test(worker));
  ok("and forgets it once faces work again",
     /body\.faces_error === null && await this\.get\("face_error", null\)/.test(worker)
     && /this\.ctx\.storage\.delete\("face_error"\)/.test(worker));
  ok("stale trouble isn't shown for ever", /faceNow - faceTrouble\.at < 5 \* 60_000/.test(worker));
}

// 3. The card says which of the two it is.
{
  ok("it says when faces are being read", /Reading faces on \{faceCams\}/.test(card));
  ok("and says plainly when they are not", /On, but no faces are being read\./.test(card));
  ok("it shows the actual reason when there is one", /\{faceErr\s*\?\s*\n?\s*faceErr/.test(card.replace(/\s+/g, " ")) || /faceErr\s*\?\s*faceErr/.test(card.replace(/\s+/g, " ")));
  ok("and never claims the count is affected", /the counting is\s+unaffected either way/.test(card));
}

// 4. Still only during a service, and still wiped when one ends — none of
//    this loosens what face data is for or how long it lives.
{
  ok("faces are read only during a service",
     /const faceOn = \(await this\.privacy\(\)\)\.face_matching && !!\(await this\.get\("service_live", null\)\)/.test(worker));
  ok("and wiped when it ends", /Face matching data belongs to the service: wiped as soon as it ends\.\s*\n\s*this\.faceCodes\.clear\(\);/.test(worker));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. On says whether it is working.");
process.exit(fails ? 1 : 0);
