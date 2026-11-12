/**
 * cameraMode.ts — counting people with cameras plugged into THIS computer,
 * inside the browser (no install). Loads the YOLO11 model, registers this
 * browser with the website as a camera computer (worker/venue.js), and sends
 * counts + a picture just like the Kyro Camera Box does.
 */
import { edgeFetch } from "@/lib/edgeAuth";
import type { Person } from "@/lib/peopleDetector";
import type { Inward } from "@/lib/personTracker";
import { startEngine, countWith, seatingWith } from "@/lib/countEngine";
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
  /** Chairs, benches and sofas, for finding the seats. One look, no tiles. */
  seating(px: ImageData): Promise<Person[]>;
}

const ENGINE_KEY = "kyro_engine_kind";

function engineOnPage(onProgress: (pct: number, step: string) => void): Promise<Engine> {
  let prefer: "accurate" | "light" | undefined;
  try { const v = localStorage.getItem(ENGINE_KEY); if (v === "accurate" || v === "light") prefer = v; } catch { /* fine without it */ }
  return startEngine(onProgress, prefer, (kind) => { try { localStorage.setItem(ENGINE_KEY, kind); } catch { /* fine */ } })
    .then((e) => ({ kind: e.kind, backend: e.backend,
      count: (px, tiles, fast) => countWith(e, px, tiles, fast),
      seating: (px) => seatingWith(e, px) }));
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
          seating: (px) => new Promise<Person[]>((ok, fail) => {
            const id = nextId++;
            waiting.set(id, { ok, fail });
            worker.postMessage({ type: "count", id, seating: true, px: { data: px.data, width: px.width, height: px.height } });
          }),
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

/**
 * How wide a picture is worth taking, before the AI even looks at it.
 *
 * Kyro asks every camera for 1920×1080, because more pixels means people
 * further away are still found. Then it took the whole two million of them off
 * the video, four bytes each, and copied all eight megabytes to the counter —
 * every single count. At three counts a second that is twenty-four megabytes a
 * second of pure copying, and it is pure waste: the AI resizes the picture to
 * 640 or 1280 square as its very first act, so nothing beyond that width was
 * ever looked at.
 *
 * Taking the picture at the size the AI will use makes each count several
 * times cheaper for the same answer — which at a doorway, where people cross
 * in under a second, is the difference between seeing somebody twice and
 * seeing them once.
 *
 * A little above the model's own size, so the resize has something to work
 * with and faces are still readable.
 */
const COUNT_WIDTH = 1280;          // a camera on a room: the accurate AI's size
const DOOR_WIDTH = 960;            // a doorway: the quick AI, and people are close

/**
 * Grabs the current picture from a <video> as RGBA pixels, no wider than
 * `maxWidth` — see COUNT_WIDTH. Everything downstream works in fractions of
 * the picture or in its own pixels, so nothing cares what size it is.
 */
export function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxWidth = COUNT_WIDTH) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export { COUNT_WIDTH, DOOR_WIDTH };

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
  if (!size) return navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: deviceId } } });
  /**
   * "ideal" on the first ask, a HARD CAP on every one after it.
   *
   * ── Why the stepping down did nothing ─────────────────────────────────
   *
   * Every step used `ideal`, which is a preference and not a limit: the
   * browser hands back whatever the camera likes best and calls that a
   * success. So asking for 1920x1080, then 1280x720, then 640x480 opened
   * the SAME stream three times. The retry ran, the counter went up, the
   * message changed — and the camera was still being asked for exactly what
   * it could not do.
   *
   * That is the whole fix for a HuddleCam. These are UVC cameras that offer
   * 1080p over MJPEG and lower sizes over raw video; on a USB 2 socket, or
   * sharing a controller with a second camera, there is not enough bandwidth
   * for 1080p and the camera answers with black frames or one frame over and
   * over rather than an error. Kyro's own message has been saying "it may
   * need to be asked for 1280x720 instead" for months while never actually
   * asking for it.
   *
   * `max` is a real constraint: the browser must come back at or under it,
   * or fail — and failing is fine, because the next step is smaller again.
   */
  const first = step === 0;
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: first
      ? { deviceId: { exact: deviceId }, width: { ideal: size[0] }, height: { ideal: size[1] } }
      : { deviceId: { exact: deviceId }, width: { max: size[0] }, height: { max: size[1] } },
  });
}

