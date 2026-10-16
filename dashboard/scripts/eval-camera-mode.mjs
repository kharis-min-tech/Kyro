/**
 * Runs Camera Mode's real person detector (src/lib/peopleDetector.ts) with the
 * same model files the website serves, on every frame of the AI test set
 * (ai/eval/build_testset.py), and saves what it found for ai/eval/score.py.
 *
 * usage (Node 23.6+, which runs .ts directly):
 *   npm i --no-save onnxruntime-node sharp
 *   node scripts/eval-camera-mode.mjs <data_dir> <out.json> [accurate|light] [--raw]
 * Runs on the processor (onnxruntime-node), so it's slower than a browser with
 * a graphics chip, but the results are the same model and the same code.
 */
import fs from "node:fs";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { detectPeople } from "../src/lib/peopleDetector.ts";

const [data, outFile, kind = "accurate", ...rest] = process.argv.slice(2);
const raw = rest.includes("--raw");
const MODELS = { accurate: { name: "yolo11m1280-w16-v1", parts: 2, size: 1280 }, light: { name: "yolo11s-w16-v1", parts: 1, size: 640 } };
const m = MODELS[kind];
const bytes = Buffer.concat(Array.from({ length: m.parts }, (_, i) => fs.readFileSync(new URL(`../public/models/${m.name}.part${i}.bin`, import.meta.url))));
const EP = process.env.ORT_EP ? [process.env.ORT_EP, "cpu"] : ["cpu"];
const session = await ort.InferenceSession.create(bytes, { graphOptimizationLevel: "all", executionProviders: EP });
const run = async (t) => {
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, m.size, m.size]) });
  return res[session.outputNames[0]].data;
};
const labels = JSON.parse(fs.readFileSync(`${data}/labels.json`, "utf8"));
const out = { path: "camera_mode", model: m.name, imgsz: m.size, tiles: "auto", raw, frames: {} };
for (const [k, l] of labels.entries()) {
  const { data: px, info } = await sharp(`${data}/frames/${l.frame}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t0 = performance.now();
  const people = await detectPeople({ data: px, width: info.width, height: info.height }, run, { tiles: "auto", size: m.size, tidy: !raw });
  const sec = (performance.now() - t0) / 1000;
  out.frames[l.frame] = { sec: +sec.toFixed(3), boxes: people.map((p) => [...p.box.map((v) => +v.toFixed(1)), +p.score.toFixed(3)]) };
  if (k % 25 === 0 || labels.length < 10) console.log(`${k}/${labels.length} ${sec.toFixed(2)}s`);
}
fs.writeFileSync(outFile, JSON.stringify(out));
