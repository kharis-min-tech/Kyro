"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, Pencil, Play, Radio, RotateCcw, ScanFace, Square, Trash2, X } from "lucide-react";
import { edgeFetch, isEdgeLive } from "@/lib/edgeAuth";
import { edgeVenueApi, useEdgeVenue } from "@/lib/edgeVenue";
import { useAuth } from "@/hooks/useAuth";

export interface Service {
  id: string; name: string; started_at: string; ended_at?: string; peak: number; peak_at?: string;
  average?: number; rooms: Record<string, number>; status?: "ask" | "kept"; decided_by?: string;
  face_data_deleted_at?: string; quiet_since?: string | null;
}
interface Services { live: Service | null; services: Service[]; face_matching_now: boolean }

export const servicesApi = {
  list: () => edgeFetch<Services>("/api/live/services"),
  keep: (id: string) => edgeFetch<Service>(`/api/live/services/${encodeURIComponent(id)}/keep`, { method: "POST" }),
  remove: (id: string, alsoCounts = false) =>
    edgeFetch<{ deleted: boolean }>(`/api/live/services/${encodeURIComponent(id)}${alsoCounts ? "?counts=1" : ""}`, { method: "DELETE" }),
  end: (id: string) => edgeFetch<{ ended: boolean }>(`/api/live/services/${encodeURIComponent(id)}/end`, { method: "POST" }),
  /** Record a service from now, and start this session's arrivals and departures from zero. */
  start: () => edgeFetch<{ already: boolean }>("/api/live/service/start", { method: "POST" }),
  /** Only the figures: start the arrivals and departures again from zero. Deletes nothing. */
  freshCounts: () => edgeVenueApi.freshStart(),
  rename: (id: string, name: string) => edgeFetch<Service>(`/api/live/services/${encodeURIComponent(id)}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
};

const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "");
const minutes = (a: string, b?: string) => {
  const m = Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** Live on the website on its own: services are recorded automatically (no start / save). */
export function AutoServices() {
  const { role } = useAuth();
  const admin = role === "admin";
  const [data, setData] = useState<Services | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [alsoCounts, setAlsoCounts] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { venue } = useEdgeVenue(true, 5000);

  const load = useCallback(async () => {
    try { setData(await servicesApi.list()); setErr(null); } catch (e: any) { setErr(e?.message ?? "Couldn't load services"); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  async function act(id: string, f: () => Promise<unknown>) {
    setBusy(id); setErr(null);
    try { await f(); await load(); } catch (e: any) { setErr(e?.message ?? "Couldn't do that"); }
    setBusy(null); setConfirmDelete(null); setEditing(null);
  }

  async function csv(s: Service) {
    // Minute-by-minute venue totals for the service, from the cameras' history.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const days = new Set([s.started_at, s.ended_at ?? new Date().toISOString()].map((d) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d))));
    const rows = (await Promise.all([...days].map((d) => edgeVenueApi.history(d, tz)))).flat()
      .filter((r) => Date.parse(r.timestamp) >= Date.parse(s.started_at) && Date.parse(r.timestamp) <= Date.parse(s.ended_at ?? new Date().toISOString()));
    const lines = ["time,camera,people", ...rows.map((r) => `${r.timestamp},${r.camera_id},${r.attendance}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${s.name.replace(/[^\w ·-]+/g, "")}.csv`;
    a.click();
  }

  const live = data?.live;
  const ended = data?.services ?? [];
  const nameBox = (s: Service) => editing?.id === s.id ? (
    <span className="flex items-center gap-1.5 min-w-0">
      <input value={editing.name} onChange={(e) => setEditing({ id: s.id, name: e.target.value })} autoFocus
        className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-2 py-1 min-w-0 flex-1" />
      <button onClick={() => act(s.id, () => servicesApi.rename(s.id, editing.name))} className="text-green-400"><Check size={15} /></button>
      <button onClick={() => setEditing(null)} className="text-gray-500"><X size={15} /></button>
    </span>
  ) : (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="text-sm font-semibold text-white truncate">{s.name}</span>
      {admin && <button onClick={() => setEditing({ id: s.id, name: s.name })} className="text-gray-500 hover:text-gray-300 shrink-0" aria-label="Rename"><Pencil size={12} /></button>}
    </span>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-white">Services</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Kyro records each service by itself — it starts when people arrive and ends when the hall has been empty for 15 minutes.
          Nothing to start or save. Afterwards you choose whether to keep the record.
        </p>
      </div>
      {err && <p className="text-sm text-amber-400">{err}</p>}

      {/* Now */}
      <div className="rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
        {live ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Recording</span>
              <span className="text-xs text-gray-500">since {time(live.started_at)} · {minutes(live.started_at)}</span>
            </div>
            {nameBox(live)}
            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-xs text-gray-500">Here now</p><p className="text-2xl font-bold text-white tabular-nums">{venue?.total_current ?? "–"}</p></div>
              <div><p className="text-xs text-gray-500">Busiest</p><p className="text-2xl font-bold text-white tabular-nums">{live.peak}</p><p className="text-xs text-gray-500">at {time(live.peak_at)}</p></div>
              <div><p className="text-xs text-gray-500">Seats</p><p className="text-2xl font-bold text-white tabular-nums">{venue?.total_capacity || "–"}</p></div>
            </div>
            {live.quiet_since && <p className="text-xs text-gray-400">The hall has been nearly empty since {time(live.quiet_since)} — the service ends by itself 15 minutes after that.</p>}
            {data?.face_matching_now && (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><ScanFace size={13} className="text-green-400" />
                Face matching is on for this service. Its face codes are wiped when the service ends.</p>
            )}
            {admin && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => act(live.id, () => servicesApi.end(live.id))} disabled={busy === live.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-50">
                  <Square size={11} /> End the service now
                </button>
                <button onClick={() => act("fresh", servicesApi.freshCounts)} disabled={busy === "fresh"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
                  title="The came in / went out figures start again from zero. Every reading is kept.">
                  <RotateCcw size={11} /> {busy === "fresh" ? "Starting fresh…" : "Start the in / out counts fresh"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Radio size={18} className="text-gray-600 shrink-0" />
              <p className="text-sm text-gray-400">No service right now. Recording starts by itself when the cameras see people arrive.</p>
            </div>
            {admin && (
              <>
                <button onClick={() => act("start", servicesApi.start)} disabled={busy === "start"}
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
                  <Play size={11} /> {busy === "start" ? "Starting…" : "Start a session now"}
                </button>
                {/* Said plainly, because it changes the figures on Analytics:
                    the session's arrivals and departures begin at zero, and
                    the morning's are still there to look at. */}
                <p className="text-xs text-gray-500">
                  Starts recording straight away, without waiting for the room to fill, and starts this session&apos;s
                  <strong className="text-gray-400"> came in / went out</strong> figures from zero. Nothing already counted
                  is deleted — the whole day is still on Analytics.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Ended */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Past services ({ended.length})</p>
        {ended.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
        {ended.map((s) => (
          <div key={s.id} className="rounded-xl p-4 flex flex-col gap-2" style={{ background: "var(--bg-card)", border: `1px solid ${s.status === "ask" ? "rgba(248,181,55,0.5)" : "var(--border-subtle)"}` }}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {nameBox(s)}
                <p className="text-xs text-gray-500 mt-0.5">{date(s.started_at)} · {time(s.started_at)}–{time(s.ended_at)} ({minutes(s.started_at, s.ended_at)})</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-white tabular-nums leading-none">{s.peak}</p>
                <p className="text-xs text-gray-500">busiest{s.average ? ` · avg ${s.average}` : ""}</p>
              </div>
            </div>
            {Object.keys(s.rooms ?? {}).length > 1 && (
              <p className="text-xs text-gray-500">{Object.entries(s.rooms).map(([r, n]) => `${r} ${n}`).join(" · ")}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {s.status === "ask" ? <span className="text-xs text-amber-300">Keep this record?</span>
                : <span className="text-xs text-green-400 flex items-center gap-1"><Check size={12} /> Kept{s.decided_by ? ` by ${s.decided_by}` : ""}</span>}
              <span className="flex-1" />
              <button onClick={() => csv(s)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-gray-300" style={{ background: "var(--bg-hover)" }}><Download size={12} /> CSV</button>
              {admin && s.status === "ask" && (
                <button onClick={() => act(s.id, () => servicesApi.keep(s.id))} disabled={busy === s.id}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"><Check size={12} /> Keep</button>
              )}
              {admin && confirmDelete !== s.id && (
                <button onClick={() => { setConfirmDelete(s.id); setAlsoCounts(false); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-red-300" style={{ background: "var(--bg-hover)" }}><Trash2 size={12} /> Delete</button>
              )}
            </div>
            {admin && confirmDelete === s.id && (
              <div className="rounded-xl px-3 py-2.5 flex flex-col gap-2"
                style={{ background: "rgba(185,28,28,0.1)", border: "1px solid rgba(185,28,28,0.4)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Delete &quot;{s.name}&quot;?</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  This removes the service from the list. <strong>The day&apos;s attendance figures stay</strong> on Analytics and
                  the calendar unless you tick below.
                </p>
                <label className="flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={alsoCounts} onChange={(e) => setAlsoCounts(e.target.checked)} className="mt-0.5" />
                  <span>
                    Also delete that day&apos;s counts ({time(s.started_at)}–{time(s.ended_at)}). The attendance figures,
                    arrivals and departures for that stretch go from Analytics and the calendar too. You can bring them back
                    from <strong>Recently deleted</strong> on Analytics for 30 days.
                  </span>
                </label>
                <div className="flex gap-2">
                  <button onClick={() => act(s.id, () => servicesApi.remove(s.id, alsoCounts))} disabled={busy === s.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50">
                    {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    {alsoCounts ? "Delete service and counts" : "Delete service only"}
                  </button>
                  <button onClick={() => setConfirmDelete(null)}
                    className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** App-wide: when a service ends, ask an administrator whether to keep its record. */
export function ServiceEndedPrompt() {
  const { role, isAuthenticated } = useAuth();
  const [ask, setAsk] = useState<Service | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [later, setLater] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (role !== "admin" || !isAuthenticated || !isEdgeLive()) return;
    let alive = true;
    const check = async () => {
      if (document.hidden) return;
      try {
        const d = await servicesApi.list();
        if (alive) setAsk(d.services.find((s) => s.status === "ask" && !later.has(s.id)) ?? null);
      } catch { /* not on the live site, or offline */ }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [role, isAuthenticated, later]);

  if (!ask) return null;
  const decide = async (keep: boolean) => {
    if (!keep && !confirmDelete) { setConfirmDelete(true); return; }   // never destructive on one click
    setBusy(true);
    try { keep ? await servicesApi.keep(ask.id) : await servicesApi.remove(ask.id); setAsk(null); setConfirmDelete(false); }
    catch { /* shown again next check */ }
    setBusy(false);
  };
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(440px,calc(100vw-24px))] rounded-2xl p-4 shadow-2xl"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }} role="dialog" aria-label="Service ended">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Service ended — keep the record?</p>
      <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
        {ask.name}: {time(ask.started_at)}–{time(ask.ended_at)}, {ask.peak} people at the busiest. Any face matching data was wiped when it ended.
      </p>
      {confirmDelete && (
        <p className="text-xs mt-2 rounded-lg px-2.5 py-2" style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5" }}>
          Remove this service from the list? The day&apos;s attendance figures stay on Analytics and the calendar — only this
          service entry goes. Press Delete again to confirm.
        </p>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={() => decide(true)} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"><Check size={12} /> Keep</button>
        <button onClick={() => decide(false)} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50"><Trash2 size={12} /> {confirmDelete ? "Delete — confirm" : "Delete"}</button>
        <button onClick={() => setLater(new Set(later).add(ask.id))} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>Decide later</button>
      </div>
    </div>
  );
}
