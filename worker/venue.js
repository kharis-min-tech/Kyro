/**
 * VenueHub (Durable Object) — the live link between the camera computer at
 * church ("Kyro Camera Box", camera-box/) and the website.
 *
 * Holds: paired camera computers, one-time pairing codes, the cameras each
 * box reports (with the room / seat count an admin sets on the website),
 * the latest live counts, a per-minute history for charts, and the latest
 * picture per camera. A camera plugged into the box appears here on the
 * box's next report — nothing to set up on the website.
 */
import { DurableObject } from "cloudflare:workers";
import { notifyCount } from "./index.js";

const enc = new TextEncoder();
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const b64url = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const sha256 = async (text) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const num = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};

const OFFLINE_AFTER_MS = 45_000;  // no report for this long → camera shown offline
const SAMPLE_EVERY_MS = 60_000;   // one history row per camera per minute
const MAX_SNAPSHOT_BYTES = 120_000;   // a stored value is capped at 128 KB
const ALERT_GAP_MS = 10 * 60_000; // per room, between "filling up" phone alerts
const JOB_TTL_MS = 2 * 60_000;    // "Find cameras" / "Add this camera" requests (and any login in them) expire

const MAX_SEATS = 900;            // per camera: a stored value is capped at 128 KB
const SAFE_VALUE_BYTES = 110_000; // comfortably inside that 128 KB
const SERVICE_START_PEOPLE = 5;   // this many people in the venue …
const SERVICE_START_MS = 2 * 60_000;   // … for this long = a service has started
const SERVICE_END_PEOPLE = 3;     // fewer than this …
const SERVICE_END_MS = 15 * 60_000;    // … for this long = the service has ended
const PEAK_HOLD_MS = 10_000;      // a service's "busiest" number must hold this long
/** "Sunday morning service", from the church's local time. */
function serviceName(ms) {
  const tz = "Europe/London";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(new Date(ms));
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(ms));
  return `${day} ${part} service · ${date}`;
}
const QUESTION_TTL_MS = 10 * 60_000;  // unanswered AI questions stay listed this long
// Face codes older than this aren't compared. The box refreshes every 4 s and
// reports every 2 s, so this must comfortably exceed both or de-duplication
// flickers on and off and the total jumps about. Over-subtraction from a code
// that outlives the person is prevented by the clamp in venueTotal(), not here.
const FACE_FRESH_MS = 10_000;
const DEFAULT_COUNT_CONFIDENCE = 0.3;   // matches the camera computer's own default
const MOVED_AFTER_MS = 10 * 60_000;  // a camera must be gone this long before another computer claims it
const MAX_WEB_DEVICES = 50;       // Camera Mode browsers kept at once
const FACE_SAME = 0.5;                // SFace cosine similarity for "same person" (strict: no false merges)
const QUESTION_TYPES = ["stage_question", "front_rush_question", "absence_question", "zone_proposal", "altar_call_question", "seat_question"];
function cleanQuestion(q, camera_id) {
  if (!q || !q.review_id) return null;
  return {
    type: "review_request", review_id: clean(q.review_id, 60), camera_id,
    review_type: QUESTION_TYPES.includes(q.review_type) ? q.review_type : "absence_question",
    target_role: q.target_role === "admin" ? "admin" : "operator", question: clean(q.question, 300),
    track_id: num(q.track_id, -1, 1e9), seat_id: q.seat_id ? clean(q.seat_id, 40) : null,
    position: Array.isArray(q.position) ? q.position.slice(0, 2).map((v) => Number(v) || 0) : [0, 0],
    bbox_hint: Array.isArray(q.bbox_hint) ? q.bbox_hint.slice(0, 4).map((v) => Number(v) || 0) : null,
    confidence: Math.min(1, Math.max(0, Number(q.confidence) || 0)), best_guess: clean(q.best_guess, 60),
    options: (Array.isArray(q.options) ? q.options : []).slice(0, 6).map((o) => clean(o, 60)).filter(Boolean),
    created_at: Number(q.created_at) || Date.now() / 1000,
  };
}
/** A face code from the camera computer (128 float16 numbers, base64) → Float32Array. */
function unpackFace(b64) {
  try {
    const bin = atob(String(b64));
    if (bin.length !== 256) return null;
    const u16 = new Uint16Array(128);
    for (let i = 0; i < 128; i++) u16[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    const out = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
      out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? 0 : s * (1 + m / 1024) * 2 ** (e - 15);
    }
    let n = 0; for (const v of out) n += v * v; n = Math.sqrt(n) || 1;
    for (let i = 0; i < 128; i++) out[i] /= n;
    return out;
  } catch { return null; }
}
const SEAT_STATES = ["occupied", "temporarily_vacant", "likely_available", "available", "reserved", "rota_hold", "unknown"];
/** A seat drawn on the camera's picture (1280×720 coordinates). */
function cleanSeatDef(s) {
  if (!s || !Array.isArray(s.bbox) || s.bbox.length !== 4) return null;
  const b = s.bbox.map((v, i) => Math.min(i % 2 ? 720 : 1280, Math.max(0, Math.round(Number(v) * 10) / 10 || 0)));
  if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return null;
  return { seat_id: clean(s.seat_id, 24) || null, row: clean(s.row, 10), number: num(s.number, 0, 10000), section: clean(s.section, 24) || "Main",
    bbox: b, reserved: !!s.reserved, reserved_for: s.reserved ? clean(s.reserved_for, 60) || null : null };
}
/** [seat_id, state, seconds vacant, confidence] from the camera computer. */
function cleanSeatState(s) {
  if (!Array.isArray(s)) return null;
  const state = SEAT_STATES.includes(s[1]) ? s[1] : "unknown";
  return [clean(s[0], 40), state, num(s[2], 0, 86400), Math.round(Math.min(1, Math.max(0, Number(s[3]) || 0)) * 100) / 100];
}

/** Up to 10 rectangles [x1, y1, x2, y2] as 0–1 fractions of the picture. */
function cleanZones(z) {
  if (!Array.isArray(z)) return [];
  return z.slice(0, 10).map((r) => (Array.isArray(r) ? r.slice(0, 4).map((v) => Math.min(1, Math.max(0, Number(v) || 0))) : null))
    .filter((r) => r && r.length === 4 && r[2] - r[0] > 0.005 && r[3] - r[1] > 0.005)
    .map((r) => r.map((v) => Math.round(v * 10000) / 10000));
}