/** How long to let a camera's own autofocus settle before locking it. */
const FOCUS_SETTLE_MS = 3_000;

/**
 * Stop the camera hunting for focus, once it has found it.
 *
 * ── Why a webcam keeps going blurry ────────────────────────────────────────
 *
 * "HD Pro Webcam C920 — always loses focus."
 *
 * A webcam is built for a face at arm's length on a video call, so it refocuses
 * whenever the picture changes. Point it at a hall and the picture changes
 * constantly: somebody walks past the lens, a door opens, light moves. Each
 * time, it hunts — and every frame it spends hunting is a blurred frame, which
 * to the counting AI is a frame with fewer people in it. People are not missed
 * because Kyro decided they were not people; they are missed because they were
 * never in focus.
 *
 * The room does not move. A camera watching a fixed hall from a fixed tripod
 * needs to focus once and then never again, which is exactly what a camera
 * built for video calls will not do by itself.
 *
 * So: let its own autofocus settle on the scene for a few seconds, then lock
 * it there. Deliberately not locked immediately — locked at the instant of
 * opening, it would freeze on whatever the lens happened to be guessing,
 * possibly somebody's hand, and stay blurry for the whole service.
 *
 * Everything here is best-effort. Cameras differ wildly in what they will
 * admit to being able to do, several browsers support none of it, and a
 * camera that cannot lock its focus must still count people. Nothing below
 * may throw into the caller.
 */
/**
 * Make it look again.
 *
 * ── Why holding it is not enough ───────────────────────────────────────────
 *
 * "you see how blurry it is" — sent while the focus-holding was already
 * running and live.
 *
 * Two ways that happens, and this answers both. The camera may have settled
 * on the wrong thing in its three seconds — somebody walking past the lens as
 * counting started — and then been locked there for the rest of the service,
 * which is a fault Kyro introduced by locking at all. Or the camera is one of
 * the many that will not be locked, and is simply hunting.
 *
 * Either way the honest move is the same: hand it back to the camera, let it
 * look at the room properly, and try to hold it again. Done only when the
 * picture has actually gone soft, and only a few times, because a camera
 * being told to refocus every thirty seconds is a camera that is never in
 * focus.
 */
export async function refocus(stream: MediaStream): Promise<"locked" | "already steady" | "cannot"> {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== "function") return "cannot";
    const caps = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[] };
    if ((caps.focusMode ?? []).includes("continuous")) {
      // Back to the camera's own judgement, and give it the room to use it.
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as never] });
    }
  } catch { /* it may refuse; holdFocus will find out soon enough */ }
  return holdFocus(stream);
}

export async function holdFocus(stream: MediaStream): Promise<"locked" | "already steady" | "cannot"> {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== "function") return "cannot";
    const caps = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[] };
    const modes = caps.focusMode ?? [];
    // Nothing to stop: a camera with a fixed lens cannot lose focus.
    if (!modes.length) return "cannot";
    if (!modes.includes("manual")) return modes.includes("continuous") ? "cannot" : "already steady";
    // Let it look at the room first.
    await new Promise((r) => setTimeout(r, FOCUS_SETTLE_MS));
    const now = track.getSettings() as MediaTrackSettings & { focusDistance?: number };
    const hold: Record<string, unknown> = { focusMode: "manual" };
    // Hold it at whatever distance it just settled on, when it will say.
    if (typeof now.focusDistance === "number") hold.focusDistance = now.focusDistance;
    await track.applyConstraints({ advanced: [hold] } as MediaTrackConstraints);
    return "locked";
  } catch {
    return "cannot";
  }
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

/**
 * Open a camera, asking for less detail each time until one size actually
 * works — and only then give up.
 *
 * Stepping down already existed for a camera that opens and then sends
 * nothing. It did not exist for a camera that refuses to open at all, which
 * is the same fault one step earlier: a second camera on a shared USB socket
 * has no bandwidth left for 1920x1080, so the browser throws rather than
 * hands back a black picture. Kyro asked once, at the largest size, failed,
 * and said "Another program is using this camera" about a camera no program
 * was using. 720p counts people perfectly well.
 */
