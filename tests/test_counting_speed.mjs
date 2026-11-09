/**
 * Fast enough to see somebody walk through a door.
 *
 * A person crosses a doorway in well under a second, and has to be seen TWICE
 * to be counted at all — twice is the only way to know which way they were
 * going. A camera managing 1.3 counts a second sees them once, so it counted
 * the slow walkers and missed everybody else: "0 in, 1 out" with a service
 * walking through it.
 *
 * Four things were costing that time, none of them the AI itself.
 *
 *   node tests/test_counting_speed.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name}${detail ? `\n   ${detail}` : ""}`); }
};

const root = path.resolve(import.meta.dirname, "..");
const cam = fs.readFileSync(path.join(root, "dashboard/src/lib/cameraMode.ts"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
const wrk = fs.readFileSync(path.join(root, "dashboard/src/lib/countWorker.ts"), "utf8");
const order = fs.readFileSync(path.join(root, "dashboard/src/lib/countOrder.ts"), "utf8");

// 1. Eight megabytes a count, copied for nothing.
//
//    Kyro asks every camera for 1920x1080, takes all two million pixels off
//    the video at four bytes each, and copies the lot to the counter — which
//    resizes it to 640 or 1280 square as its very first act. At three counts a
//    second that is twenty-four megabytes a second of copying that no part of
//    the answer depends on.
{
  ok("the picture is taken at the size the AI will use", /export function grab\(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxWidth = COUNT_WIDTH\)/.test(cam));
  ok("and scaled down rather than cropped", /const scale = Math\.min\(1, maxWidth \/ vw\);/.test(cam));
  ok("a doorway takes a smaller one still", /const DOOR_WIDTH = 960;/.test(cam)
     && /c\.isDoor \? DOOR_WIDTH : COUNT_WIDTH/.test(ctx));

  // What that saves, in the only terms that matter: bytes moved per count.
  const bytes = (w, h) => w * h * 4;
  const before = bytes(1920, 1080);
  const room = bytes(1280, 720), door = bytes(960, 540);
  console.log(`\n  Pixels copied per count: was ${(before / 1e6).toFixed(1)} MB`
    + ` · room camera now ${(room / 1e6).toFixed(1)} MB (${(before / room).toFixed(1)}x less)`
    + ` · doorway now ${(door / 1e6).toFixed(1)} MB (${(before / door).toFixed(1)}x less)\n`);
  ok("a room camera moves at least half as many pixels", room <= before / 2);
  ok("a doorway camera at least four times fewer", door <= before / 4);
}

// 2. Five AI runs where one would do. Splitting a picture into tiles finds
//    people too small to see whole, which is worth it across a hall and
//    pointless a step from a door.
{
  ok("a doorway never splits its picture into tiles", /const useTiles = !c\.isDoor &&/.test(ctx));
  ok("nor spends a count checking whether it should", /const checking = !c\.isDoor &&/.test(ctx));
}

// 3. The accurate AI looks at 1280 pixels square and takes about half a second
//    a look — one or two counts a second, and a person crosses a door in less
//    than that. A doorway uses the quick one.
{
  ok("a doorway asks for the quick AI", /countPeople\(engine\.current, px, useTiles \? undefined : 1, c\.isDoor\)/.test(ctx));
  ok("which the counter honours", /countWith\(engine, m\.px, m\.tiles, m\.fast\)/.test(wrk));
  ok("and loads on demand if it isn't there", /ensureFast\(engine\)/.test(wrk));
}

// 4. Waiting its turn. Cameras took strict turns, so with a room camera
//    sharing the computer the door got a look about once a second.
{
  ok("a doorway gets a turn between every room camera", /for \(const r of rooms\) \{ out\.push\(\.\.\.doors, r\); \}/.test(order));
  ok("and one more at the end of the round", /out\.push\(\.\.\.doors\);/.test(order));
  ok("and the breather between rounds is cut while a doorway is counting",
     /const door = \[\.\.\.cams\.current\.values\(\)\]\.some\(\(c\) => c\.isDoor && c\.stream\);/.test(ctx)
     && /Math\.min\(door \? 100 : 350, rest\)/.test(ctx));
}

// 5. None of it is allowed to cost accuracy where accuracy is what matters: a
//    camera on a ROOM still uses the accurate AI, still tiles when tiling
//    earns its keep, and still takes a 1280-wide picture.
{
  ok("a room camera still takes the bigger picture", /const COUNT_WIDTH = 1280;/.test(cam));
  ok("and still tiles when it pays", /const useTiles = !c\.isDoor && \(c\.needsTiles \|\| checking\);/.test(ctx));
  ok("and still uses the accurate AI", /c\.isDoor\)/.test(ctx) && !/fast: true/.test(ctx));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. The doorway gets the looks it needs.");
process.exit(fails ? 1 : 0);
