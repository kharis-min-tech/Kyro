/**
 * countEngine.ts — loads Kyro's people-counting AI (YOLO11, via onnxruntime-web)
 * and picks the best model this computer can run. Used inside the Camera Mode
 * background worker (countWorker.ts), so counting never freezes the page; it
 * can also run on the page itself if the browser has no workers.
 */
import { detectPeople, type Person, type Pixels, type RunModel } from "@/lib/peopleDetector";

export const ORT_VERSION = "1.30.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
/** Model files (split to fit the website's 25 MB-per-file limit). Bump the name when the model changes. */
export const MODELS = {
  // Computers with WebGPU: YOLO11m looking at 1280×1280 + tiles — in tests on
  // crowded whole-hall shots it found 83% of people (the camera computer: 84%).
  accurate: { name: "yolo11m1280-w16-v1", parts: 2, size: 1280, tiles: "auto" as const },
  // Without WebGPU (slower processor-only): YOLO11s at 640 + tiles — found 68%.
  light:    { name: "yolo11s-w16-v1", parts: 1, size: 640, tiles: "auto" as const },
};

// ─── Model loading ─────────────────────────────────────────────────────────

type Ort = any; // onnxruntime-web, loaded from the CDN at runtime

let ortPromise: Promise<Ort> | null = null;
function loadOrt(): Promise<Ort> {
  if (ortPromise) return ortPromise;
  const g = globalThis as unknown as { ort?: Ort; importScripts?: (url: string) => void; document?: Document };
  if (g.ort) return (ortPromise = Promise.resolve(g.ort));
  // Inside the background worker: load the engine script directly.
  if (typeof g.importScripts === "function" && !g.document) {
    try {
      g.importScripts(`${ORT_BASE}ort.webgpu.min.js`);
      if (!g.ort) throw new Error("The AI engine didn't load");
      return (ortPromise = Promise.resolve(g.ort));
    } catch {
      return Promise.reject(new Error("Couldn't download the AI engine — check the internet connection"));
    }
  }
  ortPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${ORT_BASE}ort.webgpu.min.js`;
    s.crossOrigin = "anonymous";
    s.onload = () => (g.ort ? resolve(g.ort) : reject(new Error("The AI engine didn't load")));
    s.onerror = () => { ortPromise = null; reject(new Error("Couldn't download the AI engine — check the internet connection")); };
    document.head.appendChild(s);
  });
  return ortPromise;
}

/** Downloads the model once and keeps it in the browser, so later visits start in seconds. */
async function fetchModel(name: string, parts: number, onProgress: (pct: number) => void): Promise<Uint8Array> {
  const cache = "caches" in globalThis ? await caches.open("kyro-models").catch(() => null) : null;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < parts; i++) {
    const url = `/models/${name}.part${i}.bin`;
    let res = cache ? await cache.match(url) : undefined;
    if (!res) {
      const net = await fetch(url);
      if (!net.ok) throw new Error(`Couldn't download the AI model (${net.status})`);
      if (cache) await cache.put(url, net.clone()).catch(() => {});
      res = net;
    }
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body!.getReader();
    const got: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got.push(value); n += value.length;
      if (total) onProgress(((i + n / total) / parts) * 100);
    }
    const all = new Uint8Array(n);
    let o = 0;
    for (const g of got) { all.set(g, o); o += g.length; }
    chunks.push(all);
    onProgress(((i + 1) / parts) * 100);
  }
  const size = chunks.reduce((a, c) => a + c.length, 0);
  const model = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { model.set(c, o); o += c.length; }
  // Old model versions are no longer needed.
  if (cache) for (const req of await cache.keys()) if (!req.url.includes(name)) cache.delete(req).catch(() => {});
  return model;
}

export interface LocalEngine { run: RunModel; tiles: number | "auto"; size: number; kind: "accurate" | "light"; backend: string }

async function hasRealGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<any> } }).gpu;
  if (!gpu) return false;
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return false;
  // A software stand-in (no real graphics chip) is far slower than the processor path.
  const arch = String(adapter.info?.architecture ?? "").toLowerCase();
  return !adapter.isFallbackAdapter && !arch.includes("swiftshader");
}

async function startModel(ort: Ort, kind: "accurate" | "light", useGpu: boolean, onProgress: (pct: number, step: string) => void) {
  const m = MODELS[kind];
  const bytes = await fetchModel(m.name, m.parts, (p) => onProgress(p * 0.85, "Downloading the AI model (first time only)…"));
  onProgress(88, "Starting the AI…");
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: useGpu ? ["webgpu", "wasm"] : ["wasm"],
    graphOptimizationLevel: "all",
  });
  const input = session.inputNames[0], output = session.outputNames[0];
  const run: RunModel = async (t) => {
    const res = await session.run({ [input]: new ort.Tensor("float32", t, [1, 3, m.size, m.size]) });
    const out = res[output];
    return (out.getData ? await out.getData() : out.data) as Float32Array;
  };
  // Warm up (the first run prepares the graphics chip) and time a second run.
  onProgress(94, "Checking how fast this computer is…");
  const blank = new Float32Array(3 * m.size * m.size);
  await run(blank);
  const t0 = performance.now();
  await run(blank);
  return { run, m, seconds: (performance.now() - t0) / 1000 };
}

/** Slowest single look the accurate AI may take (a count is about 5 looks). */
const MAX_ACCURATE_PASS_S = 2.5;

export async function startEngine(onProgress: (pct: number, step: string) => void): Promise<LocalEngine> {
  onProgress(0, "Loading the AI engine…");
  const ort = await loadOrt();
  ort.env.wasm.wasmPaths = ORT_BASE;
  const gpu = await hasRealGpu();
  if (gpu) {
    try {
      const a = await startModel(ort, "accurate", true, onProgress);
      if (a.seconds <= MAX_ACCURATE_PASS_S) {
        onProgress(100, "Ready");
        return { run: a.run, tiles: a.m.tiles, size: a.m.size, kind: "accurate", backend: "graphics chip" };
      }
    } catch { /* fall through to the lighter AI */ }
  }
  const l = await startModel(ort, "light", gpu, onProgress);
  onProgress(100, "Ready");
  return { run: l.run, tiles: l.m.tiles, size: l.m.size, kind: "light", backend: gpu ? "graphics chip" : "processor" };
}

export function countWith(engine: LocalEngine, px: Pixels): Promise<Person[]> {
  return detectPeople(px, engine.run, { tiles: engine.tiles, size: engine.size });
}
