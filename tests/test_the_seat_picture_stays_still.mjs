/**
 * The picture you draw seats on does not move.
 *
 * "seat editor is still broken, the pictures keep changing when its meant
 * to be fixed, i dont know why."
 *
 * Seats are drawn on top of a picture and saved as positions IN that
 * picture. A picture that changes under the drawing puts every seat
 * somewhere slightly wrong, and nothing afterwards can tell which picture a
 * layout was drawn on.
 *
 * Two things were wrong, and neither was the fetching itself:
 *
 *   · the editor was taken off the page whenever the chosen camera was
 *     momentarily missing from the camera list — and that list is refetched
 *     every ten seconds. One failed poll removed the picture, the seats
 *     drawn on it and not yet saved, and then put it all back with a fresh
 *     picture;
 *   · nothing on the screen ever said the picture was a still, so there was
 *     no way to tell, and no way to take a new one on purpose.
 *
 *   node tests/test_the_seat_picture_stays_still.mjs
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
const editor = read("dashboard/src/components/ui/SeatLayoutEditor.tsx");
const page = read("dashboard/src/app/layout-editor/page.tsx");

// ── 1. The picture is taken once and never by itself again ────────────────
{
  ok("1. it is fetched when the camera changes and at no other time",
     /useEffect\(\(\) => \{ loadBackgroundFromCamera\(\); \}, \[loadBackgroundFromCamera\]\);/.test(editor));
  ok("1. and what it depends on is only the camera",
     /\}, \[cameraId\]\);/.test(editor.slice(editor.indexOf("const loadBackgroundFromCamera"))));
  ok("1. nothing puts it on a timer",
     !/setInterval/.test(editor), "setInterval in the editor");
  /**
   * Two places fetch it now, and only one of them is automatic.
   *
   * The second is the button that draws on the last picture Kyro has —
   * because counting runs in a browser, so a camera sends pictures only
   * while the Live cameras page is open, and the editor was unusable the
   * rest of the time. It never fires by itself, which is what this checks:
   * the picture still cannot change under a drawing unless somebody asks
   * for a different one.
   */
  const fetches = (editor.match(/\/api\/live\/snapshot\//g) ?? []).length;
  ok("1. and only two places ask the camera for it", fetches === 2, `${fetches}`);
  ok("1. the second being a button, never a timer or an effect",
     /onClick=\{useLastPicture\}/.test(editor)
     && !/useEffect\([^)]*useLastPicture/.test(editor));
}

// ── 2. A failed poll does not throw the drawing away ──────────────────────
//
// The camera list is refetched every ten seconds, and the editor used to be
// mounted only while the chosen camera was in the answer.
{
  ok("2. the editor is not conditioned on this moment's camera list",
     !/\(!edge \|\| cameras\.some\(\(c\) => c\.camera_id === cameraId\)\) && <>/.test(page));
  ok("2. it stays once the camera has been seen",
     /hadCamera\.current === cameraId/.test(page) && /hadCamera = useRef<string \| null>\(null\)/.test(page));
  // …but it is remembered PER camera, or switching to another one would
  // show the editor for a camera that does not exist.
  ok("2. and that memory is of this camera, not of any camera",
     /if \(cameras\.some\(\(c\) => c\.camera_id === cameraId\)\) hadCamera\.current = cameraId;/.test(page));
}

// ── 3. The page says what the picture is ──────────────────────────────────
{
  ok("3. it says the picture is a still and when it was taken",
     /Still picture, taken at/.test(editor) && /bgTakenAt/.test(editor));
  ok("3. and that it does not move while you draw",
     /It does not move while you draw/.test(editor));
  ok("3. with a deliberate way to take a new one",
     /Take a new picture/.test(editor) && /onClick=\{loadBackgroundFromCamera\}/.test(editor));
  ok("3. and the time is set when the picture actually arrives, not when it was asked for",
     /img\.onload = \(\) => \{ setBgImage\(img\); setBgTakenAt\(new Date\(\)\); \};/.test(editor));
}

// ── 4. A camera that is off shows nothing, not yesterday ──────────────────
//
// Already true, and worth keeping: a layout drawn over a photograph of a
// different day puts every seat in the wrong place.
{
  ok("4. no picture rather than an old one",
     /Kyro deliberately won't show the last one it had/.test(editor));
  ok("4. and the line above says so too", /No picture — the camera is off\./.test(editor));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