export class VenueHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lastSample = new Map();
    this.seenAt = new Map();   // camera_id → when its computer last said it's plugged in
    // Face matching (only while switched on): camera_id → { at, codes: Float32Array[] }.
    // Kept in memory only, for under a minute — never written to storage.
    this.faceCodes = new Map();
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS history (ts INTEGER NOT NULL, camera_id TEXT NOT NULL, current INTEGER, entries INTEGER, exits INTEGER, capacity INTEGER)",
      );
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS history_cam_ts ON history (camera_id, ts)");
    });
  }

  async get(key, fallback) { return (await this.ctx.storage.get(key)) ?? fallback; }

  // Seat layouts and live seat states are kept one key PER CAMERA. A single
  // storage value is capped at 128 KB, and one 1,000-seat room already fills it —
  // sharing one key across cameras made every report fail once a big room was found.
  // The seats themselves live one key PER LAYOUT, because a stored value is
  // capped at 128 KB and a big room's seats fill most of one on their own.
  async layoutsOf(camera_id) { return await this.get(`layouts:${camera_id}`, []); }
  async putLayouts(camera_id, list) {
    await this.ctx.storage.put(`layouts:${camera_id}`, list.map(({ seats, ...meta }) => meta));
    for (const l of list) {
      if (!l.seats) continue;
      // Last line of defence: whatever the seat names are, this must fit one stored value.
      let seats = l.seats;
      while (seats.length && JSON.stringify(seats).length > SAFE_VALUE_BYTES) seats = seats.slice(0, Math.floor(seats.length * 0.9));
      if (seats.length !== l.seats.length) console.log(`trimmed ${camera_id} layout ${l.id} to ${seats.length} seats to fit storage`);
      await this.ctx.storage.put(`lseats:${camera_id}:${l.id}`, seats);
    }
  }
  async seatsOf(camera_id, id) { return await this.get(`lseats:${camera_id}:${id}`, []); }
  /** A layout with its seats loaded. */
  async layoutWithSeats(camera_id, l) { return l ? { ...l, seats: await this.seatsOf(camera_id, l.id) } : null; }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const role = request.headers.get("X-Kyro-Role") || "";   // set by index.js after checking the session
    try {
      // ── Inside the Worker only (index.js never forwards /internal/*) ──
      if (p === "/internal/day-peaks" && request.headers.get("X-Kyro-Internal") === "1") return json(await this.dayPeaks(url.searchParams.get("date") || "", url.searchParams.get("tz") || "UTC"));

      // ── Camera computer (device token) ──
      if (p === "/api/devices/pair" && request.method === "POST") return this.pair(request);
      if (p === "/api/devices/report" && request.method === "POST") return this.withDevice(request, (d) => this.report(d, request));
      if (p === "/api/devices/snapshot" && request.method === "PUT") return this.withDevice(request, (d) => this.snapshot(d, request, url));
      if (p === "/api/devices/stream") return this.withDevice(request, (d) => this.boxStream(d, request));
      if (p === "/api/devices/auto-seats" && request.method === "POST") return this.withDevice(request, (d) => this.autoSeats(d, request));
      if (p === "/api/devices/question-snapshot" && request.method === "PUT") return this.withDevice(request, (d) => this.questionSnapshot(d, request, url));
      if (p === "/api/devices/seats" && request.method === "GET") return this.withDevice(request, (d) => this.boxSeats(d, url));
      if (p === "/api/devices/job" && request.method === "POST") return this.withDevice(request, (d) => this.jobResult(d, request));

      // ── Website (signed-in user) ──
      if (!role) return json({ error: "Please sign in again" }, 401);
      if (p === "/api/live/cameras" && request.method === "GET") return json(await this.cameraList(url.searchParams.get("all") === "1"));
      if (p === "/api/live/venue" && request.method === "GET") return json(await this.venueTotal());
      if (p === "/api/live/history" && request.method === "GET") return json(this.history(url));
      if (p === "/api/live/daily" && request.method === "GET") return json(await this.daily(url));
      if (p.startsWith("/api/live/snapshot/") && request.method === "GET") return this.getSnapshot(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/watch/")) {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can watch the live cameras" }, 403);
        return this.watch(decodeURIComponent(p.split("/").pop()), request);
      }
      const user = decodeURIComponent(request.headers.get("X-Kyro-User") || "");
      // A role is derived from the pages someone was given, so "Analytics only"
      // comes out as operator. Check the actual page too, or that person could
      // change the rota or black out part of the hall with an ignore area.
      const pages = (request.headers.get("X-Kyro-Pages") || "").split(",").filter(Boolean);
      const mayUse = (page) => role === "admin" || pages.includes(page);
      if (p === "/api/live/questions" && request.method === "GET") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators see AI questions" }, 403);
        return json(await this.listQuestions(role));
      }
      const qm = p.match(/^\/api\/live\/questions\/([\w-]+)\/(answer|snapshot)$/);
      // A question's photo shows people in the building: only those it's asked of may see it.
      if (qm && role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators see AI questions" }, 403);
      if (qm && qm[2] === "snapshot" && request.method === "GET") return this.getQuestionSnapshot(qm[1], role);
      if (qm && qm[2] === "answer" && request.method === "POST") return this.answerQuestion(qm[1], role, user, request);
      if (p === "/api/live/rota" && request.method === "GET") return json(await this.get("rota", []));
      if (p.startsWith("/api/live/zones/") && request.method === "GET") return json((await this.get("seat_zones", {}))[decodeURIComponent(p.split("/").pop())] ?? []);
      if (p === "/api/live/privacy" && request.method === "GET") return json(await this.privacy());
      if (p === "/api/live/counting" && request.method === "GET") return json(await this.counting());
      if (p === "/api/live/services" && request.method === "GET") return json(await this.listServices());
      if (p === "/api/live/services-deleted" && request.method === "GET") return json(await this.get("deleted_services", []));
      const svc = p.match(/^\/api\/live\/services\/([\w-]+)(?:\/(keep|end|rename))?$/);
      if (svc && role !== "admin") return json({ error: "Only administrators can keep, rename or delete a service" }, 403);
      if (svc && svc[2] === "keep" && request.method === "POST") return this.keepService(svc[1], user);
      if (svc && svc[2] === "end" && request.method === "POST") return this.endServiceNow(svc[1]);
      if (svc && svc[2] === "rename" && request.method === "POST") return this.renameService(svc[1], request);
      if (svc && !svc[2] && request.method === "DELETE") return this.deleteService(svc[1], user, url.searchParams.get("counts") === "1");
      if (["/api/live/rota", "/api/live/zones/"].some((x) => p.startsWith(x))) {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can change this" }, 403);
        const page = p.startsWith("/api/live/rota") ? "rota" : "seating";
        if (!mayUse(page)) return json({ error: `You don't have the ${page === "rota" ? "Rota" : "Seat Map"} page` }, 403);
      }
      if (p === "/api/live/rota" && request.method === "POST") return this.addRota(request);
      if (p.startsWith("/api/live/rota/") && request.method === "DELETE") return this.removeRota(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/zones/") && request.method === "PUT") return this.saveZones(decodeURIComponent(p.split("/").pop()), request);
      if (p.startsWith("/api/live/seat-states/") && request.method === "GET") return json(await this.seatStates(decodeURIComponent(p.split("/").pop())));
      const lay = p.match(/^\/api\/live\/seats\/([^/]+)\/layouts(?:\/(\d+)(\/activate)?)?$/);
      if (lay && request.method === "GET" && !lay[2]) return json(await this.listLayouts(decodeURIComponent(lay[1])));

      if (p === "/api/live/browser-device" && request.method === "POST") {
        // Camera mode: a signed-in admin/operator's browser becomes a camera computer — no code needed.
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can use Camera mode" }, 403);
        return this.registerBrowser(request);
      }
      if (p.startsWith("/api/live/seat-reserve/") && request.method === "POST") {
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can reserve seats" }, 403);
        if (!mayUse("seating")) return json({ error: "You don't have the Seat Map page" }, 403);
        return this.reserveSeats(decodeURIComponent(p.split("/").pop()), request);
      }
      if (role !== "admin") return json({ error: "Only administrators can change camera settings" }, 403);
      if (p === "/api/live/pairing-code" && request.method === "POST") return this.newPairingCode();
      if (p === "/api/live/devices" && request.method === "GET") return json(await this.deviceList());
      if (p.startsWith("/api/live/devices/") && request.method === "DELETE") return this.removeDevice(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/cameras/") && request.method === "PATCH") return this.updateCamera(decodeURIComponent(p.split("/").pop()), request);
      if (p.startsWith("/api/live/cameras/") && request.method === "DELETE") return this.removeCamera(decodeURIComponent(p.split("/").pop()));
      if (p === "/api/live/streams" && request.method === "POST") return this.addStream(request);
      if (lay && request.method === "POST" && !lay[2]) return this.createLayout(decodeURIComponent(lay[1]), request);
      if (lay && request.method === "POST" && lay[3]) return this.activateLayout(decodeURIComponent(lay[1]), Number(lay[2]));
      if (lay && request.method === "DELETE" && lay[2] && !lay[3]) return this.deleteLayout(decodeURIComponent(lay[1]), Number(lay[2]));
      if (p === "/api/live/privacy" && request.method === "PUT") return this.setPrivacy(request, user);
      if (p === "/api/live/counting" && request.method === "PUT") return this.setCounting(request);
      if (p === "/api/live/find-cameras" && request.method === "POST") return this.findCameras();
      if (p === "/api/live/find-cameras" && request.method === "GET") return json(await this.foundCameras());
      if (p === "/api/live/find-cameras/add" && request.method === "POST") return this.addFound(request);
      if (p.startsWith("/api/live/find-cameras/add/") && request.method === "GET") return json(await this.addStatus(decodeURIComponent(p.split("/").pop())));
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Error" }, 500);
    }
  }

  // ── Pairing ────────────────────────────────────────────────────────────────

  async newPairingCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    const expires = Date.now() + 30 * 60_000;
    await this.ctx.storage.put(`pair:${code}`, { expires });
    return json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_at: new Date(expires).toISOString() });
  }

  async pair(request) {
    const body = await request.json().catch(() => ({}));
    const code = clean(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const entry = await this.ctx.storage.get(`pair:${code}`);
    if (!entry || entry.expires < Date.now()) return json({ error: "That code isn't valid or has expired — get a new one on the Cameras page" }, 403);
    await this.ctx.storage.delete(`pair:${code}`);
    const id = `box-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const devices = await this.get("devices", {});
    devices[id] = {
      id, name: clean(body.name, 60) || "Camera computer", platform: clean(body.platform, 40),
      token_hash: await sha256(token), paired_at: new Date().toISOString(), last_seen: null, version: clean(body.version, 20),
    };
    await this.ctx.storage.put("devices", devices);
    return json({ device_id: id, token });
  }

  async registerBrowser(request) {
    const body = await request.json().catch(() => ({}));
    const id = `web-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`;
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const devices = await this.get("devices", {});
    // Every Camera Mode browser adds an entry. Without a limit the device list
    // eventually outgrows one stored value and then EVERY camera report fails,
    // so drop ones that haven't counted for a day, then the oldest beyond the cap.
    const web = Object.values(devices).filter((d) => d.id.startsWith("web-"));
    const stale = (d) => Date.now() - Date.parse(d.last_seen || d.paired_at) > 24 * 3600_000;
    for (const d of web) if (stale(d)) delete devices[d.id];
    const left = Object.values(devices).filter((d) => d.id.startsWith("web-"))
      .sort((a, b) => Date.parse(b.last_seen || b.paired_at) - Date.parse(a.last_seen || a.paired_at));
    for (const d of left.slice(MAX_WEB_DEVICES - 1)) delete devices[d.id];
    devices[id] = {
      id, name: clean(body.name, 60) || "Camera mode", platform: "Web browser",
      token_hash: await sha256(token), paired_at: new Date().toISOString(), last_seen: null, version: clean(body.version, 20),
    };
    await this.ctx.storage.put("devices", devices);
    return json({ device_id: id, token });
  }

  async withDevice(request, fn) {
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Not paired" }, 401);
    const hash = await sha256(token);
    const devices = await this.get("devices", {});
    const device = Object.values(devices).find((d) => d.token_hash === hash);
    if (!device) return json({ error: "This camera computer was removed — pair it again" }, 401);
    return fn(device);
  }

  async deviceList() {
    const devices = await this.get("devices", {});
    const cams = await this.get("cameras", {});
    return Object.values(devices).map((d) => ({
      id: d.id, name: d.name, platform: d.platform, version: d.version, paired_at: d.paired_at, last_seen: d.last_seen,
      online: !!d.last_seen && Date.now() - Date.parse(d.last_seen) < OFFLINE_AFTER_MS,
      cameras: Object.values(cams).filter((c) => c.device_id === d.id && !c.hidden).length,
    }));
  }

  async removeDevice(id) {
    const devices = await this.get("devices", {});
    if (!devices[id]) return json({ error: "No such camera computer" }, 404);
    delete devices[id];
    await this.ctx.storage.put("devices", devices);
    return json({ removed: true });
  }

  // ── Reports from the camera computer ──────────────────────────────────────

  async report(device, request) {
    const body = await request.json().catch(() => ({}));
    const now = Date.now();
    const cams = await this.get("cameras", {});
    const live = await this.get("live", {});
    const newQuestions = [];
    // Face matching runs only while a service is being recorded (and only if switched on).
    const faceOn = (await this.privacy()).face_matching && !!(await this.get("service_live", null));
    if (!faceOn) this.faceCodes.clear();
    let changed = false;

    for (const c of Array.isArray(body.cameras) ? body.cameras.slice(0, 32) : []) {
      const key = clean(c.key, 80);
      if (!key) continue;
      const camera_id = `${device.id}:${key}`;
      // Network cameras only exist once an admin adds them on the website; a
      // report for one that was just removed must not bring it back.
      if (!cams[camera_id] && !key.startsWith("usb-") && !key.startsWith("web-")) continue;
      if (!cams[camera_id]) {
        // A newly plugged-in camera (camera computer or Camera mode): add it with sensible defaults.
        const n = Object.keys(cams).length + 1;
        const label = clean(c.label, 60);
        const kind = clean(c.kind, 10) || "usb";
        cams[camera_id] = {
          camera_id, device_id: device.id, key, kind, label,
          name: label || `Camera ${n}`, zone_name: label || `Camera ${n}`,
          zone_capacity: 0, zone_order: n, location: "indoor", hidden: false, created_at: new Date(now).toISOString(),
          // A camera plugged into a camera computer waits for an admin to say
          // "yes, add it" (the website asks). Camera Mode cameras were started on purpose.
          pending: kind === "usb",
        };
        // The same camera moved from another computer? It keeps its name, room, seats and history — no need to ask.
        const old = this.movedFrom(cams, live, camera_id, device.id, label);
        if (old) { await this.takeOver(cams, live, old, camera_id); cams[camera_id].pending = false; }
        changed = true;
      }
      this.seenAt.set(camera_id, now);
      if (cams[camera_id].hidden || cams[camera_id].pending || c.status === "standby") continue;
      live[camera_id] = {
        current: num(c.current, 0, 100000), peak: num(c.peak, 0, 100000),
        entries: num(c.entries, 0, 10000000), exits: num(c.exits, 0, 10000000),
        status: ["online", "error", "offline"].includes(c.status) ? c.status : "online",
        error_reason: c.error ? clean(c.error, 120) : null, fps: Number(c.fps) || 0,
        width: num(c.width, 0, 10000), height: num(c.height, 0, 10000), updated_at: now,
      };
      if (Array.isArray(c.questions) && c.questions.length) newQuestions.push(...c.questions.slice(0, 10).map((q) => cleanQuestion(q, camera_id)).filter(Boolean));
      if (Array.isArray(c.faces) && faceOn) {
        this.faceCodes.set(camera_id, { at: now - Math.min(30, Number(c.faces_age_s) || 0) * 1000, codes: c.faces.slice(0, 250).map(unpackFace).filter(Boolean) });
      }
      if (Array.isArray(c.seats)) {
        // Its own key, and its own try/catch: seat colours are cosmetic, the count is not.
        try {
          await this.ctx.storage.put(`seat_live:${camera_id}`,
            { at: now, seats: c.seats.slice(0, MAX_SEATS).map(cleanSeatState).filter(Boolean) });
        } catch (e) { console.log("seat states too big to store", camera_id, e && e.message); }
      }
      if (now - (this.lastSample.get(camera_id) ?? 0) >= SAMPLE_EVERY_MS) {
        this.lastSample.set(camera_id, now);
        const l = live[camera_id];
        this.ctx.storage.sql.exec("INSERT INTO history VALUES (?, ?, ?, ?, ?, ?)",
          now, camera_id, l.current, l.entries, l.exits, cams[camera_id].zone_capacity || 0);
      }
    }

    const devices = await this.get("devices", {});
    if (devices[device.id]) {
      devices[device.id].last_seen = new Date(now).toISOString();
      if (body.version) devices[device.id].version = clean(body.version, 20);
      await this.ctx.storage.put("devices", devices);
    }
    if (changed) await this.ctx.storage.put("cameras", cams);
    await this.ctx.storage.put("live", live);
    await this.capacityAlerts(cams, live);
    try { await this.trackService(now); } catch (e) { console.log("service tracking failed", e && e.message); }

    // Tell the box which cameras it may use (added on the website) and which not.
    const mine = Object.values(cams).filter((c) => c.device_id === device.id && c.kind !== "network");
    const allowed = mine.filter((c) => !c.hidden && !c.pending).map((c) => c.key);
    const off = mine.filter((c) => c.hidden || c.pending).map((c) => c.key);
    const urls = await this.get("streams", {});
    const streams = Object.values(cams)
      .filter((c) => c.device_id === device.id && c.kind === "network" && !c.hidden && urls[c.camera_id])
      .map((c) => ({ key: c.key, url: urls[c.camera_id] }));
    // "Don't count this area" (e.g. a statue), per camera, as 0–1 fractions of the picture.
    const ignore_zones = Object.fromEntries(Object.values(cams)
      .filter((c) => c.device_id === device.id && c.ignore_zones?.length).map((c) => [c.key, c.ignore_zones]));
    // Requests waiting for this computer ("Find cameras", "Add this camera").
    const jobs = await this.jobsFor(device.id);
    if (newQuestions.length) await this.addQuestions(newQuestions);
    // Answers to the AI's questions, for this computer's cameras (delivered once).
    const answers = await this.takeAnswers(device.id);
    // Rota holds and stage / ignore areas, per camera (small; sent every time).
    const rota = await this.get("rota", []);
    const zonesAll = await this.get("seat_zones", {});
    const rotaFor = {}, zonesFor = {};
    for (const c of Object.values(cams)) {
      if (c.device_id !== device.id) continue;
      const r = rota.filter((e) => !e.camera_id || e.camera_id === c.camera_id);
      if (r.length) rotaFor[c.key] = r;
      if (zonesAll[c.camera_id]?.length) zonesFor[c.key] = zonesAll[c.camera_id];
    }
    // Seat layouts: only a version number each time; the box fetches a layout when it changes.
    const seat_layouts = {};
    for (const c of Object.values(cams)) {
      if (c.device_id !== device.id) continue;
      const a = (await this.layoutsOf(c.camera_id)).find((l) => l.is_active);
      if (a) seat_layouts[c.key] = `${a.id}.${a.version ?? 0}`;
    }
    return json({ ok: true, allowed, disabled: off, streams, ignore_zones, jobs, seat_layouts, answers, rota: rotaFor, seat_zones: zonesFor,
      face_matching: faceOn, count_confidence: (await this.counting()).count_confidence,
      report_every_s: 2, snapshot_every_s: 20 });
  }

  /** An offline camera on another computer with the same (specific) name — the camera was moved. */
  movedFrom(cams, live, camera_id, device_id, label) {
    const norm = (x) => String(x || "").toLowerCase().replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/, "").replace(/\s+/g, " ").trim();
    const want = norm(label);
    // Names every computer has (or that say nothing about the camera) can't identify one.
    if (!want || /^(usb camera|camera|webcam|usb video device)( \d+)?$/.test(want)
      || /facetime|integrated|built-?in|iphone|ipad|desk view|virtual|obs/.test(want)) return null;
    // Only a camera that has been gone a good while, and the same sort of camera.
    // (Two computers starting together must not steal each other's cameras: the
    // loser would come back as a brand-new "pending" camera and count nothing.)
    const kind = cams[camera_id]?.kind;
    const gone = (id) => !this.isOnline(live[id]) && Date.now() - (live[id]?.updated_at ?? 0) > MOVED_AFTER_MS;
    const matches = Object.values(cams).filter((o) => o.camera_id !== camera_id && o.device_id !== device_id
      && o.kind !== "network" && o.kind === kind && norm(o.label ?? o.name) === want && gone(o.camera_id));
    // Most recently used first.
    matches.sort((a, b) => (live[b.camera_id]?.updated_at ?? 0) - (live[a.camera_id]?.updated_at ?? 0));
    return matches[0] ?? null;
  }

  /** Moves a camera's settings and history onto its new record, and removes the old one. */
  async takeOver(cams, live, old, camera_id) {
    const c = cams[camera_id];
    for (const k of ["name", "zone_name", "zone_capacity", "zone_order", "location", "hidden", "created_at"]) c[k] = old[k];
    this.ctx.storage.sql.exec("UPDATE history SET camera_id = ? WHERE camera_id = ?", camera_id, old.camera_id);
    delete cams[old.camera_id];
    delete live[old.camera_id];
    await this.ctx.storage.delete(`snap:${old.camera_id}`);
  }

  async snapshot(device, request, url) {
    const key = clean(url.searchParams.get("camera"), 80);
    const buf = await request.arrayBuffer();
    if (!key || buf.byteLength === 0 || buf.byteLength > MAX_SNAPSHOT_BYTES) return json({ error: "Bad picture" }, 400);
    await this.ctx.storage.put(`snap:${device.id}:${key}`, { at: Date.now(), data: buf });
    return json({ ok: true });
  }

  async getSnapshot(camera_id) {
    const s = await this.ctx.storage.get(`snap:${camera_id}`);
    if (!s) return new Response("No picture yet", { status: 404 });
    return new Response(s.data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Taken-At": new Date(s.at).toISOString() } });
  }

  // ── Live video ─────────────────────────────────────────────────────────────
  // The camera computer keeps a WebSocket open here. While someone is watching a
  // camera, it sends that camera's newest picture over and over (live video);
  // each picture goes straight on to everyone watching. Nobody watching → it
  // sends nothing, so no internet is used for video.

  boxStream(device, request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
    for (const old of this.ctx.getWebSockets(`box:${device.id}`)) { try { old.close(1000, "Replaced"); } catch {} }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["box", `box:${device.id}`]);
    server.serializeAttachment({ kind: "box", device: device.id });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.tellBox(device.id, null, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async watch(camera_id, request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
    const cams = await this.get("cameras", {});
    const cam = cams[camera_id];
    if (!cam) return json({ error: "No such camera" }, 404);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["watch", `watch:${camera_id}`]);
    server.serializeAttachment({ kind: "watch", camera_id, device: cam.device_id });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Show the last picture straight away while the video starts.
    const snap = await this.ctx.storage.get(`snap:${camera_id}`);
    if (snap?.data) { try { server.send(snap.data); } catch {} }
    this.tellBox(cam.device_id);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "kyro" } });
  }

  /** Tells a camera computer which of its cameras someone is watching. */
  tellBox(device_id, leaving = null, only = null) {
    const keys = new Set();
    for (const w of this.ctx.getWebSockets("watch")) {
      if (w === leaving) continue;
      const a = w.deserializeAttachment();
      if (a?.device === device_id) keys.add(a.camera_id.slice(device_id.length + 1));
    }
    const msg = JSON.stringify({ watch: [...keys] });
    for (const b of only ? [only] : this.ctx.getWebSockets(`box:${device_id}`)) { try { b.send(msg); } catch {} }
  }

  webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment();
    if (a?.kind !== "box" || typeof msg === "string") return;
    // [key length][key][JPEG]
    const bytes = new Uint8Array(msg);
    const n = bytes[0];
    const camera_id = `${a.device}:${new TextDecoder().decode(bytes.subarray(1, 1 + n))}`;
    const jpeg = msg.slice(1 + n);
    for (const w of this.ctx.getWebSockets(`watch:${camera_id}`)) { try { w.send(jpeg); } catch {} }
  }

  webSocketClose(ws, code) {
    const a = ws.deserializeAttachment();
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch {}
    if (a?.kind === "watch") this.tellBox(a.device, ws);
  }

  webSocketError(ws) { this.webSocketClose(ws, 1011); }

  // ── What the website reads ────────────────────────────────────────────────

  async cameraList(includeHidden = false) {
    const cams = await this.get("cameras", {});
    const live = await this.get("live", {});
    const devices = await this.get("devices", {});
    return Object.values(cams)
      .filter((c) => (includeHidden || (!c.hidden && !c.pending)) && devices[c.device_id])
      .sort((a, b) => a.zone_order - b.zone_order)
      .map((c) => ({
        camera_id: c.camera_id, name: c.name, stream_url: c.kind === "usb" ? (/^usb-\d+$/.test(c.key) ? `USB camera ${Number(c.key.slice(4)) + 1}` : "USB camera")
          : c.kind === "web" ? `Camera mode · ${devices[c.device_id]?.name ?? "browser"}` : c.address || "Network camera",
        location: c.location, zone_name: c.zone_name, zone_capacity: c.zone_capacity, zone_order: c.zone_order,
        is_active: !c.hidden && this.isOnline(live[c.camera_id]), created_at: c.created_at, kind: c.kind, device_id: c.device_id,
        hidden: !!c.hidden, pending: !!c.pending, ignore_zones: c.ignore_zones ?? [], device_name: devices[c.device_id]?.name ?? "",
        // Plugged in right now (its computer mentioned it in the last 30 s)?
        present: Date.now() - (this.seenAt.get(c.camera_id) ?? 0) < 30_000, fps: live[c.camera_id]?.fps ?? 0, error_reason: live[c.camera_id]?.error_reason ?? null,
      }));
  }

  isOnline(l) { return !!l && Date.now() - l.updated_at < OFFLINE_AFTER_MS && l.status !== "offline"; }

  async venueTotal() {
    const cams = (await this.cameraList()).filter((c) => c.location !== "queue");
    const live = await this.get("live", {});
    const zones = cams.map((c) => {
      const l = live[c.camera_id] || {};
      const running = this.isOnline(l);
      const current = running ? l.current || 0 : 0;
      return {
        camera_id: c.camera_id, zone_name: c.zone_name || c.name, camera_name: c.name,
        current, peak: l.peak || 0, entries: l.entries || 0, exits: l.exits || 0,
        capacity: c.zone_capacity || 0, occupancy_pct: c.zone_capacity ? Math.round((current / c.zone_capacity) * 1000) / 10 : 0,
        is_running: running, status: running ? l.status || "online" : "offline", error_reason: running ? l.error_reason ?? null : null,
        // Counting in a browser has no in/out: it counts each picture, it doesn't follow people.
        in_out: c.kind !== "web",
      };
    });
    const sum = (k) => zones.reduce((n, z) => n + (z[k] || 0), 0);
    const cap = sum("capacity");
    // Face matching (if switched on): someone seen clearly by two cameras at once is counted once.
    const running = zones.filter((z) => z.is_running);
    let twice = (await this.privacy()).face_matching && (await this.get("service_live", null)) ? this.sameFaces(new Set(running.map((z) => z.camera_id))) : 0;
    // Someone can't be double-counted more often than the smaller overlapping camera sees people.
    const counts = running.map((z) => z.current || 0).sort((a, b) => b - a);
    twice = Math.min(twice, counts.slice(1).reduce((a, b) => a + b, 0));
    return {
      seen_on_two_cameras: twice,
      total_current: Math.max(0, sum("current") - twice), total_peak: sum("peak"), total_entries: sum("entries"), total_exits: sum("exits"),
      total_capacity: cap, venue_occupancy_pct: cap ? Math.round((Math.max(0, sum("current") - twice) / cap) * 1000) / 10 : 0,
      zones, cameras_running: zones.filter((z) => z.is_running).length, cameras_total: zones.length,
    };
  }

  history(url) {
    // ?date=YYYY-MM-DD&tz=Europe/London[&camera=id] → per-minute points
    const date = url.searchParams.get("date") || "";
    const tz = url.searchParams.get("tz") || "UTC";
    const camera = url.searchParams.get("camera");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };
    // Window: the calendar day in the church's timezone (±14h covers any offset).
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000;
    const end = Date.parse(`${date}T00:00:00Z`) + 38 * 3600_000;
    const rows = camera
      ? this.ctx.storage.sql.exec("SELECT * FROM history WHERE camera_id = ? AND ts >= ? AND ts < ? ORDER BY ts", camera, start, end).toArray()
      : this.ctx.storage.sql.exec("SELECT * FROM history WHERE ts >= ? AND ts < ? ORDER BY ts", start, end).toArray();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return rows
      .filter((r) => fmt.format(new Date(r.ts)) === date)
      .map((r) => ({
        camera_id: r.camera_id, timestamp: new Date(r.ts).toISOString(), attendance: r.current,
        total_entries: r.entries, total_exits: r.exits,
        occupancy_pct: r.capacity ? Math.round((r.current / r.capacity) * 1000) / 10 : 0,
      }));
  }

  /**
   * Phone alerts when a room fills up. Each phone decides its own levels
   * (Notifications page: "filling up" / "over capacity"); here we only send
   * when the room crosses upwards past a new 5% step (each phone is then only
   * told when it reaches that phone's own level — see notifyCount). A room has
   * to empty by 10% before the same step alerts again, so a count wobbling
   * around a level doesn't keep buzzing phones.
   */
  async capacityAlerts(cams, live) {
    const marks = await this.get("alert_marks", {});
    let dirty = false;
    for (const [id, l] of Object.entries(live)) {
      const c = cams[id];
      if (!c || c.hidden || !c.zone_capacity || !this.isOnline(l)) continue;
      const frac = (l.current || 0) / c.zone_capacity;
      const m = marks[id] || { frac: 0, at: 0 };
      if (frac < m.frac - 0.1) { marks[id] = { frac, at: m.at }; dirty = true; continue; }
      if (Math.floor(frac * 20) > Math.floor(m.frac * 20) && frac >= 0.5) {
        // A room hovering around a mark mustn't buzz everyone's phone over and over:
        // at most one "filling up" alert per room every 10 minutes. "Full" always goes out.
        const nowFull = frac >= 1 && m.frac < 1;
        if (!nowFull && Date.now() - m.at < ALERT_GAP_MS) continue;
        const prev = m.frac;
        marks[id] = { frac, at: Date.now() }; dirty = true;
        this.ctx.waitUntil(notifyCount(this.env, {
          kind: "camera", zone: c.zone_name || c.name, count: l.current, capacity: c.zone_capacity, prev_fraction: prev,
        }).catch(() => {}));
      }
    }
    if (dirty) await this.ctx.storage.put("alert_marks", marks);
  }

  /** Each room's highest camera count on a day (for the end-of-service send). */
  async dayPeaks(date, tz) {
    // The day's attendance = the most people in the building AT ONE MOMENT, and
    // each room's share at that moment. (Adding up each camera's own best moment
    // over-counts: two cameras on one hall peak at different times as people move.)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const fmt = this.dateFmt(tz);
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000, end = start + 52 * 3600_000;
    const rows = this.ctx.storage.sql.exec("SELECT camera_id, ts, current FROM history WHERE ts >= ? AND ts < ? ORDER BY ts", start, end).toArray();
    const cams = await this.get("cameras", {});
    const counts = x => cams[x] && !cams[x].hidden && cams[x].location !== "queue";
    const STALE = 3 * 60_000;      // a camera that stopped reporting no longer counts
    const last = new Map();
    let best = 0, bestAt = null;
    for (const r of rows) {
      if (fmt.format(new Date(r.ts)) !== date || !counts(r.camera_id)) continue;
      last.set(r.camera_id, { current: r.current || 0, ts: r.ts });
      let total = 0;
      for (const [id, v] of last) {
        if (r.ts - v.ts > STALE) { last.delete(id); continue; }
        total += v.current;
      }
      if (total > best) { best = total; bestAt = new Map([...last].map(([id, v]) => [id, v.current])); }
    }
    if (!bestAt) return [];
    // Two cameras can cover one room: report the room once, with their sum.
    const byZone = new Map();
    for (const [id, n] of bestAt) {
      if (!n) continue;
      const zone = cams[id].zone_name || cams[id].name;
      byZone.set(zone, (byZone.get(zone) ?? 0) + n);
    }
    return [...byZone].map(([zone, count]) => ({ zone, count }));
  }


  dateFmt(tz) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
  }

  /**
   * Analytics: one point per day (the most people in the building at once),
   * when people arrived (by hour), and a summary. ?days=30&tz=Europe/London[&camera=id]
   */
  async daily(url) {
    const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const tz = url.searchParams.get("tz") || "UTC";
    const camera = url.searchParams.get("camera");
    const since = Date.now() - days * 86400_000;
    const rows = camera
      ? this.ctx.storage.sql.exec("SELECT camera_id, ts, current, capacity FROM history WHERE camera_id = ? AND ts >= ? ORDER BY ts", camera, since).toArray()
      : this.ctx.storage.sql.exec("SELECT camera_id, ts, current, capacity FROM history WHERE ts >= ? ORDER BY ts", since).toArray();
    // History is saved once a minute; add each camera's count right now so today is up to date.
    const live = await this.get("live", {});
    const cams = await this.get("cameras", {});
    const lastTs = rows.length ? rows[rows.length - 1].ts : 0;
    const now = Object.entries(live)
      .filter(([id, l]) => (!camera || id === camera) && cams[id] && !cams[id].hidden && !cams[id].pending && this.isOnline(l) && l.updated_at > lastTs)
      .map(([id, l]) => ({ camera_id: id, ts: l.updated_at, current: l.current, capacity: cams[id].zone_capacity || 0 }))
      .sort((a, b) => a.ts - b.ts);
    rows.push(...now);
    const fmt = this.dateFmt(tz);
    let hourFmt;
    try { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }); }
    catch { hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }); }
    const STALE = 3 * 60_000;  // a camera that stopped reporting no longer counts towards the total
    const byDay = new Map();   // date → { peak, capacity, at }
    const arrivals = new Array(24).fill(0);
    let day = "", last = new Map(), prevTotal = 0;
    for (const r of rows) {
      const d = fmt.format(new Date(r.ts));
      if (d !== day) { day = d; last = new Map(); prevTotal = 0; }
      last.set(r.camera_id, { current: r.current || 0, capacity: r.capacity || 0, ts: r.ts });
      let total = 0, cap = 0;
      for (const [k, v] of last) {
        if (r.ts - v.ts > STALE) { last.delete(k); continue; }
        total += v.current; cap += v.capacity;
      }
      if (total > prevTotal) arrivals[Number(hourFmt.format(new Date(r.ts))) % 24] += total - prevTotal;
      prevTotal = total;
      const cur = byDay.get(d);
      if (!cur || total > cur.peak) byDay.set(d, { peak: total, capacity: cap, at: r.ts });
    }
    // A day where the cameras never saw anyone (e.g. a quick test) isn't a service.
    const history = [...byDay.entries()].filter(([, v]) => v.peak > 0).sort().map(([d, v]) => ({
      timestamp: new Date(v.at).toISOString(), date: d, attendance: v.peak,
      occupancy_pct: v.capacity ? Math.round((v.peak / v.capacity) * 1000) / 10 : 0,
    }));
    const n = history.length;
    const arrival = arrivals.map((count, hour) => ({ hour, count, avg_count: n ? Math.round((count / n) * 10) / 10 : 0 }));
    const summary = {
      camera_id: camera || "all", total_sessions: n,
      all_time_peak: n ? Math.max(...history.map((h) => h.attendance)) : 0,
      avg_attendance: n ? Math.round(history.reduce((a, h) => a + h.attendance, 0) / n) : 0,
      avg_occupancy_pct: n ? Math.round((history.reduce((a, h) => a + h.occupancy_pct, 0) / n) * 10) / 10 : 0,
      first_session: n ? history[0].timestamp : null, last_session: n ? history[n - 1].timestamp : null,
    };
    return { history, arrival, summary };
  }

  /** An admin typed in a network camera's address on the website; the box picks it up on its next report. */
  async addStream(request) {
    const body = await request.json().catch(() => ({}));
    const devices = await this.get("devices", {});
    const ids = Object.keys(devices);
    const device_id = body.device_id && devices[body.device_id] ? body.device_id : ids.length === 1 ? ids[0] : null;
    if (!device_id) return json({ error: ids.length ? "Choose which camera computer should run this camera" : "Pair a camera computer first" }, 400);
    const raw = clean(body.url, 500);
    let u;
    try { u = new URL(raw); } catch { return json({ error: "That doesn't look like a camera address (it usually starts with rtsp:// or http://)" }, 400); }
    if (!["rtsp:", "rtsps:", "http:", "https:"].includes(u.protocol)) return json({ error: "Camera addresses start with rtsp://, http:// or https://" }, 400);
    return json({ camera_id: await this.createNetworkCamera(device_id, raw, body) });
  }

  async createNetworkCamera(device_id, raw, body) {
    const u = new URL(raw);
    const cams = await this.get("cameras", {});
    const n = Object.keys(cams).length + 1;
    const key = `net-${b64url(crypto.getRandomValues(new Uint8Array(4)))}`;
    const camera_id = `${device_id}:${key}`;
    const name = clean(body.name, 60) || `Camera ${n}`;
    cams[camera_id] = {
      camera_id, device_id, key, kind: "network", name, zone_name: clean(body.zone_name, 60) || name,
      zone_capacity: num(body.zone_capacity, 0, 100000), zone_order: n, location: "indoor", hidden: false,
      address: `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`,  // shown on the website — never the login
      created_at: new Date().toISOString(),
    };
    const urls = await this.get("streams", {});
    urls[camera_id] = raw;
    await this.ctx.storage.put("cameras", cams);
    await this.ctx.storage.put("streams", urls);
    return camera_id;
  }

  // ── AI questions ───────────────────────────────────────────────────────────
  // The camera computer's AI asks when it isn't sure ("did they go on stage?",
  // "is this a seat?"). Questions wait here for an admin / operator; the answer
  // goes back to that camera computer on its next report.

  async addQuestions(list) {
    const qs = await this.get("questions", {});
    for (const q of list) qs[q.review_id] = q;
    // Keep the newest 60 (unanswered ones expire after QUESTION_TTL_MS anyway).
    const sorted = Object.values(qs).sort((a, b) => b.created_at - a.created_at);
    const keep = sorted.slice(0, 60);
    for (const q of sorted.slice(60)) await this.ctx.storage.delete(`qsnap:${q.review_id}`);
    await this.ctx.storage.put("questions", Object.fromEntries(keep.map((q) => [q.review_id, q])));
  }

  async listQuestions(role) {
    const now = Date.now() / 1000;
    return Object.values(await this.get("questions", {}))
      .filter((q) => !q.answer && now - q.created_at < QUESTION_TTL_MS / 1000 && (role === "admin" || q.target_role !== "admin"))
      .sort((a, b) => a.created_at - b.created_at)
      .map(({ answer, answered_by, answered_at, ...q }) => q);
  }

  async questionSnapshot(device, request, url) {
    const id = clean(url.searchParams.get("id"), 60);
    const buf = await request.arrayBuffer();
    if (!id || buf.byteLength > 120_000) return json({ error: "Bad picture" }, 400);   // storage values are ≤128 KB
    const qs = await this.get("questions", {});
    if (!qs[id] || !qs[id].camera_id.startsWith(`${device.id}:`)) return json({ error: "No such question" }, 404);
    await this.ctx.storage.put(`qsnap:${id}`, new Uint8Array(buf));
    return json({ ok: true });
  }

  async getQuestionSnapshot(id, role) {
    const q = (await this.get("questions", {}))[id];
    if (q && q.target_role === "admin" && role !== "admin") return json({ error: "Only an administrator sees this one" }, 403);
    const img = await this.ctx.storage.get(`qsnap:${id}`);
    if (!img) return new Response(null, { status: 204 });
    return new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
  }

  async answerQuestion(id, role, user, request) {
    if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can answer" }, 403);
    const body = await request.json().catch(() => ({}));
    const qs = await this.get("questions", {});
    const q = qs[id];
    if (!q) return json({ error: "That question has expired" }, 404);
    if (q.target_role === "admin" && role !== "admin") return json({ error: "Only an administrator can answer this one" }, 403);
    if (q.answer) return json({ ok: true, already: true });
    q.answer = clean(body.answer, 40) || "ignore";
    q.answered_by = clean(user, 60); q.answered_at = Date.now();
    await this.ctx.storage.put("questions", qs);
    const pending = await this.get("answers", []);
    pending.push({ device_id: q.camera_id.split(":")[0], key: q.camera_id.slice(q.camera_id.indexOf(":") + 1), review_id: id, answer: q.answer, kind: q.review_type });
    await this.ctx.storage.put("answers", pending.slice(-200));
    await this.ctx.storage.delete(`qsnap:${id}`);
    return json({ ok: true });
  }

  async takeAnswers(device_id) {
    const all = await this.get("answers", []);
    const mine = all.filter((a) => a.device_id === device_id);
    if (mine.length) await this.ctx.storage.put("answers", all.filter((a) => a.device_id !== device_id));
    return mine.map(({ device_id: _d, ...a }) => a);
  }

  // ── Rota holds, and stage / ignore areas ──────────────────────────────────

  async addRota(request) {
    const body = await request.json().catch(() => ({}));
    const rota = await this.get("rota", []);
    const now = Date.now();
    const added = [];
    let seatIdBudget = 2000;      // across the whole request, so "rota" always fits in one stored value
    // On the live site the seating areas are the camera rooms: an entry for a room
    // applies to that camera (its rows / seats, or the whole room if none are given).
    const rooms = Object.values(await this.get("cameras", {})).filter((c) => !c.hidden);
    const roomFor = (name) => rooms.find((c) => [c.zone_name, c.name].some((n) => n && n.trim().toLowerCase() === String(name).trim().toLowerCase()));
    for (const e of (Array.isArray(body.entries) ? body.entries : []).slice(0, 100)) {
      const start = Date.parse(e.start_time), end = Date.parse(e.end_time);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const entry = {
        entry_id: `rota-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`, label: clean(e.label, 60) || "Rota",
        start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        camera_id: e.camera_id ? clean(e.camera_id, 120) : (e.section && roomFor(e.section)?.camera_id) || null,
        section: e.section ? (roomFor(e.section) ? ((e.rows?.length || e.seat_ids?.length) ? null : "Main") : clean(e.section, 40)) : null,
        rows: (Array.isArray(e.rows) ? e.rows : []).slice(0, 50).map((r) => clean(r, 10)).filter(Boolean),
        seat_ids: (Array.isArray(e.seat_ids) ? e.seat_ids : []).slice(0, Math.max(0, seatIdBudget)).map((s) => clean(s, 40)).filter(Boolean),
        is_active: true,
      };
      seatIdBudget -= entry.seat_ids.length;
      rota.push(entry); added.push(entry);
    }
    // Entries that ended over a day ago are tidied away.
    const keep = rota.filter((e) => Date.parse(e.end_time) > now - 86400_000).slice(-100);
    await this.ctx.storage.put("rota", keep);
    return json({ added });
  }

  async removeRota(id) {
    const rota = await this.get("rota", []);
    await this.ctx.storage.put("rota", rota.filter((e) => e.entry_id !== id));
    return json({ removed: true });
  }

  async saveZones(camera_id, request) {
    const body = await request.json().catch(() => ([]));
    const list = (Array.isArray(body) ? body : []).slice(0, 30).map((z) => {
      if (!Array.isArray(z.bbox) || z.bbox.length !== 4) return null;
      return { zone_id: clean(z.zone_id, 40) || `z-${b64url(crypto.getRandomValues(new Uint8Array(4)))}`, label: clean(z.label, 60) || "Area",
        zone_type: z.zone_type === "ignore" ? "ignore" : "hold_seats", bbox: z.bbox.map((v) => Math.round(Number(v) || 0)),
        hold_seats_in_rows: (Array.isArray(z.hold_seats_in_rows) ? z.hold_seats_in_rows : []).slice(0, 50).map((r) => clean(r, 10)).filter(Boolean),
        is_active: z.is_active !== false };
    }).filter(Boolean);
    const all = await this.get("seat_zones", {});
    all[camera_id] = list;
    await this.ctx.storage.put("seat_zones", all);
    return json(list);
  }

  // ── Services: recorded automatically ─────────────────────────────────────
  // A service starts by itself when the cameras see people (SERVICE_START_PEOPLE
  // for SERVICE_START_MS) and ends by itself when the hall has been empty for
  // SERVICE_END_MS. Nobody has to press start or save. When it ends, any face
  // matching data is wiped, and an admin is asked whether to keep the service's
  // record or delete it.

  async trackService(now) {
    const v = await this.venueTotal();
    const people = v.total_current;
    const st = await this.get("service_state", { busy_since: null, quiet_since: null });
    let live = await this.get("service_live", null);
    let dirty = false;
    if (!live) {
      if (people >= SERVICE_START_PEOPLE) {
        if (!st.busy_since) { st.busy_since = now; dirty = true; }
        if (now - st.busy_since >= SERVICE_START_MS) {
          live = { id: `svc-${b64url(crypto.getRandomValues(new Uint8Array(6)))}`, name: serviceName(st.busy_since),
            started_at: new Date(st.busy_since).toISOString(), peak: 0, peak_at: null, rooms: {} };
          this.recentTotals = [];
          st.busy_since = null; st.quiet_since = null;
          await this.ctx.storage.put("service_live", live);
          dirty = true;
        }
      } else if (st.busy_since) { st.busy_since = null; dirty = true; }
    } else {
      // "Busiest" only counts a number that held for PEAK_HOLD_MS: a moment's flicker (or the
      // seconds before face matching merges people seen on two cameras) isn't recorded.
      this.recentTotals = [...(this.recentTotals ?? []).filter((x) => now - x.at <= PEAK_HOLD_MS), { at: now, people }];
      const held = this.recentTotals[0].at <= now - PEAK_HOLD_MS / 2 ? Math.min(...this.recentTotals.map((x) => x.people)) : 0;
      if (held > live.peak) { live.peak = held; live.peak_at = new Date(now).toISOString(); }
      // Two cameras can cover one room: add them up, then keep the busiest that room has been.
      const nowByRoom = {};
      for (const z of v.zones) nowByRoom[z.zone_name] = (nowByRoom[z.zone_name] ?? 0) + (z.current || 0);
      for (const [room, n] of Object.entries(nowByRoom)) live.rooms[room] = Math.max(live.rooms[room] ?? 0, n);
      if (people >= SERVICE_END_PEOPLE) { if (st.quiet_since) { st.quiet_since = null; dirty = true; } }
      else if (!st.quiet_since) { st.quiet_since = now; dirty = true; }
      await this.ctx.storage.put("service_live", live);
      // If every camera computer goes off, no reports come in: a timer still ends the service.
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 5 * 60_000);
      if (st.quiet_since && now - st.quiet_since >= SERVICE_END_MS) {
        await this.finishService(live, st.quiet_since);
        st.quiet_since = null; dirty = true;
      }
    }
    if (dirty) await this.ctx.storage.put("service_state", st);
  }

  async alarm() {
    if (await this.get("service_live", null)) await this.trackService(Date.now());
  }

  async finishService(live, endedMs) {
    const started = Date.parse(live.started_at);
    const rows = this.ctx.storage.sql.exec("SELECT ts, camera_id, current, entries, exits FROM history WHERE ts >= ? AND ts <= ? ORDER BY ts", started, endedMs).toArray();
    // Average of the venue total over the service's minutes.
    const byMin = new Map();
    for (const r of rows) { const m = Math.floor(r.ts / 60000); const o = byMin.get(m) ?? new Map(); o.set(r.camera_id, r.current || 0); byMin.set(m, o); }
    const totals = [...byMin.values()].map((o) => [...o.values()].reduce((a, b) => a + b, 0));
    const svc = { id: live.id, name: live.name, started_at: live.started_at, ended_at: new Date(endedMs).toISOString(),
      peak: live.peak, peak_at: live.peak_at, average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : live.peak,
      rooms: live.rooms, status: "ask", face_data_deleted_at: new Date().toISOString() };
    const list = await this.get("services", []);
    list.unshift(svc);
    await this.ctx.storage.put("services", list.slice(0, 200));   // ~76 KB, inside the 128 KB limit
    await this.ctx.storage.delete("service_live");
    // Face matching data belongs to the service: wiped as soon as it ends.
    this.faceCodes.clear();
  }

  async listServices() {
    const live = await this.get("service_live", null);
    const st = await this.get("service_state", {});
    return { live: live && { ...live, quiet_since: st.quiet_since ? new Date(st.quiet_since).toISOString() : null },
      services: await this.get("services", []), face_matching_now: !!live && (await this.privacy()).face_matching };
  }

  async keepService(id, user) {
    const list = await this.get("services", []);
    const s = list.find((x) => x.id === id);
    if (!s) return json({ error: "No such service" }, 404);
    s.status = "kept"; s.decided_by = clean(user, 60); s.decided_at = new Date().toISOString();
    await this.ctx.storage.put("services", list);
    return json(s);
  }

  async renameService(id, request) {
    const body = await request.json().catch(() => ({}));
    const list = await this.get("services", []);
    const live = await this.get("service_live", null);
    const name = clean(body.name, 80);
    if (!name) return json({ error: "Type a name" }, 400);
    if (live && live.id === id) { live.name = name; await this.ctx.storage.put("service_live", live); return json(live); }
    const s = list.find((x) => x.id === id);
    if (!s) return json({ error: "No such service" }, 404);
    s.name = name;
    await this.ctx.storage.put("services", list);
    return json(s);
  }

  /**
   * "Delete" removes the service from the list. The minute-by-minute counts
   * behind it are KEPT, so Analytics and the calendar still show that day —
   * deleting a service you didn't want recorded must never quietly wipe the
   * attendance figures. Pass ?counts=1 to remove those too (asked for
   * separately, with its own confirmation).
   */
  async deleteService(id, user, alsoCounts = false) {
    const list = await this.get("services", []);
    const s = list.find((x) => x.id === id);
    if (!s) return json({ error: "No such service" }, 404);
    if (alsoCounts) this.ctx.storage.sql.exec("DELETE FROM history WHERE ts >= ? AND ts <= ?", Date.parse(s.started_at), Date.parse(s.ended_at));
    await this.ctx.storage.put("services", list.filter((x) => x.id !== id));
    const log = await this.get("deleted_services", []);
    log.unshift({ name: s.name, started_at: s.started_at, ended_at: s.ended_at, peak: s.peak,
      counts_deleted: !!alsoCounts, deleted_by: clean(user, 60), deleted_at: new Date().toISOString() });
    await this.ctx.storage.put("deleted_services", log.slice(0, 200));
    return json({ deleted: true });
  }

  /** An admin ends the service now (e.g. people are still chatting afterwards). */
  async endServiceNow(id) {
    const live = await this.get("service_live", null);
    if (!live || live.id !== id) return json({ error: "That service isn't running" }, 404);
    await this.finishService(live, Date.now());
    await this.ctx.storage.put("service_state", { busy_since: null, quiet_since: null });
    return json({ ended: true });
  }

  // ── Face matching across cameras (off unless an admin switches it on) ─────

  async privacy() {
    return await this.get("privacy", { face_matching: false });
  }

  // ── How sure the AI must be before someone is counted ────────────────────
  // Lower = counts people it's less certain about (a soft or far-away picture,
  // e.g. through a wireless transmitter). Higher = only the obvious ones.

  async counting() {
    return await this.get("counting", { count_confidence: DEFAULT_COUNT_CONFIDENCE });
  }

  async setCounting(request) {
    const body = await request.json().catch(() => ({}));
    const v = Number(body.count_confidence);
    if (!Number.isFinite(v) || v < 0.1 || v > 0.6) return json({ error: "Pick one of the sensitivity settings" }, 400);
    const counting = { count_confidence: Math.round(v * 100) / 100 };
    await this.ctx.storage.put("counting", counting);
    return json(counting);
  }

  async setPrivacy(request, user) {
    const body = await request.json().catch(() => ({}));
    if (body.face_matching) {
      // Switching on needs both confirmations, recorded with who and when.
      if (body.dpia_confirmed !== true || body.notices_confirmed !== true)
        return json({ error: "Please confirm both: the data protection impact assessment, and the notices at the entrances" }, 400);
      await this.ctx.storage.put("privacy", { face_matching: true, dpia_confirmed: true, notices_confirmed: true,
        switched_on_by: clean(user, 60) || "an administrator", switched_on_at: new Date().toISOString() });
    } else {
      const prev = await this.privacy();
      await this.ctx.storage.put("privacy", { face_matching: false, switched_off_by: clean(user, 60) || "an administrator",
        switched_off_at: new Date().toISOString(), last_switched_on_by: prev.switched_on_by ?? null });
      this.faceCodes.clear();
    }
    return json(await this.privacy());
  }

  /** How many people are seen by two (or more) cameras right now, by face. */
  sameFaces(running) {
    const now = Date.now();
    const cams = [...this.faceCodes.entries()].filter(([id, f]) => running.has(id) && now - f.at < FACE_FRESH_MS && f.codes.length);
    for (const [id, f] of this.faceCodes) if (now - f.at > FACE_FRESH_MS) this.faceCodes.delete(id);
    if (cams.length < 2) return 0;
    // Union the faces that clearly match across different cameras (each face's best
    // match on the other camera, both ways, above the threshold).
    const nodes = cams.flatMap(([id, f]) => f.codes.map((c) => ({ cam: id, c })));
    const parent = nodes.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
    for (let a = 0; a < cams.length; a++) for (let b = a + 1; b < cams.length; b++) {
      const A = nodes.filter((n) => n.cam === cams[a][0]), B = nodes.filter((n) => n.cam === cams[b][0]);
      const best = (x, ys) => ys.reduce((m, y) => { const s = dot(x.c, y.c); return s > m.s ? { s, y } : m; }, { s: -1, y: null });
      for (const x of A) {
        const bx = best(x, B);
        if (bx.s < FACE_SAME || !bx.y) continue;
        if (best(bx.y, A).y !== x) continue;            // must be each other's best match
        parent[find(nodes.indexOf(x))] = find(nodes.indexOf(bx.y));
      }
    }
    const groups = new Map();
    nodes.forEach((_, i) => groups.set(find(i), (groups.get(find(i)) ?? 0) + 1));
    let extra = 0;
    for (const n of groups.values()) extra += n - 1;
    return extra;
  }

  // ── Seats the AI found by itself ─────────────────────────────────────────

  /** The camera computer found the seats itself: kept as the room's "Found by Kyro" layout. */
  async autoSeats(device, request) {
    const body = await request.json().catch(() => ({}));
    const key = clean(body.camera, 80);
    const camera_id = `${device.id}:${key}`;
    const cams = await this.get("cameras", {});
    if (!cams[camera_id]) return json({ error: "No such camera" }, 404);
    const seats = (Array.isArray(body.seats) ? body.seats : []).slice(0, MAX_SEATS).map(cleanSeatDef).filter((s) => s && s.seat_id);
    const list = await this.layoutsOf(camera_id);
    let auto = list.find((l) => l.source === "auto");
    const was = auto ? await this.seatsOf(camera_id, auto.id) : [];
    const keepReserved = new Map(was.filter((s) => s.reserved).map((s) => [s.seat_id, s.reserved_for]));
    for (const s of seats) if (keepReserved.has(s.seat_id)) { s.reserved = true; s.reserved_for = keepReserved.get(s.seat_id); }
    if (!auto) {
      auto = { id: Math.max(0, ...list.map((l) => l.id)) + 1, camera_id, name: "Found by Kyro", source: "auto",
        is_active: !list.some((l) => l.is_active), created_at: new Date().toISOString(), seat_count: 0, version: 0 };
      list.push(auto);
    }
    auto.seats = seats; auto.seat_count = seats.length; auto.version = (auto.version ?? 0) + 1;
    auto.stage = body.stage === "bottom" ? "bottom" : "top";
    await this.putLayouts(camera_id, list);
    if (auto.is_active) await this.syncCapacity(camera_id, seats.length);
    return json({ version: `${auto.id}.${auto.version}`, active: auto.is_active });
  }

  // ── Seat layouts and live seat states ─────────────────────────────────────
  // A layout is the seats drawn on a camera's picture (1280×720 coordinates, the
  // same as Kyro's seat engine). The camera computer works out each seat's state
  // (occupied / away / free, with the grace periods) and reports it every 2 s.

  async listLayouts(camera_id) {
    return (await this.layoutsOf(camera_id)).map(({ version, ...l }) => ({ ...l, seats: [], seat_count: l.seat_count ?? 0 }));
  }

  async createLayout(camera_id, request) {
    const cams = await this.get("cameras", {});
    if (!cams[camera_id]) return json({ error: "No such camera" }, 404);
    const body = await request.json().catch(() => ({}));
    const seen = new Set();
    const seats = (Array.isArray(body.seats) ? body.seats : []).slice(0, MAX_SEATS).map(cleanSeatDef).filter(Boolean)
      .map((s, i) => { let id = s.seat_id || `S${i + 1}`; while (seen.has(id)) id += "b"; seen.add(id); return { ...s, seat_id: id }; });
    if (!seats.length) return json({ error: "Add at least one seat" }, 400);
    if (seats.length > MAX_SEATS) return json({ error: `That's ${seats.length} seats. Kyro handles up to ${MAX_SEATS} per camera — use another camera for the rest of the room.` }, 400);
    const list = await this.layoutsOf(camera_id);
    const id = Math.max(0, ...list.map((l) => l.id)) + 1;
    // The first layout for a camera becomes its active one straight away.
    const layout = { id, camera_id, name: clean(body.name, 80) || `Layout ${id}`, is_active: !list.some((l) => l.is_active), created_at: new Date().toISOString(), seats, seat_count: seats.length, version: 1 };
    const keep = [...list, layout].slice(-5);
    for (const gone of [...list, layout].slice(0, -5)) await this.ctx.storage.delete(`lseats:${camera_id}:${gone.id}`);
    await this.putLayouts(camera_id, keep);
    if (layout.is_active) await this.syncCapacity(camera_id, seats.length);
    const { version, ...out } = layout;
    return json({ ...out, seat_count: seats.length });
  }

  async activateLayout(camera_id, id) {
    const list = await this.layoutsOf(camera_id);
    const l = list.find((x) => x.id === id);
    if (!l) return json({ error: "No such layout" }, 404);
    for (const x of list) x.is_active = x.id === id;
    l.version = (l.version ?? 0) + 1;
    await this.putLayouts(camera_id, list);
    await this.syncCapacity(camera_id, l.seat_count ?? 0);
    return json({ activated: true, seat_count: l.seat_count ?? 0 });
  }

  async deleteLayout(camera_id, id) {
    await this.putLayouts(camera_id, (await this.layoutsOf(camera_id)).filter((l) => l.id !== id));
    await this.ctx.storage.delete(`lseats:${camera_id}:${id}`);
    return json({ deleted: true });
  }

  /** Reserve / unreserve seats (e.g. "Pastor John"): kept in the active layout so every phone and the camera computer agree. */
  async reserveSeats(camera_id, request) {
    const body = await request.json().catch(() => ({}));
    const list = await this.layoutsOf(camera_id);
    const l = list.find((x) => x.is_active);
    if (!l) return json({ error: "This room has no seat layout yet" }, 404);
    l.seats = await this.seatsOf(camera_id, l.id);
    const ids = new Set((Array.isArray(body.seat_ids) ? body.seat_ids : []).map((s) => clean(s, 40)));
    for (const s of l.seats) {
      if (!ids.has(s.seat_id)) continue;
      s.reserved = !!body.reserved;
      s.reserved_for = body.reserved ? clean(body.reserved_for, 60) || null : null;
    }
    l.version = (l.version ?? 0) + 1;
    await this.putLayouts(camera_id, list);
    return json({ ok: true });
  }

  /** The room's seat count follows its seat layout, so "seats left" and alerts match the seat map. */
  async syncCapacity(camera_id, n) {
    const cams = await this.get("cameras", {});
    if (cams[camera_id]) { cams[camera_id].zone_capacity = n; await this.ctx.storage.put("cameras", cams); }
  }

  async boxSeats(device, url) {
    const key = clean(url.searchParams.get("camera"), 80);
    const cid = `${device.id}:${key}`;
    const l = (await this.layoutsOf(cid)).find((x) => x.is_active);
    return json(l ? { version: `${l.id}.${l.version ?? 0}`, seats: await this.seatsOf(cid, l.id) } : { version: null, seats: [] });
  }

  /** The seat map: the active layout with each seat's live state from the camera computer. */
  async seatStates(camera_id) {
    const meta = (await this.layoutsOf(camera_id)).find((x) => x.is_active);
    const l = await this.layoutWithSeats(camera_id, meta);
    if (!l) return { layout: null, seats: [], updated_at: null };
    const live = await this.get(`seat_live:${camera_id}`, null);
    const fresh = live && Date.now() - live.at < OFFLINE_AFTER_MS;
    const by = new Map(fresh ? live.seats.map((s) => [s[0], s]) : []);
    return {
      layout: { id: l.id, name: l.name }, updated_at: fresh ? new Date(live.at).toISOString() : null,
      seats: l.seats.map((s) => {
        const st = by.get(s.seat_id);
        return { ...s, state: s.reserved ? "reserved" : st ? st[1] : "unknown", confidence: st ? st[3] ?? 0 : 0,
          occupying_track_id: null, vacancy_seconds: st ? st[2] : 0, in_exclusion_zone: false };
      }),
    };
  }

  // ── "Find cameras" ────────────────────────────────────────────────────────
  // Only when an admin presses the button: each switched-on camera computer is
  // asked (on its next report, ~2 s) to look for cameras on its own network.
  // Adding one sends the login the admin typed to that computer, which asks the
  // camera for its video address; the login is deleted as soon as it answers.

  async jobsFor(device_id) {
    const jobs = await this.get("jobs", {});
    const now = Date.now();
    let changed = false;
    for (const [id, j] of Object.entries(jobs)) {
      if (now - j.created > JOB_TTL_MS) { delete jobs[id]; changed = true; }
    }
    if (changed) await this.ctx.storage.put("jobs", jobs);
    return Object.values(jobs).filter((j) => j.device_id === device_id && !j.done)
      .map(({ id, type, xaddr, ip, username, password }) => (type === "add" ? { id, type, xaddr, ip, username, password } : { id, type }));
  }

  async findCameras() {
    const devices = await this.get("devices", {});
    const on = Object.values(devices).filter((d) => d.id.startsWith("box-") && d.last_seen && Date.now() - Date.parse(d.last_seen) < OFFLINE_AFTER_MS);
    if (!on.length) return json({ error: "No camera computer is switched on. Kyro looks for cameras through the camera computer at church — switch it on and try again." }, 400);
    const jobs = await this.get("jobs", {});
    for (const [id, j] of Object.entries(jobs)) if (j.type === "find") delete jobs[id];
    for (const d of on) {
      const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
      jobs[id] = { id, type: "find", device_id: d.id, created: Date.now(), done: false };
    }
    await this.ctx.storage.put("jobs", jobs);
    await this.ctx.storage.put("found", {});
    return json({ asked: on.length });
  }

  async foundCameras() {
    const jobs = await this.get("jobs", {});
    const found = await this.get("found", {});
    const devices = await this.get("devices", {});
    const cams = await this.get("cameras", {});
    const known = new Set(Object.values(cams).filter((c) => c.kind === "network" && c.address)
      .map((c) => { try { return `${c.device_id}|${new URL(c.address).hostname}`; } catch { return ""; } }));
    const finds = Object.values(jobs).filter((j) => j.type === "find");
    const results = [];
    for (const [device_id, list] of Object.entries(found)) {
      for (const f of list) {
        results.push({ id: f.id, device_id, device_name: devices[device_id]?.name ?? "", ip: f.ip, name: f.name, model: f.model,
          added: known.has(`${device_id}|${f.ip}`) });
      }
    }
    return { searching: finds.some((j) => !j.done), searched: finds.length > 0 || Object.keys(found).length > 0, results };
  }

  async addFound(request) {
    const body = await request.json().catch(() => ({}));
    const found = await this.get("found", {});
    let hit = null, device_id = null;
    for (const [d, list] of Object.entries(found)) {
      const f = list.find((x) => x.id === body.id);
      if (f) { hit = f; device_id = d; }
    }
    if (!hit) return json({ error: "That camera isn't in the list any more — press Find cameras again" }, 404);
    const username = String(body.username ?? "").slice(0, 100), password = String(body.password ?? "").slice(0, 200);
    if (!username) return json({ error: "Type the camera's username" }, 400);
    const jobs = await this.get("jobs", {});
    const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
    jobs[id] = { id, type: "add", device_id, xaddr: hit.xaddr, ip: hit.ip, username, password, created: Date.now(), done: false,
      name: clean(body.name, 60) || hit.name || "Camera", zone_capacity: num(body.zone_capacity, 0, 100000) };
    await this.ctx.storage.put("jobs", jobs);
    return json({ job_id: id });
  }

  async addStatus(id) {
    const jobs = await this.get("jobs", {});
    const j = jobs[id];
    if (!j || j.type !== "add") return { done: true, ok: false, error: "That took too long — check the camera is switched on and try again" };
    return j.done ? { done: true, ok: j.ok, error: j.error ?? null, camera_id: j.camera_id ?? null } : { done: false };
  }

  async jobResult(device, request) {
    const body = await request.json().catch(() => ({}));
    const jobs = await this.get("jobs", {});
    const j = jobs[clean(body.id, 40)];
    if (!j || j.device_id !== device.id) return json({ ok: true });
    if (j.type === "find") {
      const found = await this.get("found", {});
      found[device.id] = (Array.isArray(body.found) ? body.found.slice(0, 50) : []).map((f) => {
        let xaddr = "";
        try { const u = new URL(String(f.xaddr ?? "")); if (u.protocol === "http:" || u.protocol === "https:") xaddr = u.href.slice(0, 300); } catch { /* skip */ }
        return { id: b64url(crypto.getRandomValues(new Uint8Array(6))), ip: clean(f.ip, 45), name: clean(f.name, 60), model: clean(f.model, 60), xaddr };
      }).filter((f) => f.ip && f.xaddr);
      await this.ctx.storage.put("found", found);
      j.done = true;
    } else if (j.type === "add") {
      // The login is never kept once the camera computer has answered.
      delete j.username; delete j.password; delete j.xaddr;
      j.done = true;
      let url = null;
      try { url = new URL(String(body.url ?? "")); } catch { /* not ok */ }
      if (body.ok && url && ["rtsp:", "rtsps:"].includes(url.protocol)) {
        j.ok = true;
        j.camera_id = await this.createNetworkCamera(device.id, String(body.url).slice(0, 500), { name: j.name, zone_name: j.name, zone_capacity: j.zone_capacity });
      } else {
        j.ok = false; j.error = clean(body.error, 200) || "Couldn't add that camera";
      }
    }
    jobs[j.id] = j;
    await this.ctx.storage.put("jobs", jobs);
    return json({ ok: true });
  }

  /** Network cameras are deleted; a USB camera is just switched off (it would reappear while plugged in). */
  async removeCamera(camera_id) {
    const cams = await this.get("cameras", {});
    const c = cams[camera_id];
    if (!c) return json({ error: "No such camera" }, 404);
    if (c.kind === "network") {
      delete cams[camera_id];
      const urls = await this.get("streams", {});
      delete urls[camera_id];
      await this.ctx.storage.put("streams", urls);
      await this.ctx.storage.delete(`layouts:${camera_id}`);
      await this.ctx.storage.delete(`seat_live:${camera_id}`);
      await this.ctx.storage.delete(`snap:${camera_id}`);
    } else {
      c.hidden = true;
    }
    const live = await this.get("live", {});
    delete live[camera_id];
    await this.ctx.storage.put("live", live);
    await this.ctx.storage.put("cameras", cams);
    return json({ removed: true });
  }

  async updateCamera(camera_id, request) {
    const body = await request.json().catch(() => ({}));
    const cams = await this.get("cameras", {});
    const c = cams[camera_id];
    if (!c) return json({ error: "No such camera" }, 404);
    if (body.name !== undefined) c.name = clean(body.name, 60) || c.name;
    if (body.zone_name !== undefined) c.zone_name = clean(body.zone_name, 60) || c.zone_name;
    if (body.zone_capacity !== undefined) c.zone_capacity = num(body.zone_capacity, 0, 100000);
    if (body.zone_order !== undefined) c.zone_order = num(body.zone_order, 0, 1000);
    if (body.location !== undefined) c.location = body.location === "queue" ? "queue" : "indoor";
    if (body.hidden !== undefined) { c.hidden = !!body.hidden; c.pending = false; }   // "Yes, add it" / "No"
    if (body.ignore_zones !== undefined) c.ignore_zones = cleanZones(body.ignore_zones);
    await this.ctx.storage.put("cameras", cams);
    return json({ ok: true });
  }
}
