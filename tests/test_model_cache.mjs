/**
 * The browser's AI-file store.
 *
 * The thing being guarded against: Kyro starts the light counting AI, then
 * upgrades to the accurate one. A tidy-up that keeps only "the model being
 * loaded" makes those two delete each other, so every page load downloads
 * 60 MB again and Kyro sits there loading. That is what happened.
 *
 *   node tests/test_model_cache.mjs
 */
import fs from "node:fs";
import path from "node:path";

let fails = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`✗ ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
};

const root = path.resolve(import.meta.dirname, "..");
const src = fs.readFileSync(path.join(root, "dashboard/src/lib/modelCache.ts"), "utf8");
const FILES = [...src.slice(src.indexOf("MODEL_FILES = ["), src.indexOf("] as const")).matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// 1. The list must match the files actually shipped — otherwise the tidy-up
//    silently throws away a file Kyro needs, which is the whole bug.
const shipped = fs.readdirSync(path.join(root, "dashboard/public/models")).filter((f) => f.endsWith(".bin")).sort();
is("the list matches the AI files in the site", [...FILES].sort(), shipped);

// 2. The counting AI's own model names must appear in it.
const ce = fs.readFileSync(path.join(root, "dashboard/src/lib/countEngine.ts"), "utf8");
const models = [...ce.matchAll(/name: "([^"]+)", parts: (\d+)/g)].map((m) => ({ name: m[1], parts: +m[2] }));
is("both counting models are in the list",
  models.every((m) => Array.from({ length: m.parts }, (_, i) => `${m.name}.part${i}.bin`).every((f) => FILES.includes(f))), true);

// 3. Face files too — these were never kept at all before.
is("face files are in the list", ["face-find-v1.bin", "face-code-v1.bin"].every((f) => FILES.includes(f)), true);

// 4. The tidy-up, run as the real one is: does a full page load re-download?
const SIZE = Object.fromEntries(shipped.map((f) => [f, fs.statSync(path.join(root, "dashboard/public/models", f)).size]));
const current = (url) => FILES.some((f) => url.endsWith(`/models/${f}`));

let store = new Set(), downloaded = 0;
function pageLoad() {
  const before = downloaded;
  const need = [
    ...models.find((m) => m.name.includes("11s")).name && [`${models.find((m) => m.name.includes("11s")).name}.part0.bin`],
    ...Array.from({ length: 2 }, (_, i) => `yolo11m1280-w16-v1.part${i}.bin`),
    "face-find-v1.bin", "face-code-v1.bin",
  ];
  for (const f of need) {
    if (!store.has(f)) { downloaded += SIZE[f]; store.add(f); }
    for (const kept of [...store]) if (!current(`/models/${kept}`)) store.delete(kept);   // forgetOldModels()
  }
  return downloaded - before;
}

const mb = (b) => +(b / 1e6).toFixed(1);
const first = pageLoad();
is("first ever page load downloads everything once", mb(first), mb(Object.values(SIZE).reduce((a, b) => a + b, 0)));
is("second page load downloads nothing", pageLoad(), 0);
is("tenth page load downloads nothing", (() => { for (let i = 0; i < 8; i++) pageLoad(); return pageLoad(); })(), 0);
is("every file is still kept", [...store].sort(), shipped);

// 5. A file from an older version of Kyro does get cleared out.
store.add("yolo11m1280-w16-OLD.part0.bin");
pageLoad();
is("an old version's file is removed", store.has("yolo11m1280-w16-OLD.part0.bin"), false);

// 6. The site must tell browsers to keep them.
const headers = fs.readFileSync(path.join(root, "dashboard/public/_headers"), "utf8");
is("the site asks browsers to keep the AI files", /\/models\/\*[\s\S]*immutable/.test(headers), true);

console.log(`\nFirst visit downloads ${mb(first)} MB; every visit after that, 0 MB.`);
console.log(fails ? `${fails} FAILED` : "All passed");
process.exit(fails ? 1 : 0);
