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
const MAX_SNAPSHOT_BYTES = 400_000;

export class VenueHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lastSample = new Map();
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS history (ts INTEGER NOT NULL, camera_id TEXT NOT NULL, current INTEGER, entries INTEGER, exits INTEGER, capacity INTEGER)",
      );
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS history_cam_ts ON history (camera_id, ts)");
    });
  }

  async get(key, fallback) { return (await this.ctx.storage.get(key)) ?? fallback; }

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

      // ── Website (signed-in user) ──
      if (!role) return json({ error: "Please sign in again" }, 401);
      if (p === "/api/live/cameras" && request.method === "GET") return json(await this.cameraList(url.searchParams.get("all") === "1"));
      if (p === "/api/live/venue" && request.method === "GET") return json(await this.venueTotal());
      if (p === "/api/live/history" && request.method === "GET") return json(this.history(url));
      if (p === "/api/live/daily" && request.method === "GET") return json(this.daily(url));
      if (p.startsWith("/api/live/snapshot/") && request.method === "GET") return this.getSnapshot(decodeURIComponent(p.split("/").pop()));

      if (p === "/api/live/browser-device" && request.method === "POST") {
        // Camera mode: a signed-in admin/operator's browser becomes a camera computer — no code needed.
        if (role !== "admin" && role !== "operator") return json({ error: "Only administrators and operators can use Camera mode" }, 403);
        return this.registerBrowser(request);
      }
      if (role !== "admin") return json({ error: "Only administrators can change camera settings" }, 403);
      if (p === "/api/live/pairing-code" && request.method === "POST") return this.newPairingCode();
      if (p === "/api/live/devices" && request.method === "GET") return json(await this.deviceList());
      if (p.startsWith("/api/live/devices/") && request.method === "DELETE") return this.removeDevice(decodeURIComponent(p.split("/").pop()));
      if (p.startsWith("/api/live/cameras/") && request.method === "PATCH") return this.updateCamera(decodeURIComponent(p.split("/").pop()), request);
      if (p.startsWith("/api/live/cameras/") && request.method === "DELETE") return this.removeCamera(decodeURIComponent(p.split("/").pop()));
      if (p === "/api/live/streams" && request.method === "POST") return this.addStream(request);
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
        cams[camera_id] = {
          camera_id, device_id: device.id, key, kind: clean(c.kind, 10) || "usb",
          name: clean(c.label, 60) || `Camera ${n}`, zone_name: clean(c.label, 60) || `Camera ${n}`,
          zone_capacity: 0, zone_order: n, location: "indoor", hidden: false, created_at: new Date(now).toISOString(),
        };
        changed = true;
      }
      if (cams[camera_id].hidden) continue;
      live[camera_id] = {
        current: num(c.current, 0, 100000), peak: num(c.peak, 0, 100000),
        entries: num(c.entries, 0, 10000000), exits: num(c.exits, 0, 10000000),
        status: ["online", "error", "offline"].includes(c.status) ? c.status : "online",
        error_reason: c.error ? clean(c.error, 120) : null, fps: Number(c.fps) || 0,
        width: num(c.width, 0, 10000), height: num(c.height, 0, 10000), updated_at: now,
      };
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

    // Tell the box which cameras the website has switched off.
    const off = Object.values(cams).filter((c) => c.device_id === device.id && c.hidden).map((c) => c.key);
    const urls = await this.get("streams", {});
    const streams = Object.values(cams)
      .filter((c) => c.device_id === device.id && c.kind === "network" && !c.hidden && urls[c.camera_id])
      .map((c) => ({ key: c.key, url: urls[c.camera_id] }));
    return json({ ok: true, disabled: off, streams, report_every_s: 5, snapshot_every_s: 20 });
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

  // ── What the website reads ────────────────────────────────────────────────

  async cameraList(includeHidden = false) {
    const cams = await this.get("cameras", {});
    const live = await this.get("live", {});
    const devices = await this.get("devices", {});
    return Object.values(cams)
      .filter((c) => (includeHidden || !c.hidden) && devices[c.device_id])
      .sort((a, b) => a.zone_order - b.zone_order)
      .map((c) => ({
        camera_id: c.camera_id, name: c.name, stream_url: c.kind === "usb" ? `USB camera ${Number(c.key.replace(/^usb-/, "")) + 1}`
          : c.kind === "web" ? `Camera mode · ${devices[c.device_id]?.name ?? "browser"}` : c.address || "Network camera",
        location: c.location, zone_name: c.zone_name, zone_capacity: c.zone_capacity, zone_order: c.zone_order,
        is_active: !c.hidden && this.isOnline(live[c.camera_id]), created_at: c.created_at, kind: c.kind, device_id: c.device_id,
        hidden: !!c.hidden, fps: live[c.camera_id]?.fps ?? 0, error_reason: live[c.camera_id]?.error_reason ?? null,
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
      };
    });
    const sum = (k) => zones.reduce((n, z) => n + (z[k] || 0), 0);
    const cap = sum("capacity");
    return {
      total_current: sum("current"), total_peak: sum("peak"), total_entries: sum("entries"), total_exits: sum("exits"),
      total_capacity: cap, venue_occupancy_pct: cap ? Math.round((sum("current") / cap) * 1000) / 10 : 0,
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const fmt = this.dateFmt(tz);
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * 3600_000, end = start + 52 * 3600_000;
    const rows = this.ctx.storage.sql.exec("SELECT camera_id, ts, current FROM history WHERE ts >= ? AND ts < ?", start, end).toArray();
    const peak = {};
    for (const r of rows) if (fmt.format(new Date(r.ts)) === date) peak[r.camera_id] = Math.max(peak[r.camera_id] || 0, r.current || 0);
    const cams = await this.get("cameras", {});
    return Object.entries(peak)
      .filter(([id]) => cams[id] && !cams[id].hidden && cams[id].location !== "queue")
      .map(([id, count]) => ({ camera_id: id, zone: cams[id].zone_name || cams[id].name, count }));
  }

  dateFmt(tz) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
  }

  /**
   * Analytics: one point per day (the most people in the building at once),
   * when people arrived (by hour), and a summary. ?days=30&tz=Europe/London[&camera=id]
   */
  daily(url) {
    const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const tz = url.searchParams.get("tz") || "UTC";
    const camera = url.searchParams.get("camera");
    const since = Date.now() - days * 86400_000;
    const rows = camera
      ? this.ctx.storage.sql.exec("SELECT camera_id, ts, current, capacity FROM history WHERE camera_id = ? AND ts >= ? ORDER BY ts", camera, since).toArray()
      : this.ctx.storage.sql.exec("SELECT camera_id, ts, current, capacity FROM history WHERE ts >= ? ORDER BY ts", since).toArray();
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
    return json({ camera_id });
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
    if (body.hidden !== undefined) c.hidden = !!body.hidden;
    await this.ctx.storage.put("cameras", cams);
    return json({ ok: true });
  }
}
