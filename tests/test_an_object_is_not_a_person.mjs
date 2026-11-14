/**
 * A sliver at the edge of the picture is not a person.
 *
 * "kyro needs to have the ability to know which is an object and human, i
 * turned my camera on, im not sure why [...] i dont know why it would count
 * that."
 *
 * A green box forty pixels wide, hugging the right edge of the frame,
 * counted as somebody. A standing person's box is roughly a third as wide
 * as it is tall; the rules only ever asked whether a box was TALLER than it
 * was wide, which a strip of curtain or a door frame passes easily.
 *
 * The model has far less to go on at the edge, because most of whatever it
 * is lies outside the picture — so a clipped sliver has to be more
 * convincing, exactly as a small box already does.
 *
 *   node tests/test_an_object_is_not_a_person.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-obj-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/peopleDetector.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022", "--skipLibCheck",
], { stdio: "inherit" });
const { looksLikeAPerson, EDGE_SLIVER, EDGE_NEEDS } = await import(path.join(tmp, "peopleDetector.js"));

const W = 1280, H = 720, BAR = 0.3;
const counted = (box, score, withWidth = true) =>
  looksLikeAPerson([{ box, score }], H, BAR, withWidth ? W : 0).length === 1;

// ── 1. The thing in the screenshot ────────────────────────────────────────
{
  const sliver = [1215, 215, 1280, 655];     // 65 wide, 440 tall, on the right edge
  ok("1. a sliver down the right edge used to be counted", counted(sliver, 0.34, false));
  ok("1. and is not any more", !counted(sliver, 0.34));
  ok("1. a door frame down the left edge is not either", !counted([0, 0, 55, 719], 0.31));
}

// ── 2. A person is still a person ─────────────────────────────────────────
//
// This is the half that matters. Being strict at the edge is easy; being
// strict without losing anybody walking in is the whole job.
{
  ok("2. her, sitting in the middle of the room", counted([420, 430, 700, 700], 0.82));
  ok("2. somebody half in shot at the edge", counted([1130, 200, 1280, 690], 0.55));
  ok("2. …even when the AI is not very sure of them", counted([1130, 200, 1280, 690], 0.33));
  ok("2. somebody at the back of a hall", counted([640, 300, 690, 430], 0.45));
  ok("2. and a narrow person in the MIDDLE is left alone, not being clipped",
     counted([600, 215, 665, 655], 0.34));
}

// ── 3. A sliver Kyro is really sure about is still counted ────────────────
//
// The bar is raised, not a ban: somebody in a doorway, mostly out of shot
// but unmistakable, is still somebody.
{
  const sliver = [1215, 215, 1280, 655];
  ok("3. a sliver the AI is sure of is counted", counted(sliver, EDGE_NEEDS + 0.05));
  ok("3. and one it is not sure of is not", !counted(sliver, EDGE_NEEDS - 0.05));
}

// ── 4. Only where the width of the picture is known ───────────────────────
//
// Some callers measure a crop rather than the whole frame. Guessing at an
// edge there would throw away people standing perfectly in shot.
{
  const sliver = [1215, 215, 1280, 655];
  ok("4. without the frame's width the rule does not fire", counted(sliver, 0.34, false));
  const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");
  ok("4. and the counting passes the width",
     /looksLikeAPerson\(people, px\.height, bar, px\.width\)/.test(ctx));
}

// ── 5. The numbers are written down ───────────────────────────────────────
{
  ok("5. how narrow is a sliver", EDGE_SLIVER > 0 && EDGE_SLIVER < 0.3, `${EDGE_SLIVER}`);
  ok("5. and what one has to score", EDGE_NEEDS > BAR && EDGE_NEEDS < 0.6, `${EDGE_NEEDS}`);
}

// ── 6. Two cameras, one person, and what Off costs ────────────────────────
//
// Measured separately: one person in front of two cameras is counted as TWO
// with face matching off and ONE with it on, whatever the rooms are called.
// That is not a fault in the matching, it is what the matching is for — but
// the card said "Off" and nothing said what Off costs.
{
  const card = fs.readFileSync(path.join(root, "dashboard/src/components/ui/FaceMatching.tsx"), "utf8");
  ok("6. the card says so, when there is more than one room camera",
     /!p\.face_matching && watchingRooms > 1/.test(card));
  ok("6. in the words of what actually happens",
     /counted as <strong>two different people<\/strong>/.test(card));
  ok("6. and not when there is only one camera to be in front of",
     /watchingRooms > 1/.test(card) && /c\.location !== "entrance" && c\.location !== "queue"/.test(card));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
