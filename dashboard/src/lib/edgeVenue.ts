/**
 * edgeVenue.ts — Live mode on the Cloudflare build: real cameras, counts,
 * history and pictures reported by the camera computer at church (the Kyro
 * Camera Box) via worker/venue.js. Only used when isEdgeLive() is true.
 */
import { useEffect, useRef, useState } from "react";
import { edgeFetch, edgeToken } from "@/lib/edgeAuth";
import type { Camera, VenueTotal } from "@/types";

export interface EdgeCamera extends Camera {
  kind: "usb" | "network";
  device_id: string;
  hidden: boolean;
  fps: number;
  error_reason: string | null;
}

export interface EdgeDevice {
  id: string;
  name: string;
  platform: string;
  version: string;
  paired_at: string;
  last_seen: string | null;
  online: boolean;
  cameras: number;
}

export interface EdgeHistoryPoint {
  camera_id: string;
  timestamp: string;
  attendance: number;
  total_entries: number;
  total_exits: number;
  occupancy_pct: number;
}

const enc = encodeURIComponent;

export const edgeVenueApi = {
  cameras: (all = false) => edgeFetch<EdgeCamera[]>(`/api/live/cameras${all ? "?all=1" : ""}`),
  venue: () => edgeFetch<VenueTotal>("/api/live/venue"),
  history: (date: string, tz: string, camera?: string) =>
    edgeFetch<EdgeHistoryPoint[]>(`/api/live/history?date=${enc(date)}&tz=${enc(tz)}${camera ? `&camera=${enc(camera)}` : ""}`),
  pairingCode: () => edgeFetch<{ code: string; expires_at: string }>("/api/live/pairing-code", { method: "POST" }),
  devices: () => edgeFetch<EdgeDevice[]>("/api/live/devices"),
  removeDevice: (id: string) => edgeFetch<{ removed: boolean }>(`/api/live/devices/${enc(id)}`, { method: "DELETE" }),
  updateCamera: (id: string, body: {
    name?: string; zone_name?: string; zone_capacity?: number; zone_order?: number;
    location?: "indoor" | "queue"; hidden?: boolean;
  }) => edgeFetch<{ ok: boolean }>(`/api/live/cameras/${enc(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeCamera: (id: string) => edgeFetch<{ removed: boolean }>(`/api/live/cameras/${enc(id)}`, { method: "DELETE" }),
  addStream: (body: { url: string; name?: string; zone_name?: string; zone_capacity?: number; device_id?: string }) =>
    edgeFetch<{ camera_id: string }>("/api/live/streams", { method: "POST", body: JSON.stringify(body) }),
};

/** Today's date (YYYY-MM-DD) in the browser's timezone, plus that timezone. */
export function todayLocal(): { date: string; tz: string } {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { date, tz };
}

/**
 * Polls /api/live/venue every `everyMs` while `enabled`. Failures are
 * non-fatal: the last good value is kept and `error` carries a short message.
 */
export function useEdgeVenue(enabled: boolean, everyMs = 5000) {
  const [venue, setVenue] = useState<VenueTotal | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const v = await edgeVenueApi.venue();
        if (alive) { setVenue(v); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't reach the camera computer");
      }
    };
    load();
    const id = setInterval(load, everyMs);
    return () => { alive = false; clearInterval(id); };
  }, [enabled, everyMs]);
  return { venue, error };
}

/**
 * The latest picture from a camera as an object URL. The snapshot endpoint
 * needs the Authorization header, so an <img src> can't load it directly.
 * Returns null until a picture exists (404 = none yet).
 */
export function useEdgeSnapshot(cameraId: string | null, enabled: boolean, everyMs = 20000) {
  const [url, setUrl] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !cameraId) return;
    let alive = true;
    const load = async () => {
      try {
        const token = edgeToken();
        const res = await fetch(`/api/live/snapshot/${enc(cameraId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return;
        const blob = await res.blob();
        if (!alive) return;
        const next = URL.createObjectURL(blob);
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
        setTakenAt(res.headers.get("X-Taken-At"));
      } catch { /* non-fatal — keep the last picture */ }
    };
    load();
    const id = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
      if (current.current) { URL.revokeObjectURL(current.current); current.current = null; }
      setUrl(null);
    };
  }, [cameraId, enabled, everyMs]);
  return { url, takenAt };
}

export interface EdgeVenueSeries {
  timestamps: number[];
  people: number[];
  occupancy: number[];
  entries: number[];
  exits: number[];
}

/**
 * Turns per-camera, per-minute history rows into venue-wide per-minute
 * totals. Each camera's last known value is carried forward, so a camera
 * that skipped a minute doesn't make the total dip. `capacities` maps
 * camera_id → seat capacity (for occupancy %); queue cameras should be
 * filtered out of `rows` by the caller if they shouldn't count.
 */
export function aggregateEdgeHistory(rows: EdgeHistoryPoint[], capacities: Record<string, number>): EdgeVenueSeries {
  const out: EdgeVenueSeries = { timestamps: [], people: [], occupancy: [], entries: [], exits: [] };
  const sorted = [...rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const last: Record<string, EdgeHistoryPoint> = {};
  const totalCap = Object.values(capacities).reduce((n, c) => n + (c || 0), 0);
  const flush = (minute: number) => {
    const vals = Object.values(last);
    const people = vals.reduce((n, r) => n + (r.attendance || 0), 0);
    out.timestamps.push(minute * 60_000);
    out.people.push(people);
    out.entries.push(vals.reduce((n, r) => n + (r.total_entries || 0), 0));
    out.exits.push(vals.reduce((n, r) => n + (r.total_exits || 0), 0));
    out.occupancy.push(totalCap > 0 ? Math.round((people / totalCap) * 100) : 0);
  };
  let minute: number | null = null;
  for (const r of sorted) {
    const m = Math.floor(Date.parse(r.timestamp) / 60_000);
    if (minute !== null && m !== minute) flush(minute);
    minute = m;
    last[r.camera_id] = r;
  }
  if (minute !== null) flush(minute);
  return out;
}

/** History rows grouped per camera as entry/exit counter points (for arrival times). */
export function edgeCounterSeries(rows: EdgeHistoryPoint[]): { t: number; entries: number; exits: number }[][] {
  const by: Record<string, { t: number; entries: number; exits: number }[]> = {};
  for (const r of rows) {
    (by[r.camera_id] ??= []).push({ t: Date.parse(r.timestamp), entries: r.total_entries || 0, exits: r.total_exits || 0 });
  }
  return Object.values(by).map((pts) => pts.sort((a, b) => a.t - b.t));
}
