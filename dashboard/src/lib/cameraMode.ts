/**
 * cameraMode.ts — counting people with cameras plugged into THIS computer,
 * inside the browser (no install). Loads the YOLO11 model, registers this
 * browser with the website as a camera computer (worker/venue.js), and sends
 * counts + a picture just like the Kyro Camera Box does.
 */
import { edgeFetch } from "@/lib/edgeAuth";
import type { Person } from "@/lib/peopleDetector";
import type { Inward } from "@/lib/personTracker";
import { startEngine, countWith } from "@/lib/countEngine";
export { MODELS } from "@/lib/countEngine";

const DEVICE_KEY = "kyro_camera_mode_device";
export const CAMERA_MODE_VERSION = "web-1.0";

// ─── The counting AI (runs in a background worker) ─────────────────────────

/** The AI, as seen from the page. It runs in a background worker so the camera
 *  pictures and buttons stay smooth while it counts. */
export interface Engine {
  kind: "accurate" | "light";
  backend: string;
  /**
   * `tiles` = 1 looks at the whole picture once. `fast` asks for the lighter,
   * quicker AI — for a camera on a doorway, where people cross in a second and
   * looking twice as often matters more than seeing someone at the back of a
   * hall.
   */
  count(px: ImageData, tiles?: number, fast?: boolean): Promise<Person[]>;
}

const ENGINE_KEY = "kyro_engine_kind";