/**
 * The picture size that last worked for a camera, remembered per camera.
 *
 * A HuddleCam on a USB 2 socket cannot carry 1920x1080, and it says so by
 * sending black frames or the same frame over and over rather than by
 * failing. So Kyro asks for less, finds 1280x720 works, and counts happily —
 * until the next time counting is started, when it begins at 1080p again and
 * goes through the whole black-picture dance a second time, and a third.
 *
 * It is the same camera on the same socket. Remember what worked and start
 * there. Nothing is locked in: every step below the remembered one is still
 * tried if it stops opening, and moving the camera to a better socket is
 * picked up the next time the remembered size fails.
 */
const SIZE_KEY = "kyro_camera_size";

function rememberedStep(deviceId: string): number {
  try {
    const all = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "{}") as Record<string, number>;
    const n = all[deviceId];
    return Number.isInteger(n) && n > 0 && n < SIZES.length ? n : 0;
  } catch { return 0; }
}

/** Remember the size a camera actually works at. Step 0 forgets it. */
export function rememberCameraStep(deviceId: string, step: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "{}") as Record<string, number>;
    if (step > 0) all[deviceId] = step;
    else delete all[deviceId];
    localStorage.setItem(SIZE_KEY, JSON.stringify(all));
  } catch { /* fine without it */ }
}

export async function openCameraAnySize(deviceId: string): Promise<MediaStream> {
  let last: unknown = new Error("No camera");
  // Start at whatever worked last time for this camera, then keep stepping
  // down. Nothing is skipped on the way out — the remembered step is a head
  // start, not a cage.
  for (let step = rememberedStep(deviceId); step < SIZES.length; step++) {
    try {
      const stream = await openCamera(deviceId, step);
      rememberCameraStep(deviceId, step);
      return stream;
    } catch (e) {
      last = e;
      // Not being allowed to use cameras at all is not a size problem, and
      // asking four times only makes four identical refusals.
      if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "SecurityError")) break;
    }
  }
  throw last;
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
  /** "offline" is this camera saying goodbye: counting has been switched off
   *  here. The website marks it off at once and throws away its last picture,
   *  rather than showing it for the forty-five seconds it takes to notice
   *  silence. */
  key: string; label: string; current: number; peak: number; status: "online" | "error" | "offline"; error?: string | null;
  fps: number; width: number; height: number;
  /** People who arrived and left, from following them between counts. */
  entries: number; exits: number;
  /** How many DIFFERENT people this camera has seen this service. */
  people_seen?: number;
  /** The middle time a person stays in this camera's view, in seconds — how
   *  a doorway is told from a room. See typicalLifeS in personTracker.ts. */
  life_s?: number;
  /** Everyone it is following: this camera's own id for them, an appearance
   *  reading, and a face code while face matching is on. Never a picture. */
  seen?: { t: number; l: number[] | null; f: string | null; s?: string | null; q?: number }[];
  /** Which seats are taken: [seat id, state, seconds vacant, confidence]. */
  seats?: [string, string, number, number][];
  /** What the picture itself is like — connected is not working. */
  black?: boolean; frozen?: boolean; no_picture?: boolean; counted_at?: number;
  /** Face codes, only while face matching is switched on. Never a picture. */
  faces?: string[]; faces_age_s?: number;
  /** What this camera decided at the door since the last report, for showing. */
  events?: { at: number; kind: string }[];
}

export type Zone = [number, number, number, number];

