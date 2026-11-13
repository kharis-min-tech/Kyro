/**
 * Press a seat, see the person in it.
 *
 * "you see the seat section UI, where it has the dots, as i press one of the
 * seats from the seat map, i should be able to see a live view/section, i
 * should be able to see the actual person and them on the seat, not just a
 * UI design."
 *
 * Two faults behind that screenshot, and the second is the reason the first
 * was never noticed:
 *
 *   - The panel drew a diagram of coloured dots marked SCHEMATIC, because
 *     inDemoMode() read "there is no FastAPI backend" as "this is a demo".
 *     That variable is unset on every Cloudflare build — which is the one
 *     the church runs. So the live site called itself a demo.
 *   - Even when it did show a picture it showed the WHOLE camera view: a
 *     hundred-odd chairs in a rectangle the size of a stamp, in which no
 *     particular seat can be made out at all.
 *
 *   node tests/test_the_seat_shows_the_person.mjs
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
const near = (a, b, slack = 0.5) => Math.abs(a - b) <= slack;

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-seatview-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/seatCloseUp.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { closeUp, usableBox, SEAT_SPACE_W, SEAT_SPACE_H, AROUND } =
  await import(path.join(tmp, "seatCloseUp.js"));

// A frame the size the panel actually gives it.
const W = 232, H = 150;
/** Where a point in the photograph lands in the frame. */
const where = (v, p) => ({
  x: v.left + (p[0] / SEAT_SPACE_W) * v.picW,
  y: v.top + (p[1] / SEAT_SPACE_H) * v.picH,
});

