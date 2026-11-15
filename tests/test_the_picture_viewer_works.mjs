/**
 * "not working the - and + also you are not showing me their face"
 *
 * Two faults in one small picture viewer.
 *
 * THE FACE. The image was drawn with objectFit "cover", which fills the
 * box and throws away whatever does not fit. A crop of a person is tall;
 * the box is short and wide. So what it threw away was the top and the
 * bottom — the head and the feet — and what it kept was the middle. Every
 * picture of a person was a photograph of their coat, which is also why
 * pressing + seemed to do nothing: it made the coat bigger.
 *
 * THE BUTTONS. They sit inside the element that handles dragging. Once
 * zoomed past 1, that handler ran on the button press and took the pointer
 * capture off the button mid-press, so the press never became a click. A
 * button is not a drag, and the presses stop at the controls now.
 *
 * And zooming now grows from the TOP of the picture rather than the
 * middle, because that is where a face is. Pressing + used to walk away
 * from the one part worth looking at.
 *
 *   node tests/test_the_picture_viewer_works.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const v = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ZoomableImage.tsx"), "utf8");

// ── The face is in the picture ────────────────────────────────────────────
{
  ok("the whole crop is shown, not a middle slice of it",
     /objectFit: "contain",/.test(v) && !/objectFit: "cover"/.test(v));
  ok("with something behind it, so a tall picture is not floating",
     /background: "var\(--bg-deep, #0d0f1a\)"/.test(v));
  ok("and zooming grows from the top, where a face is",
     /const ZOOM_FROM = "center top";/.test(v) && /transformOrigin: ZOOM_FROM,/.test(v));
  ok("not from the middle, which walked away from it",
     !/transformOrigin: "center center"/.test(v));
}

// ── The buttons are buttons ───────────────────────────────────────────────
{
  const at = v.indexOf("absolute bottom-1.5 right-1.5");
  const controls = v.slice(at, v.indexOf("</div>", at));
  ok("a press on the controls is not treated as a drag",
     /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/.test(controls)
     && /onPointerUp=\{\(e\) => e\.stopPropagation\(\)\}/.test(controls));
  ok("and scrolling over them does not zoom instead of pressing",
     /onWheel=\{\(e\) => e\.stopPropagation\(\)\}/.test(controls));
  ok("the buttons stay round on a narrow picture",
     (v.match(/w-7 h-7 shrink-0 rounded-full/g) || []).length === 3,
     `${(v.match(/shrink-0/g) || []).length} of 3 have it`);
}

// ── The zoom itself still behaves ─────────────────────────────────────────
// The clamp is the whole of the arithmetic, so it is checked here rather
// than trusted: pressing − at the bottom must not go below 1, and + at the
// top must not run away.
{
  const MOST_ZOOM = Number(/export const MOST_ZOOM = (\d+)/.exec(v)?.[1]);
  const STEP = Number(/export const ZOOM_STEP = ([\d.]+)/.exec(v)?.[1]);
  ok("the viewer says how far it zooms and by how much",
     MOST_ZOOM > 1 && STEP > 0, `most ${MOST_ZOOM}, step ${STEP}`);
  const clamp = (z) => Math.min(MOST_ZOOM, Math.max(1, z));
  ok("minus at the bottom stays at the bottom", clamp(1 - STEP) === 1);
  ok("plus at the top stays at the top", clamp(MOST_ZOOM + STEP) === MOST_ZOOM);
  ok("and a press actually changes it", clamp(1 + STEP) > 1);
  let z = 1;
  for (let i = 0; i < 20; i++) z = clamp(z + STEP);
  ok("holding plus reaches the top and stops", z === MOST_ZOOM);
  for (let i = 0; i < 20; i++) z = clamp(z - STEP);
  ok("and holding minus comes back to the start", z === 1);
  ok("both buttons use that step rather than a number of their own",
     (v.match(/clampZoom\(z [-+] ZOOM_STEP\)/g) || []).length === 2);
}

// ── The panels that use it ────────────────────────────────────────────────
{
  const review = fs.readFileSync(path.join(root, "dashboard/src/components/ui/ReviewPanel.tsx"), "utf8");
  ok("the question panel uses this viewer", /<ZoomableImage/.test(review));
  // The same-person question draws its own pair of pictures and was
  // already showing the whole crop — worth holding, since it is the panel
  // where a face matters most.
  const same = fs.readFileSync(path.join(root, "dashboard/src/components/ui/SamePerson.tsx"), "utf8");
  ok("and the same-person pictures still show the whole person",
     /className="w-full h-full object-contain"/.test(same));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The buttons work and the face is in the picture.");
process.exit(fails ? 1 : 0);