function engineOnPage(onProgress: (pct: number, step: string) => void): Promise<Engine> {
  let prefer: "accurate" | "light" | undefined;
  try { const v = localStorage.getItem(ENGINE_KEY); if (v === "accurate" || v === "light") prefer = v; } catch { /* fine without it */ }
  return startEngine(onProgress, prefer, (kind) => { try { localStorage.setItem(ENGINE_KEY, kind); } catch { /* fine */ } })
    .then((e) => ({ kind: e.kind, backend: e.backend, count: (px, tiles, fast) => countWith(e, px, tiles, fast) }));
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
      else if (m.type === "settled") {
        // Which AI this computer can actually run, so the next start skips the trial.
        try { localStorage.setItem(ENGINE_KEY, m.kind); } catch { /* fine without it */ }
      }
      else if (m.type === "ready") {
        ready = true;
        resolve({
          kind: m.kind, backend: m.backend,
          count: (px, tiles, fast) => new Promise<Person[]>((ok, fail) => {
            const id = nextId++;
            waiting.set(id, { ok, fail });
            // The picture is COPIED to the worker, not handed over. Handing it
            // over is faster by one copy, but it empties the caller's picture:
            // the buffer is detached the moment it is transferred. Kyro looks
            // at the same picture more than once — every tenth count it checks
            // whether splitting into tiles is earning its keep, and face codes
            // are read from it afterwards — and the second look found nothing
            // there: "An ArrayBuffer is detached and could not be cloned."
            // A counting engine must not destroy what it was asked to count.
            // `tiles` and `fast` used to be dropped here, so every setting
            // the page chose per camera — whole picture only, lighter AI —
            // quietly did nothing once counting moved into the worker.
            worker.postMessage({ type: "count", id, tiles, fast, px: { data: px.data, width: px.width, height: px.height } });
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
    let prefer: string | null = null;
    try { prefer = localStorage.getItem(ENGINE_KEY); } catch { /* fine without it */ }
    worker.postMessage({ type: "load", prefer: prefer === "accurate" || prefer === "light" ? prefer : undefined });
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

/** `tiles` = 1 counts the whole picture in one look (five times faster, and
 *  loses nothing unless someone is too small to see without tiling). */
export function countPeople(engine: Engine, px: ImageData, tiles?: number, fast?: boolean): Promise<Person[]> {
  return engine.count(px, tiles, fast);
}

/**
 * Opens one camera at the highest detail it offers — more pixels per person
 * means people further away are still found.
 *
 * `step` asks for less each time. Some cameras accept 1920x1080, open happily,
 * and then send no picture at all: a black tile that never explains itself.
 * Stepping down is the way back from that — see SIZES below.
 */
export function openCamera(deviceId: string, step = 0): Promise<MediaStream> {
  const size = SIZES[Math.min(step, SIZES.length - 1)];
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: size
      ? { deviceId: { exact: deviceId }, width: { ideal: size[0] }, height: { ideal: size[1] } }
      : { deviceId: { exact: deviceId } },
  });
}

/**
 * What to ask a camera for, in order, until it actually sends a picture.
 *
 * Two cameras on one USB socket is the common case here — one on the room, one
 * on the door — and two 1080p cameras need more of that socket than it has.
 * One of them opens, reports success, and then sends nothing at all. Asking
 * for less is what gets a picture out of it; 720p is plenty for counting.
 */
const SIZES: ([number, number] | null)[] = [[1920, 1080], [1280, 720], [640, 480], null];

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

export function savedDevice(): DeviceCred | null {
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
  /** People who arrived and left, from following them between counts. */
  entries: number; exits: number;
  /** Face codes, only while face matching is switched on. Never a picture. */
  faces?: string[]; faces_age_s?: number;
  /** What this camera decided at the door since the last report, for showing. */
  events?: { at: number; kind: string }[];
}

export type Zone = [number, number, number, number];

/** Sends this browser's counts. Returns the cameras switched off on the website,
 *  each camera's "don't count this area" rectangles (0–1 fractions), and how sure
 *  the AI must be before someone is counted (the admin's Counting sensitivity). */
export async function sendReport(
  cameras: CameraReport[],
  /**
   * How face reading is going in this browser. `ready` is the honest answer to
   * "is it working": the face AI is loaded and looking, whether or not it
   * found a face this time. Nobody's face being visible is not a fault, and
   * sending no codes used to look exactly like a fault.
   */
  faces: { error?: string | null; ready?: boolean } = {},
): Promise<{ disabled: string[]; zones: Record<string, Zone[]>; countConfidence?: number; faceMatching: boolean; doorways: Record<string, Inward>; countFrom: number; service: string | null; doorMode: "in" | "out" | null }> {
  let dev = savedDevice() ?? await registerDevice();
  const post = (d: DeviceCred) => fetch("/api/devices/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.token}` },
    body: JSON.stringify({ version: CAMERA_MODE_VERSION, faces_error: faces.error ?? null, faces_ready: !!faces.ready,
      cameras: cameras.map((c) => ({ ...c, kind: "web" })) }),
  });
  let res = await post(dev);
  if (res.status === 401) {          // removed on the Cameras page → register again
    localStorage.removeItem(DEVICE_KEY);
    dev = await registerDevice();
    res = await post(dev);
  }
  if (!res.ok) throw new Error(`The website didn't accept the counts (${res.status})`);
  const body = await res.json().catch(() => ({}));
  const conf = Number(body.count_confidence);
  return {
    disabled: Array.isArray(body.disabled) ? body.disabled : [],
    zones: body.ignore_zones && typeof body.ignore_zones === "object" ? body.ignore_zones : {},
    countConfidence: Number.isFinite(conf) && conf >= 0.1 && conf <= 0.6 ? conf : undefined,
    faceMatching: !!body.face_matching,
    // Which cameras are watching a doorway, and which way is "in".
    doorways: body.doorways && typeof body.doorways === "object" ? body.doorways : {},
    // When a fresh start was last asked for, so this browser's tallies can
    // begin again from zero for a new session. 0 = never.
    countFrom: Number(body.count_from) || 0,
    // The service being recorded. People are remembered for as long as one
    // runs, and forgotten when it ends.
    service: typeof body.service === "string" ? body.service : null,
    // "auto", or an operator saying everybody at the door is arriving/leaving.
    doorMode: body.door_mode === "in" || body.door_mode === "out" ? body.door_mode : null,
  };
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