// ── 1. The seat is in the middle, wherever it is in the picture ───────────
{
  for (const [name, b] of [
    ["middle", [600, 330, 700, 400]],
    ["top left", [20, 10, 120, 80]],
    ["bottom right", [1150, 640, 1270, 715]],
    ["back row, small", [610, 180, 650, 215]],
  ]) {
    const v = closeUp(b, W, H);
    const mid = where(v, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    ok(`1. a seat at the ${name} is centred`,
       near(mid.x, W / 2) && near(mid.y, H / 2),
       `${Math.round(mid.x)},${Math.round(mid.y)} — wanted ${W / 2},${H / 2}`);
  }
}

// ── 2. The box drawn on top lands on the seat ─────────────────────────────
//
// The whole point is being able to see that Kyro has the seat in the right
// place. A box drawn from different sums than the picture is a box that
// lies about where Kyro thinks the seat is.
{
  const b = [300, 400, 420, 480];
  const v = closeUp(b, W, H);
  const tl = where(v, [b[0], b[1]]), br = where(v, [b[2], b[3]]);
  ok("2. the box starts where the seat starts", near(v.boxLeft, tl.x) && near(v.boxTop, tl.y),
     `${v.boxLeft},${v.boxTop} vs ${tl.x},${tl.y}`);
  ok("2. and ends where the seat ends",
     near(v.boxLeft + v.boxW, br.x) && near(v.boxTop + v.boxH, br.y));
  ok("2. and is inside the frame rather than off the edge of it",
     v.boxLeft > 0 && v.boxTop > 0 && v.boxLeft + v.boxW < W && v.boxTop + v.boxH < H,
     `${Math.round(v.boxLeft)},${Math.round(v.boxTop)} ${Math.round(v.boxW)}×${Math.round(v.boxH)}`);
}

// ── 3. It is actually zoomed in, and shows the neighbours ─────────────────
{
  const b = [600, 330, 700, 400];
  const v = closeUp(b, W, H);
  ok("3. the photograph is blown up, not squeezed into a stamp",
     v.picW > W * 2, `picture ${Math.round(v.picW)} wide in a ${W} frame`);
  // The seat must not fill the whole frame: a chair on its own could be any
  // chair in the building, and its neighbours are what say which one.
  ok("3. the seat does not fill the frame",
     v.boxW < W * 0.85 && v.boxH < H * 0.85,
     `${Math.round(v.boxW)}×${Math.round(v.boxH)} in ${W}×${H}`);
  ok("3. but is most of it, so it is plainly the subject",
     v.boxW > W * 0.2 || v.boxH > H * 0.2);
  // The frame shows AROUND times the seat, in whichever direction runs out
  // first — which is what "the seat, and its neighbours" means in numbers.
  ok("3. and the frame holds about AROUND times the seat",
     near(Math.min(W / v.boxW, H / v.boxH), AROUND, 0.01),
     `${(Math.min(W / v.boxW, H / v.boxH)).toFixed(2)}× — wanted ${AROUND}×`);
}

// ── 4. A seat with no real box is not zoomed to nothing ───────────────────
{
  ok("4. a sensible box is usable", usableBox([10, 10, 60, 60]));
  ok("4. a flat one is not", !usableBox([10, 10, 11, 60]));
  ok("4. and neither is a missing one", !usableBox(null) && !usableBox(undefined));
  const page = read("dashboard/src/app/seating/page.tsx");
  ok("4. so the panel checks before zooming", /usableBox\(seat\.bbox\)/.test(page));
}

// ── 5. The live site does not call itself a demo ──────────────────────────
//
// This is why she has never seen a picture here. NEXT_PUBLIC_API_URL is
// unset on every Cloudflare build, which is the church's.
{
  const page = read("dashboard/src/app/seating/page.tsx");
  ok("5. the page keeps no answer of its own", !/const inDemoMode = \(\) =>/.test(page));
  ok("5. it asks whether this is a demonstration, not whether a backend exists",
     /import \{ inDemoMode \} from "@\/lib\/mode";/.test(page));
  const mode = read("dashboard/src/lib/mode.ts");
  ok("5. and a live edge is never a demonstration",
     /return noBackend\(\) && !isEdgeLive\(\);/.test(mode));
}

// ── 6. The picture comes from the counting server, not a missing backend ──
{
  const page = read("dashboard/src/app/seating/page.tsx");
  ok("6. the panel asks the counting server for the picture",
     /useEdgeSnapshot\(edge \? cameraId : null, edge/.test(page));
  ok("6. and shows the seat, not the whole hall",
     /<SeatCloseUp src=\{shown\} bbox=\{seat\.bbox\}/.test(page));
  ok("6. the old backend feed is not also started on the edge",
     /if \(inDemoMode\(\) \|\| edge\) \{ setSnapshotSrc\(null\); return; \}/.test(page));
  // A photograph every two seconds is not live video, and saying "LIVE" over
  // a still picture is the kind of label that gets believed.
  ok("6. it says what it is actually showing",
     /edge && !edgeLive \? "PHOTO" : "LIVE"/.test(page));
  ok("6. and says the camera is off rather than drawing a diagram of it",
     /"CAMERA OFF"/.test(page));
}

// ── 7. Nothing else on that page quietly changed hands ───────────────────
//
// Making inDemoMode() tell the truth means every OTHER demo check on this
// page now answers "no" on the live site, where it used to answer "yes".
// Each one has to be reached through isEdgeLive() first, or it falls into a
// branch that calls a FastAPI backend the church's build has not got — and
// those failures are caught and swallowed, so the button simply does
// nothing and says it worked. "Reset" was exactly that: it asked a dead
// address to clear the reservations, and the reserved seats stayed put.
{
  const page = read("dashboard/src/app/seating/page.tsx");
  ok("7. clearing reservations goes to where they are kept",
     /if \(isEdgeLive\(\)\) \{[\s\S]{0,400}edgeVenueApi\.reserveSeats\(camera\.camera_id, ids, false\)/.test(page));
  ok("7. …taking the ones that are actually reserved",
     /edgeSeats\.seats\.filter\(\(s\) => s\.reserved \|\| s\.state === "reserved"\)/.test(page));
  ok("7. and says so if it fails, rather than swallowing it",
     /Couldn't clear the reservations/.test(page));
  ok("7. with the seat map re-read afterwards", /edgeSeats\.reload\(\);/.test(page));

  // Every demo branch on this page is behind an edge check, or is the seat
  // panel's own. A new one that is neither is the bug above, again.
  const lines = page.split("\n");
  const loose = [];
  lines.forEach((l, i) => {
    if (!/\binDemoMode\(\)/.test(l)) return;
    if (/^\s*[/*]/.test(l)) return;                       // a note, not a test
    if (/\|\| edge\b|\|\| noPicture\b/.test(l)) return;      // the seat panel's own
    if (/\? "SCHEMATIC"/.test(l)) return;
    const before = lines.slice(Math.max(0, i - 12), i).join("\n");
    if (/isEdgeLive\(\)/.test(before)) return;            // reached only off the edge
    loose.push(`${i + 1}: ${l.trim()}`);
  });
  ok("7. no demo branch is reachable on the live site unchecked", loose.length === 0, loose.join("\n   "));
}

// ── 8. It does not call the camera dead while the picture is coming ──────
{
  const page = read("dashboard/src/app/seating/page.tsx");
  ok("8. a picture on its way is not a camera that is off",
     /noPicture \? \(waited \? "CAMERA OFF" : "LOOKING…"\)/.test(page));
  ok("8. and nothing is drawn until the frame has a size to draw in",
     /size && size\.w > 0 && size\.h > 0 \? closeUp/.test(page));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
