/**
 * cameraMode.ts — counting people with cameras plugged into THIS computer,
 * inside the browser (no install). Loads the YOLO11 model, registers this
 * browser with the website as a camera computer (worker/venue.js), and sends
 * counts + a picture just like the Kyro Camera Box does.
 */
import { edgeFetch } from "@/lib/edgeAuth";
import type { Person } from "@/lib/peopleDetector";
import { startEngine, countWith } from "@/lib/countEngine";
export { MODELS } from "@/lib/countEngine";

const DEVICE_KEY = "kyro_camera_mode_device";
export const CAMERA_MODE_VERSION = "web-1.0";

// ─── The counting AI (runs in a background worker) ─────────────────────────

/** The AI, as seen from the page. It runs in a background worker so the camera
 *  pictures and buttons stay smooth while it counts. */
export interface Engine { kind: "accurate" | "light"; backend: string; count(px: ImageData): Promise<Person[]> }

function engineOnPage(onProgress: (pct: number, step: string) => void): Promise<Engine> {
  return startEngine(onProgress).then((e) => ({ kind: e.kind, backend: e.backend, count: (px) => countWith(e, px) }));
}

export function loadEngine(onProgress: (pct: number, step: string) => void): Promise<Engine> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./countWorker.ts", import.meta.url));
  } catch {
    return engineOnPage(onProgress);
  }
  const waiting = new Map<number, { ok: (p: Person[]) => void; fail: (e: Error) => void }>();
  let nextId = 1;
  return new Promise<Engine>((resolve, reject) => {
    let ready = false;
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === "progress") onProgress(m.pct, m.step);
      else if (m.type === "ready") {
        ready = true;
        resolve({
          kind: m.kind, backend: m.backend,
          count: (px) => new Promise<Person[]>((ok, fail) => {
            const id = nextId++;
            waiting.set(id, { ok, fail });
            const data = px.data;
            worker.postMessage({ type: "count", id, px: { data, width: px.width, height: px.height } }, [data.buffer]);
          }),
        });
      } else if (m.type === "result" || m.type === "count-error") {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.type === "result") w?.ok(m.people); else w?.fail(new Error(m.message));
      } else if (m.type === "load-error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      // The worker couldn't start at all (very old browser): count on the page instead.
      if (!ready) { worker.terminate(); engineOnPage(onProgress).then(resolve, reject); }
      else for (const [, w] of waiting) w.fail(new Error(e.message || "The AI stopped"));
    };
    worker.postMessage({ type: "load" });
  });
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

export function countPeople(engine: Engine, px: ImageData): Promise<Person[]> {
  return engine.count(px);
}

/** Opens one camera at the highest detail it offers (more pixels per person = far people found). */
export function openCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
}

const NOT_A_ROOM_CAMERA = /facetime|integrated|built-?in|truevision|iphone|ipad|desk view|virtual|obs/i;

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  // Never the computer's own built-in camera, a phone, or a virtual camera — only cameras plugged in for counting.
  return all.filter((d) => d.kind === "videoinput" && d.deviceId && !NOT_A_ROOM_CAMERA.test(d.label));
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
