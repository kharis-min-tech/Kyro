/**
 * A green box is drawn where the person is.
 *
 * ── What happened ───────────────────────────────────────────────────────────
 *
 * "NOT ACCURATE" — a photograph of a crowded hall with five green boxes on
 * the ceiling light fittings and not one on a person. The congregation
 * underneath them had none at all.
 *
 * Nothing was wrong with the counting. The AI is given the picture scaled
 * down to COUNT_WIDTH — 1280 across for a room — and every box it returns is
 * in THAT picture's coordinates. The preview sized its canvas from the
 * CAMERA's picture instead. A camera sending 1920 across is counted at 1280,
 * so every box was drawn at two thirds of its real position: up and to the
 * left, onto the ceiling.
 *
 * That is worse than a counting mistake, because the picture is the thing
 * people check the counting against. A wrong number can be argued with; a
 * wrong number next to a box on a light fitting destroys the only evidence
 * anybody has.
 *
 * The same mistake was feeding the seat finder: who is sitting in which chair
 * was worked out from boxes in one picture against seats in another, so a
 * person two thirds of the way up the hall was put in somebody else's chair.
 *
 *   node tests/test_boxes_land_where_people_are.mjs
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
const preview = read("dashboard/src/components/ui/CameraPreview.tsx");
const ctx = read("dashboard/src/lib/CountingContext.tsx");
const card = read("dashboard/src/components/ui/CountingCard.tsx");
const mode = read("dashboard/src/lib/cameraMode.ts");

// ── The arithmetic, stated plainly ──────────────────────────────────────────
{
  // What the old code did, with her camera's numbers.
  const cameraW = 1920, cameraH = 1080, countW = 1280;
  const scale = Math.min(1, countW / cameraW);
  const grabW = Math.round(cameraW * scale), grabH = Math.round(cameraH * scale);
  // A man standing in the middle of the hall, in the picture the AI was given.
  const box = [600, 300, 760, 700];
  // Drawn on a canvas sized from the CAMERA, the same numbers mean somewhere else.
  const off = (1 - grabW / cameraW) * 100;
  console.log(`\n  A ${cameraW}-wide camera is counted at ${grabW}: every box drawn`
    + ` ${Math.round(off)}% too far up and to the left`);
  ok("the two pictures really are different sizes", grabW !== cameraW && grabH !== cameraH,
     `${grabW}x${grabH} vs ${cameraW}x${cameraH}`);
  ok("and they are the same shape, so an overlay still lines up",
     Math.abs(grabW / grabH - cameraW / cameraH) < 0.001);
  ok("a box in the middle of the picture would have been drawn a third of the way off",
     Math.round((box[0] / cameraW - box[0] / grabW) * cameraW) < -200);
}

// ── Where it is fixed ───────────────────────────────────────────────────────
{
  ok("the preview is told the picture the boxes were measured in",
     /frameW\?: number;/.test(preview) && /frameH\?: number;/.test(preview));
  ok("and sizes its canvas from that, not from the camera",
     /const w = frameW \|\| v\.videoWidth, h = frameH \|\| v\.videoHeight;/.test(preview));
  ok("redrawing when it changes", /\}, \[people, tracked, frameW, frameH\]\);/.test(preview));
  ok("the counting hands it the picture the AI was given",
     /frameW: c\.grabCanvas\.width \|\| c\.video\?\.videoWidth \|\| 0,/.test(ctx)
     && /frameH: c\.grabCanvas\.height \|\| c\.video\?\.videoHeight \|\| 0,/.test(ctx));
  ok("and the card passes it on", /frameW=\{v\.frameW\} frameH=\{v\.frameH\}/.test(card));
}

// ── The same mistake, in the seats ──────────────────────────────────────────
{
  ok("the seat finder is told the same picture",
     /const frameW = c\.grabCanvas\.width \|\| c\.video\?\.videoWidth \|\| 1280;/.test(ctx)
     && /const frameH = c\.grabCanvas\.height \|\| c\.video\?\.videoHeight \|\| 720;/.test(ctx));
  ok("for who is in which seat", /c\.seatFinder\.whoIsWhere\(\s*\n?\s*following\.map[\s\S]{0,120}frameW, frameH\)/.test(ctx));
  // …and from the same list of people as the line above it. It read the raw
  // detections, so the seat map and the register could disagree about where
  // somebody was sitting — and there was no stillness to tell somebody
  // standing at their chair from somebody walking past it.
  ok("and for which seats are taken",
     /c\.seatFinder\.occupancy\(\s*\n?\s*following\.map[\s\S]{0,160}frameW, frameH, Date\.now\(\), following\.map\(\(x\) => x\.stillFor\)\)/.test(ctx));
  ok("and the position sent to the register is in that picture too",
     /b: \[x\.box\[0\] \/ frameW, x\.box\[1\] \/ frameH, x\.box\[2\] \/ frameW, x\.box\[3\] \/ frameH\]/.test(ctx));
  ok("nothing interprets a box against the camera's own size any more",
     !/c\.video\?\.videoWidth \|\| 1280, c\.video\?\.videoHeight \|\| 720/.test(ctx));
}

// ── The thing that makes them differ, still in place ────────────────────────
{
  ok("the AI is still given a smaller picture on purpose",
     /const scale = Math\.min\(1, maxWidth \/ vw\);/.test(mode));
  ok("and the boxes it returns are in that picture", /ctx\.drawImage\(video, 0, 0, w, h\);/.test(mode));
}

console.log(fails ? `\n${fails} FAILED` : "\nAll good. The box is where the person is.");
process.exit(fails ? 1 : 0);
