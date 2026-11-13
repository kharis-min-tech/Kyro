/**
 * Forty people, and no more, however full the hall.
 *
 * "i have realised not all people are marked or counted for during the
 * service."
 *
 * A camera sent the website the people it was following, cut to the first
 * FORTY. The website then cut what arrived to forty again. So a hall with a
 * hundred and fourteen people in it put forty of them into the register and
 * dropped seventy-four without a word — never counted, never recognised,
 * never asked about. The same forty each time, because the list is in track
 * order.
 *
 * Nothing about forty was ever about people. It was about the size of a
 * FACE: a coat reading is eight numbers, a face code is a hundred and
 * twenty-eight, about 350 characters packed, and sending one for everybody
 * every two seconds is a quarter of a megabyte a tick. The list was cut to
 * pay for the faces.
 *
 * So the faces are rationed instead — the register only needs one to anchor
 * somebody — and the list is as long as it needs to be:
 *
 *     114 people in shot → 18 KB a report  (was 17 KB, dropping 74 people)
 *     400 people in shot → 41 KB a report  (was 17 KB, dropping 360)
 *
 *   node tests/test_everybody_reaches_the_register.mjs
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
const ctx = read("dashboard/src/lib/CountingContext.tsx");
const worker = read("worker/venue.js");

// ── 1. Neither end cuts the congregation to forty ─────────────────────────
{
  ok("1. the camera sends as many as it is following",
     /seen: following\.slice\(0, MOST_SEEN_SENT\)/.test(ctx) && !/following\.slice\(0, 40\)/.test(ctx));
  const keptAt = [...worker.matchAll(/c\.seen\.slice\(0, (\w+)\)/g)].map((m) => m[1]);
  ok("1. and the website keeps as many as arrive, everywhere it reads them",
     keptAt.length >= 2 && keptAt.every((v) => v === "MOST_SEEN"), keptAt.join(", "));
  const sent = Number(/const MOST_SEEN_SENT = (\d+);/.exec(ctx)?.[1]);
  const kept = Number(/const MOST_SEEN = (\d+);/.exec(worker)?.[1]);
  ok("1. both numbers are written down", Number.isFinite(sent) && Number.isFinite(kept), `${sent} / ${kept}`);
  ok("1. the website keeps everything the camera sends", kept >= sent, `sends ${sent}, keeps ${kept}`);
  // A cathedral, not a living room.
  ok("1. and it is a number a full church cannot reach", sent >= 400, `${sent}`);
}

// ── 2. The faces are what is rationed, because faces are what cost ────────
{
  ok("2. a face is sent only when one is wanted",
     /f: faceOnRef\.current && x\.face && wantsFace\(c, x\.track, now\)/.test(ctx));
  ok("2. a few at a time", /const FACES_PER_REPORT = (\d+);/.test(ctx));
  ok("2. and not the same person again and again",
     /const FACE_AGAIN_MS = \d+_?\d*;/.test(ctx) && /now - last < FACE_AGAIN_MS/.test(ctx));
  ok("2. the note of who has been sent cannot grow for ever",
     /if \(mine\.size > 1200\)/.test(ctx));
}

// ── 3. What it costs on the wire ──────────────────────────────────────────
//
// The point of rationing rather than cutting: a full hall costs what it
// used to, and nobody is left out of it.
{
  const one = JSON.stringify({ t: 1, b: [0.1, 0.2, 0.3, 0.4], s: "K12",
    l: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 2.5, 0.5], q: 7 }).length;
  const FACE = 350;
  const faces = Number(/const FACES_PER_REPORT = (\d+);/.exec(ctx)[1]);
  const now114 = 114 * one + Math.min(faces, 114) * FACE;
  const before = 40 * one + 40 * FACE;
  ok(`3. a hall of 114 costs about what forty people used to (${Math.round(now114 / 1024)} KB vs ${Math.round(before / 1024)} KB)`,
     now114 < before * 1.3, `${now114} vs ${before}`);
  ok("3. and a congregation of four hundred is still a sane report",
     (400 * one + faces * FACE) / 1024 < 60, `${Math.round((400 * one + faces * FACE) / 1024)} KB`);
}

// ── 4. The register itself was never the limit ────────────────────────────
//
// It took 9,999 of 10,000 in the scale test. What stopped people reaching
// it was the pipe, at both ends.
{
  ok("4. nothing else cuts a camera's people to a small number",
     !/\.slice\(0, 40\)/.test(ctx) && !/\.slice\(0, 40\)/.test(worker),
     [...ctx.matchAll(/.{0,40}\.slice\(0, 40\).{0,30}/g)].map((m) => m[0]).join("\n   ")
     + [...worker.matchAll(/.{0,40}\.slice\(0, 40\).{0,30}/g)].map((m) => m[0]).join("\n   "));
}

console.log(fails ? `\n${fails} failed` : "\nAll good");
process.exit(fails ? 1 : 0);
