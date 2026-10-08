/**
 * cameraMode.ts — counting people with cameras plugged into THIS computer,
 * inside the browser (no install). Loads the YOLO11 model, registers this
 * browser with the website as a camera computer (worker/venue.js), and sends
 * counts + a picture just like the Kyro Camera Box does.
 */
import { edgeFetch } from "@/lib/edgeAuth";
import { detectPeople, type Person, type RunModel } from "@/lib/peopleDetector";

const ORT_VERSION = "1.30.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const DEVICE_KEY = "kyro_camera_mode_device";
export const CAMERA_MODE_VERSION = "web-1.0";

/** Model files (split to fit the website's 25 MB-per-file limit). Bump the name when the model changes. */
export const MODELS = {
  accurate: { name: "yolo11m-w16-v1", parts: 2, tiles: "auto" as const },  // computers with WebGPU
  light:    { name: "yolo11s-w16-v1", parts: 1, tiles: 1 },                 // fallback without WebGPU
};

// ─── Model loading ─────────────────────────────────────────────────────────

type Ort = any; // onnxruntime-web, loaded from the CDN at runtime

let ortPromise: Promise<Ort> | null = null;
function loadOrt(): Promise<Ort> {
  if (ortPromise) return ortPromise;
  ortPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { ort?: Ort };
    if (w.ort) return resolve(w.ort);
    const s = document.createElement("script");
    s.src = `${ORT_BASE}ort.webgpu.min.js`;
    s.crossOrigin = "anonymous";
    s.onload = () => (w.ort ? resolve(w.ort) : reject(new Error("The AI engine didn't load")));
    s.onerror = () => { ortPromise = null; reject(new Error("Couldn't download the AI engine — check the internet connection")); };
    document.head.appendChild(s);
  });
  return ortPromise;
}

/** Downloads the model once and keeps it in the browser, so later visits start in seconds. */
async function fetchModel(name: string, parts: number, onProgress: (pct: number) => void): Promise<Uint8Array> {
  const cache = "caches" in window ? await caches.open("kyro-models").catch(() => null) : null;
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

export interface Engine { run: RunModel; tiles: number | "auto"; kind: "accurate" | "light"; backend: string }

export async function loadEngine(onProgress: (pct: number, step: string) => void): Promise<Engine> {
  onProgress(0, "Loading the AI engine…");
  const ort = await loadOrt();
  ort.env.wasm.wasmPaths = ORT_BASE;
  const hasGpu = !!(navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    && !!(await (navigator as any).gpu.requestAdapter().catch(() => null));
  const kind = hasGpu ? "accurate" : "light";
  const m = MODELS[kind];
  const bytes = await fetchModel(m.name, m.parts, (p) => onProgress(p * 0.9, "Downloading the AI model (first time only)…"));
  onProgress(92, "Starting the AI…");
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: hasGpu ? ["webgpu", "wasm"] : ["wasm"],
    graphOptimizationLevel: "all",
  });
  const input = session.inputNames[0], output = session.outputNames[0];
  const run: RunModel = async (t) => {
    const res = await session.run({ [input]: new ort.Tensor("float32", t, [1, 3, 640, 640]) });
    const out = res[output];
    const data = (out.getData ? await out.getData() : out.data) as Float32Array;
    return data;
  };
  onProgress(100, "Ready");
  return { run, tiles: m.tiles, kind, backend: hasGpu ? "graphics chip" : "processor" };
}

// ─── Reading a camera ───────────────────────────────────────────────────────

/** Grabs the current picture from a <video> as RGBA pixels. */
export function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function countPeople(engine: Engine, px: ImageData): Promise<Person[]> {
  return detectPeople(px, engine.run, { tiles: engine.tiles });
}

/** Opens one camera at the highest detail it offers (more pixels per person = far people found). */
export function openCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput" && d.deviceId);
}

/** A stable short key for a camera on this browser (the device id is long and private). */
export async function cameraKey(deviceId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId)));
  return "web-" + Array.from(h.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Talking to the website ────────────────────────────────────────────────

interface DeviceCred { device_id: string; token: string }

function savedDevice(): DeviceCred | null {
  try { const d = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null"); return d?.token ? d : null; } catch { return null; }
}

async function registerDevice(): Promise<DeviceCred> {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux|CrOS/.test(ua) ? "Linux" : "computer";
  const d = await edgeFetch<DeviceCred>("/api/live/browser-device", {
    method: "POST", body: JSON.stringify({ name: `Camera mode (${os})`, version: CAMERA_MODE_VERSION }),
  });
  localStorage.setItem(DEVICE_KEY, JSON.stringify(d));
  return d;
}

export interface CameraReport {
  key: string; label: string; current: number; peak: number; status: "online" | "error"; error?: string | null;
  fps: number; width: number; height: number;
}

/** Sends this browser's counts. Returns the cameras switched off on the website. */
export async function sendReport(cameras: CameraReport[]): Promise<string[]> {
  let dev = savedDevice() ?? await registerDevice();
  const post = (d: DeviceCred) => fetch("/api/devices/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.token}` },
    body: JSON.stringify({ version: CAMERA_MODE_VERSION, cameras: cameras.map((c) => ({ ...c, kind: "web", entries: 0, exits: 0 })) }),
  });
  let res = await post(dev);
  if (res.status === 401) {          // removed on the Cameras page → register again
    localStorage.removeItem(DEVICE_KEY);
    dev = await registerDevice();
    res = await post(dev);
  }
  if (!res.ok) throw new Error(`The website didn't accept the counts (${res.status})`);
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body.disabled) ? body.disabled : [];
}

export async function sendPicture(key: string, canvas: HTMLCanvasElement): Promise<void> {
  const dev = savedDevice();
  if (!dev) return;
  const scale = Math.min(1, 960 / canvas.width);
  const small = document.createElement("canvas");
  small.width = Math.round(canvas.width * scale); small.height = Math.round(canvas.height * scale);
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
  const blob = await new Promise<Blob | null>((r) => small.toBlob(r, "image/jpeg", 0.7));
  if (!blob) return;
  await fetch(`/api/devices/snapshot?camera=${encodeURIComponent(key)}`, {
    method: "PUT", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${dev.token}` }, body: blob,
  }).catch(() => {});
}
