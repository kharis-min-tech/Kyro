/**
 * The welcome page, as a room you scroll through.
 *
 * Asked for as "more of a scroll-driven 3D website", with Lusion and Active
 * Theory as the references. What those do is tie a camera in a 3D scene to
 * the scrollbar, so moving down the page moves you through a space.
 *
 * Here that space is the hall. Scrolling flies a camera down the centre
 * aisle, lifts it over the seats to look down on the room the way the Seat
 * Map does, and brings it back to rest facing the stage — and the room
 * FILLS as you go, seat by seat, which is Kyro's whole job done as the
 * background.
 *
 * ── What this test is for ─────────────────────────────────────────────────
 *
 * An effect on the front page is worth having only if it stays cheap and
 * stays out of the way. Three things have to remain true, and all three are
 * easy to lose later without noticing:
 *
 *   · no megabyte of 3D library. This page is the first thing a church
 *     sees, on whatever phone they have, and the thing it must do is
 *     explain Kyro. The hall is a few hundred identical boxes on a flat
 *     floor, which is a page of arithmetic, not a graphics engine.
 *   · scrolling must not re-render the page. Scroll fires far more often
 *     than a page can usefully redraw; putting it in state would make the
 *     one thing the effect is for — the camera move — stutter.
 *   · somebody who has asked for less motion gets a still room.
 *
 *   node tests/test_the_welcome_page_flies_through_the_hall.mjs
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

const root = path.resolve(import.meta.dirname, "..");
const scene   = fs.readFileSync(path.join(root, "dashboard/src/components/landing/HallScene.tsx"), "utf8");
const landing = fs.readFileSync(path.join(root, "dashboard/src/components/landing/Landing.tsx"), "utf8");
const css     = fs.readFileSync(path.join(root, "dashboard/src/components/landing/landing.module.css"), "utf8");
const pkg     = JSON.parse(fs.readFileSync(path.join(root, "dashboard/package.json"), "utf8"));

// ── It costs nothing to load ──────────────────────────────────────────────
{
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const heavy = ["three", "@react-three/fiber", "@react-three/drei", "babylonjs", "@babylonjs/core",
                 "ogl", "pixi.js", "gsap", "lenis", "@studio-freight/lenis"];
  const added = heavy.filter((d) => d in deps);
  ok("no 3D or scroll library was added for it", added.length === 0, added.join(", "));
  ok("and the scene is a canvas the page draws itself",
     /const ctx = canvas\.getContext\("2d"\);/.test(scene));
}

// ── The camera really is driven by the scrollbar ──────────────────────────
// The projection is the whole of the 3D, so it is run here rather than read.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-hall-"));
  /**
   * Lift the camera path out of the component and RUN it.
   *
   * It is the whole of the 3D — where you are in the room at each point
   * down the page — and a regular expression cannot tell whether a flight
   * path is smooth. So it is compiled and flown.
   */
  const src = scene.slice(scene.indexOf("const ramp ="), scene.indexOf("export function HallScene"));
  fs.writeFileSync(path.join(tmp, "cam.ts"), `${src}\nexport { ramp, mix, camera };\n`);
  execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
    path.join(tmp, "cam.ts"), "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
  ], { stdio: "inherit" });
  const { camera, ramp } = await import(path.join(tmp, "cam.js"));

  ok("nothing moves before you scroll", ramp(0, 0, 1) === 0);
  ok("and it is all the way there at the bottom", ramp(1, 0, 1) === 1);
  ok("it eases rather than steps", ramp(0.5, 0, 1) === 0.5 && ramp(0.25, 0, 1) < 0.25);

  const back = camera(0), middle = camera(0.5), end = camera(1);
  ok("you start at the back of the hall", back.z > 40, `z ${back.z}`);
  ok("scrolling takes you towards the stage", end.z < back.z && end.z < 16,
     `${back.z} → ${end.z}`);
  ok("and you never walk through it", end.z > 0, `z ${end.z}`);
  ok("halfway down you are above the seats, looking at the room",
     middle.y > 8 && middle.over > 0.3, `y ${middle.y}, over ${middle.over}`);
  ok("and you come back down to stand at the front",
     end.y < 6 && end.over < 1.01, `y ${end.y}`);
  // Every step has to be small, or the camera jumps rather than flies.
  let worst = 0, at = 0;
  let prev = camera(0);
  for (let i = 1; i <= 200; i++) {
    const c = camera(i / 200);
    const step = Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z);
    if (step > worst) { worst = step; at = i / 200; }
    prev = c;
  }
  ok("the whole path is smooth, with no jump in it", worst < 1.2,
     `biggest step ${worst.toFixed(2)}m at ${at}`);
}

// ── …without re-rendering the page on every scroll event ──────────────────
{
  ok("how far down the page we are is kept in a ref",
     /const scrolled = useRef\(0\);/.test(landing)
     && /const readScroll = useCallback\(\(\) => scrolled\.current, \[\]\);/.test(landing));
  ok("the scroll handler sets it without setting state",
     /scrolled\.current = room > 0 \? window\.scrollY \/ room : 0;/.test(landing));
  ok("and the scene reads it on its own frames",
     /const want = Math\.min\(1, Math\.max\(0, progress\(\)\)\);/.test(scene)
     && /raf = requestAnimationFrame\(frame\);/.test(scene));
  ok("the camera glides rather than snapping to the scrollbar",
     /shown \+= \(want - shown\) \* 0\.08;/.test(scene));
  ok("and it stops drawing when the tab is not being looked at",
     /document\.addEventListener\("visibilitychange", onVis\);/.test(scene)
     && /if \(!visible\) return;/.test(scene));
}

// ── Less motion means a still room ────────────────────────────────────────
{
  ok("the page already asks, and passes the answer on",
     /prefers-reduced-motion: reduce/.test(landing) && /still=\{still\}/.test(landing));
  ok("and a still room is drawn once, with no loop at all",
     /if \(still\) \{ shown = 0\.34; draw\(\); return \(\) => \{\}; \}/.test(scene));
  ok("the stylesheet quietens it too", /@media \(prefers-reduced-motion: reduce\)/.test(css));
}

// ── It stays out of the way of the page ───────────────────────────────────
{
  ok("the hall is decoration, not content",
     /aria-hidden="true"/.test(scene) && /<div className=\{s\.scene\} aria-hidden="true">/.test(landing));
  ok("nothing on it can be clicked", /pointer-events: none;/.test(css));
  ok("and everything else sits above it",
     /\.page > \*:not\(\.scene\) \{ position: relative; z-index: 1; \}/.test(css));
  ok("the words keep a dark backing so they stay readable",
     /rgba\(10, 10, 11, 0\.92\)/.test(css));
  // The page is still a page: the thing it is for is explaining Kyro.
  for (const bit of ["Demo or Live", "What it does", "Get ready", "Every seat."]) {
    ok(`"${bit}" is still on it`, landing.includes(bit));
  }
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The welcome page is a room you scroll through.");
process.exit(fails ? 1 : 0);
