/**
 * countEngine.ts — loads Kyro's people-counting AI (YOLO11, via onnxruntime-web)
 * and picks the best model this computer can run. Used inside the Camera Mode
 * background worker (countWorker.ts), so counting never freezes the page; it
 * can also run on the page itself if the browser has no workers.
 */
import { detectPeople, detectSeating, type Person, type Pixels, type RunModel } from "@/lib/peopleDetector";
import { modelResponse, forgetOldModels } from "@/lib/modelCache";

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
export function loadOrt(): Promise<Ort> {
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
    let attempt = 0;
    const tryLoad = () => {
      const s = document.createElement("script");
      s.src = `${ORT_BASE}ort.webgpu.min.js`;
      s.crossOrigin = "anonymous";
      s.onload = () => (g.ort ? resolve(g.ort) : reject(new Error("The AI engine didn't load")));
      s.onerror = () => {
        s.remove();
        if (++attempt < 3) { setTimeout(tryLoad, 1500 * attempt); return; }   // church Wi-Fi drops
        ortPromise = null;
        reject(new Error("Couldn't download the AI engine — check the internet connection, then press Start again"));
      };
      document.head.appendChild(s);
    };
    tryLoad();
  });
  return ortPromise;
}

/** Downloads the model once and keeps it in the browser, so later visits start in seconds. */
async function fetchModel(name: string, parts: number, onProgress: (pct: number) => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < parts; i++) {
    const res = await modelResponse(`/models/${name}.part${i}.bin`);
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
  // Files from an older version of Kyro can go. This must never throw away a
  // file the current Kyro uses: starting the light AI then upgrading to the
  // accurate one used to delete each other, so every page load downloaded
  // 60 MB again and Kyro sat there "loading" every time.
  forgetOldModels().catch(() => {});
  return model;
}

export interface LocalEngine {
  run: RunModel; tiles: number | "auto"; size: number; kind: "accurate" | "light"; backend: string;
  /**
   * The lighter, quicker AI, kept beside the accurate one for cameras that
   * need speed more than reach.
   *
   * A camera on a doorway is the case. The accurate AI looks at 1280 pixels
   * square and takes about half a second a look, which is one or two counts a
   * second — and somebody walks through a door in less than that, so they are
   * seen once, and one sighting cannot say which way they were going. The
   * lighter AI looks at 640 and is several times quicker. It finds fewer
   * people at the back of a hall, which is exactly what a doorway camera does
   * not need: everyone it cares about is a step away.
   */
  fast?: { run: RunModel; tiles: number | "auto"; size: number };
}

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

/**
 * Slowest single look the accurate AI may take.
 *
 * A count is about 5 looks (the whole picture plus 2x2 tiles), so this caps a
 * count at roughly 3 seconds. It used to be 2.5 s a look — up to 12 seconds for
 * one number, which looked like the AI had failed. The lighter AI counts in
 * about 1 second on an ordinary processor and was just as accurate on small
 * groups in testing, so falling back to it is much better than a slow number.
 */
const MAX_ACCURATE_PASS_S = 0.6;

/**
 * Gets counting as fast as possible, then improves if the computer can take it.
 *
 * It used to download the accurate AI (40 MB), warm it up, decide the computer
 * was too slow for it, and only then download the lighter one (18 MB) — 58 MB
 * and about 25 seconds before the first count. Now the light AI starts first
 * (about half a second once downloaded) so counting begins straight away, and
 * the accurate one is tried quietly in the background. If it turns out fast
 * enough it takes over; the engine object is swapped in place, so whatever is
 * counting just starts using it.
 *
 * `prefer` is what this computer settled on last time, so it never pays for
 * that experiment twice. `onSettled` reports what it chose, to remember.
 */
export async function startEngine(
  onProgress: (pct: number, step: string) => void,
  prefer?: "accurate" | "light",
  onSettled?: (kind: "accurate" | "light") => void,
): Promise<LocalEngine> {
  onProgress(0, "Loading the AI engine…");
  const ort = await loadOrt();
  ort.env.wasm.wasmPaths = ORT_BASE;
  const gpu = await hasRealGpu();

  // This computer already proved it can run the accurate AI: go straight there.
  if (prefer === "accurate" && gpu) {
    try {
      const a = await startModel(ort, "accurate", true, onProgress);
      onProgress(100, "Ready");
      onSettled?.("accurate");
      return { run: a.run, tiles: a.m.tiles, size: a.m.size, kind: "accurate", backend: "graphics chip" };
    } catch { /* fall back to the light one below */ }
  }

  const l = await startModel(ort, "light", gpu, onProgress);
  onProgress(100, "Ready");
  const engine: LocalEngine = {
    run: l.run, tiles: l.m.tiles, size: l.m.size, kind: "light", backend: gpu ? "graphics chip" : "processor",
    // Kept, so that if the accurate AI takes over below, a doorway camera can
    // still have the quick one.
    fast: { run: l.run, tiles: l.m.tiles, size: l.m.size },
  };

  // Counting has begun. Now see, without holding anything up, whether this
  // computer is quick enough for the accurate AI.
  if (gpu && prefer !== "light") {
    (async () => {
      try {
        const a = await startModel(ort, "accurate", true, () => {});
        if (a.seconds <= MAX_ACCURATE_PASS_S) {
          engine.run = a.run; engine.tiles = a.m.tiles; engine.size = a.m.size;
          engine.kind = "accurate"; engine.backend = "graphics chip";
          onSettled?.("accurate");
        } else {
          onSettled?.("light");
        }
      } catch { onSettled?.("light"); }
    })();
  } else if (prefer !== "light") {
    onSettled?.("light");
  }
  return engine;
}

/** `tiles` overrides the engine's own choice — 1 means the whole picture only,
 *  which is five times faster and loses nothing when nobody is far away.
 *  `fast` asks for the lighter AI, for a doorway. See LocalEngine.fast. */
export function countWith(engine: LocalEngine, px: Pixels, tiles?: number, fast?: boolean): Promise<Person[]> {
  const use = fast && engine.fast ? engine.fast : engine;
  return detectPeople(px, use.run, { tiles: tiles ?? use.tiles, size: use.size });
}

/** Chairs, benches and sofas — one look, for finding the seats. */
export function seatingWith(engine: LocalEngine, px: Pixels): Promise<Person[]> {
  return detectSeating(px, engine.run, { size: engine.size });
}

/**
 * Make sure the quick AI is loaded, for a doorway camera.
 *
 * A computer that already knew it could run the accurate AI went straight to
 * it and never loaded the light one, so there was no quick path to offer. This
 * loads it in the background; until it arrives, counting carries on with
 * whatever is already there.
 */
export async function ensureFast(engine: LocalEngine): Promise<void> {
  if (engine.fast) return;
  const ort = await loadOrt();
  ort.env.wasm.wasmPaths = ORT_BASE;
  const l = await startModel(ort, "light", await hasRealGpu(), () => {});
  engine.fast = { run: l.run, tiles: l.m.tiles, size: l.m.size };
}
