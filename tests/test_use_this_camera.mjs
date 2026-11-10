/**
 * "Use this" has to actually use it.
 *
 * What was reported: "i tried to scan, the other goodmans camera wouldnt come
 * up and even if it came up, i click 'use this' section, and i go to another
 * section and the button has dissapeared and its not working... so i cant see
 * it on my system nor is it counting". And, fairly: "how would one even be
 * able to know their stream address".
 *
 * Three faults, all in the same flow.
 *
 * 1. The scan showed ONLY cameras plugged in since the page was opened.
 *    Anything already connected was hidden behind a grey line of text that
 *    read like a footnote — so a camera that was already there simply wasn't
 *    in the list of cameras.
 *
 * 2. "Use this" didn't use anything. It filled in a stream address — for a
 *    camera that hasn't got one — and then waited for a name and an "Add
 *    camera" button further down the page. Leave the page and the pick went
 *    with it. Nothing was ever connected.
 *
 * 3. A USB camera has no stream address, and Kyro asked for one anyway.
 *
 * In Live mode a camera plugged into this computer needs no record typed in.
 * It needs counting switched on, and then it adds itself within a few
 * seconds with its own name. So that is all picking it does now.
 *
 *   node tests/test_use_this_camera.mjs
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
const page = fs.readFileSync(path.join(root, "dashboard/src/app/cameras/page.tsx"), "utf8");
const ctx = fs.readFileSync(path.join(root, "dashboard/src/lib/CountingContext.tsx"), "utf8");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kyro-scan-"));
execFileSync(path.join(root, "dashboard/node_modules/.bin/tsc"), [
  path.join(root, "dashboard/src/lib/cameraScan.ts"),
  "--outDir", tmp, "--module", "es2022", "--target", "es2022",
], { stdio: "inherit" });
const { scanOutcome } = await import(path.join(tmp, "cameraScan.js"));

// 1. Every camera it can see is listed, whenever it was plugged in.
{
  const found = [{ id: "a", label: "FaceTime HD" }, { id: "b", label: "GENERAL - UVC" }];
  // Both were already there when she opened the page — her case exactly.
  const already = new Set(["a", "b"]);
  const out = scanOutcome(found, already);
  ok("nothing new, but it still says what it can see", out.problem === null && /2 cameras/.test(out.note ?? ""));
  // And the page renders the WHOLE list, not just the new ones. This is the
  // line that hid her camera.
  ok("the page lists every camera found", /\{allDevices\.map\(\(d\) => \(/.test(page));
  ok("the old new-only list is gone", !/\{newDevices\.map\(\(d\) => \(/.test(page));
  ok("and the ones just plugged in are flagged rather than being the only ones",
     /isNew=\{!!newDevices\.find\(\(n\) => n\.id === d\.id\)\}/.test(page)
     && /Just plugged in/.test(page));
  ok("the heading counts what is actually shown",
     /Camera\$\{allDevices\.length !== 1 \? "s" : ""\} on this computer/.test(page));
}

// 2. A camera plugged in since the page opened is still pointed out.
{
  const out = scanOutcome([{ id: "a", label: "FaceTime HD" }, { id: "b", label: "GENERAL - UVC" }], new Set(["a"]));
  ok("the newly plugged-in one is picked out", out.fresh.length === 1 && out.fresh[0].id === "b");
}

// 3. Nothing at all is still an honest answer.
{
  const out = scanOutcome([], new Set());
  ok("no cameras says so, and says what to check",
     out.fresh.length === 0 && /Check the cable is pushed/.test(out.problem ?? ""));
}

// 4. In Live mode, picking a camera starts counting there and then.
{
  ok("picking it switches counting on", /if \(isEdgeLive\(\)\) \{[\s\S]{0,200}startCounting\?\.\(\);/.test(page));
  ok("and nothing else is asked for",
     /mode === "detect" && pickedId && !edge/.test(page));
  ok("the button says what it will do", /action=\{edge \? "Count with this" : "Use this"\}/.test(page));
  ok("and afterwards it says what happened",
     /Counting on this computer is on\./.test(page)
     && /appears in the list above by\s*\n?\s*itself within a few seconds/.test(page));
}

// 5. The question that had no answer: a USB camera has no stream address.
{
  ok("Live mode says so outright", /<strong>No stream address needed<\/strong>/.test(page));
  ok("and says it again when the camera is counting",
     /a camera plugged into this computer has no stream address/.test(page));
  // The network path is where an address belongs, and it still explains
  // where to find one.
  ok("network cameras still have their address help",
     /How do I find my camera.{0,10}s stream address\?/.test(page));
}

// 6. A camera already being counted is not offered again as if it were new.
{
  ok("the page knows which cameras are already counting",
     /counting\?\.views \?\? \[\]\)\.filter\(\(v\) => v\.streaming\)\.map\(\(v\) => v\.deviceId\)/.test(page));
  ok("which means the browser has to say which device each one is",
     /key: c\.key, deviceId: c\.deviceId, label: c\.label/.test(ctx));
  ok("and the card says so instead of saying Use this",
     /already \? "Already counting"/.test(page));
}


// ── The camera that is not in the list at all ──────────────────────────────
//
// "i tried to unplug and replug my goodmans camera, its still not working".
// Everything else on this panel helps you choose BETWEEN the cameras Kyro can
// see. None of it helps when the one you want is not among them, and the page
// said nothing about that case — which for an action camera is nearly always
// one thing: it came up in storage mode, offering its memory card, and no
// computer sees a camera at all.
{
  ok("the page answers 'my camera isn't in this list'", /My camera isn&apos;t in this list/.test(page));
  ok("it says plainly that the list IS everything the browser can see",
     /every camera\s*\n?\s*this browser will admit to/.test(page.replace(/\s+/g, " ")) || /every camera this browser will admit to/.test(page.replace(/\s+/g, " ")));
  ok("it names the action-camera cause first", /storage mode/.test(page) && /PC Camera/.test(page) && /UVC/.test(page));
  ok("then the cable and the hub", /not through a hub/.test(page) && /charging-only cable carries no picture/.test(page));
  ok("then whatever else is holding the camera", /Zoom, Teams, FaceTime, Photo Booth, OBS/.test(page));
  ok("and ends somewhere Kyro cannot be blamed or credited",
     /Photo Booth on a Mac, Camera on\s*\n?\s*Windows/.test(page) || /Photo Booth on a Mac, Camera on Windows/.test(page.replace(/\s+/g, " ")));
  ok("it only appears once a scan has actually run", /\{scanned && \(\s*\n?\s*<details/.test(page));
}

console.log(fails ? `\n${fails} failed` : "\nAll good. Use this uses it.");
process.exit(fails ? 1 : 0);