/** A crop of one person that Kyro wants, for a question somebody will answer. */
export interface WantedPicture { id: string; side: "a" | "b"; key: string; track: number }

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
  /** Whatever has gone wrong in this browser since the last report. */
  problems: { where: string; what: string; detail?: string }[] = [],
  /** Cameras that are fine right now, by name. The other half of `problems`:
   *  a problem is only ever cleared by the thing that failed working again,
   *  and nothing was saying when a camera came right. */
  well: string[] = [],
): Promise<{ disabled: string[]; zones: Record<string, Zone[]>; countConfidence?: number; faceMatching: boolean; doorways: Record<string, Inward>; countFrom: number; service: string | null; doorMode: "in" | "out" | null; seenTwice: number ; wantPictures: WantedPicture[];
  /** Per camera key, this camera's own track number → the person's number in
   *  the register. See `people` in worker/venue.js. */
  people: Record<string, Record<number, number>> }> {
  let dev = savedDevice() ?? await registerDevice();
  const post = (d: DeviceCred) => fetch("/api/devices/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.token}` },
    body: JSON.stringify({ version: CAMERA_MODE_VERSION, faces_error: faces.error ?? null, faces_ready: !!faces.ready,
      problems: problems.slice(0, 10), well: well.slice(0, 32),
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
    // How many of this computer's sightings are one person seen by two of its
    // cameras. A camera cannot know this; the website can, because it sees
    // every camera at once. See seen_twice in worker/venue.js.
    seenTwice: Math.max(0, Number(body.seen_twice) || 0),
    /**
     * Who each sighting turned out to be, so the picture can be labelled with
     * the number Kyro actually counts somebody as rather than the camera's
     * own scratch number for a box — which is reissued whenever the detector
     * loses them, and is not an identity. See `people` in worker/venue.js.
     */
    people: body.people && typeof body.people === "object" ? body.people : {},
    // People Kyro wants a human to look at. See sendPersonPicture.
    wantPictures: (Array.isArray(body.want_pictures) ? body.want_pictures : [])
      .filter((w: unknown): w is WantedPicture => {
        const x = w as WantedPicture;
        return !!x && typeof x.id === "string" && (x.side === "a" || x.side === "b")
          && typeof x.key === "string" && Number.isFinite(x.track);
      })
      .slice(0, 24),
  };
}

/**
 * The seats Kyro has found on this camera, sent to the website.
 *
 * The same endpoint the installed camera computer has always used, so the
 * website needs no new idea of where seats come from: it stores them as a
 * layout called "Found by Kyro", keeps any reservations against seats that
 * are still there, and sets the room's seat count from it.
 */
export async function sendSeats(key: string, seats: unknown[], stage: "top" | "bottom"): Promise<{ active?: boolean } | null> {
  const dev = savedDevice();
  if (!dev) return null;
  const res = await fetch("/api/devices/auto-seats", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${dev.token}` },
    body: JSON.stringify({ camera: key, seats, stage }),
  });
  return res.ok ? res.json().catch(() => null) : null;
}

/**
 * A crop of one person, for an "is this the same person?" question.
 *
 * The only place a picture of a particular person exists is the browser doing
 * the counting — the video never leaves the computer it is plugged into. So
 * when Kyro wants a human to look at two sightings, it asks here.
 *
 * Cropped to the box round that one person and nobody else, with a little
 * room around them so a coat and a build are visible, and small. It is
 * deleted the moment the question is answered.
 */
export function cropOf(
  canvas: HTMLCanvasElement, box: [number, number, number, number], width = 240,
): HTMLCanvasElement | null {
  const [x1, y1, x2, y2] = box;
  const pad = Math.max(8, (x2 - x1) * 0.25);
  const sx = Math.max(0, Math.round(x1 - pad)), sy = Math.max(0, Math.round(y1 - pad));
  const sw = Math.min(canvas.width - sx, Math.round(x2 - x1 + pad * 2));
  const sh = Math.min(canvas.height - sy, Math.round(y2 - y1 + pad * 2));
  if (sw < 8 || sh < 8) return null;
  // Big enough to recognise somebody by, small enough to be nothing else.
  const scale = Math.min(1, width / sw);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  out.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

export async function sendPersonPicture(id: string, side: "a" | "b", crop: HTMLCanvasElement): Promise<void> {
  const dev = savedDevice();
  if (!dev) return;
  const blob = await new Promise<Blob | null>((r) => crop.toBlob(r, "image/jpeg", 0.72));
  if (!blob) return;
  await fetch(`/api/devices/question-snapshot?id=${encodeURIComponent(id)}&side=${side}`, {
    method: "PUT", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${dev.token}` }, body: blob,
  }).catch(() => {});
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
