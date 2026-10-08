"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { attendanceApi } from "@/lib/api";
import { useCameras } from "@/hooks/useCameras";
import { usePipelineStream } from "@/hooks/usePipelineStream";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE, DEMO_SESSIONS } from "@/lib/demo";
import { isEdgeLive } from "@/lib/edgeAuth";
import { edgeVenueApi, useEdgeVenue, type EdgeHistoryPoint } from "@/lib/edgeVenue";

function isLiveMode(): boolean { if (typeof window === "undefined") return false; return localStorage.getItem("kyro_mode") === "live"; }
const inDemoMode = () => typeof window !== "undefined" && (localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL);
import { Play, Square, Download, Radio, WifiOff, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import type { SessionResponse, Camera, ZoneLive } from "@/types";

const BG     = "var(--bg-base)";
const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";

// Mode-scoped storage: Live mode and Demo mode keep SEPARATE session lists
// so deleting a session in one mode doesn't affect the other. Previously
// both modes read/wrote the same "kyro_demo_sessions" key.
function sessionsKey(): string {
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  return `kyro_${mode}_sessions`;
}

function loadDemoSessions(): SessionResponse[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(sessionsKey());
    if (saved) {
      const parsed = JSON.parse(saved) as SessionResponse[];
      if (Array.isArray(parsed)) return parsed;
    }
    // Seed sample DEMO_SESSIONS only in Demo mode. Live mode starts empty.
    const isActualDemo = localStorage.getItem("kyro_mode") === "demo";
    const defaults = isActualDemo ? (DEMO_SESSIONS as SessionResponse[]) : [];
    localStorage.setItem(sessionsKey(), JSON.stringify(defaults));
    return defaults;
  } catch {
    return [];
  }
}

function saveDemoSessions(sessions: SessionResponse[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(sessionsKey(), JSON.stringify(sessions));
  } catch {}
}

function addDemoSession(session: SessionResponse): SessionResponse[] {
  const existing = loadDemoSessions();
  // Prevent duplicates
  const deduped = existing.filter((s) => s.session_id !== session.session_id);
  const all = [session, ...deduped];
  saveDemoSessions(all);
  return all;
}

function updateDemoSession(sessionId: string, patch: Partial<SessionResponse>): SessionResponse[] {
  const all = loadDemoSessions().map((s) =>
    s.session_id === sessionId ? { ...s, ...patch } : s
  );
  saveDemoSessions(all);
  return all;
}

// ─── Suggest a session name from the current day/time ────────────────────────
// Returns empty string — user names it themselves, or it shows as "Unnamed session"
function suggestSessionName(): string {
  return "";
}

function formatDuration(start: string, end: string | null): string {
  const ms  = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const min = Math.floor(ms / 60000);
  const h   = Math.floor(min / 60);
  const m   = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Edge Live helpers (Cloudflare build, counts from /api/live/*) ───────────
function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
/** The camera's real per-minute rows between a session's start and end (local calendar days in between). */
async function edgeSessionRows(session: SessionResponse, endMs: number): Promise<EdgeHistoryPoint[]> {
  const tz = browserTz();
  const start = new Date(session.started_at).getTime();
  const dates: string[] = [];
  for (let t = start; ; t += 86_400_000) {
    const d = localDate(Math.min(t, endMs), tz);
    if (!dates.includes(d)) dates.push(d);
    if (t >= endMs || dates.length >= 3) break;
  }
  const endDate = localDate(endMs, tz);
  if (!dates.includes(endDate)) dates.push(endDate);
  const all = (await Promise.all(dates.map((d) => edgeVenueApi.history(d, tz, session.camera_id)))).flat();
  return all
    .filter((r) => r.camera_id === session.camera_id)
    .filter((r) => { const t = Date.parse(r.timestamp); return t >= start && t <= endMs; })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// ─── Live camera card — shows live count + one-tap session start ──────────────
function LiveCameraCard({
  camera,
  existingSession,
  onStart,
  onEnd,
  starting,
  ending,
  edge = false,
  edgeZone = null,
}: {
  edge?: boolean;
  /** Edge Live: this camera's live numbers from /api/live/venue (null = not reporting). */
  edgeZone?: ZoneLive | null;
  camera: Camera;
  existingSession: SessionResponse | null;
  onStart: (camera: Camera) => void;
  onEnd: (sessionId: string) => void;
  starting: string | null;
  ending: string | null;
}) {
  const { role } = useAuth();
  const streamRole = (role === "admin" || role === "operator") ? role : "viewer" as const;
  const { data, connected } = usePipelineStream(camera.camera_id, streamRole);
  const current  = edge ? (edgeZone?.current ?? 0) : (data?.attendance.current ?? 0);
  const peak     = edge ? (edgeZone?.peak    ?? 0) : (data?.attendance.peak    ?? 0);
  const entries  = edge ? (edgeZone?.entries ?? 0) : (data?.attendance.entries ?? 0);
  const isQueue  = camera.location === "queue";
  const isLive   = edge ? !!edgeZone?.is_running : (inDemoMode() || (connected && !!data));

  if (isQueue) return null; // Queue cameras don't have sessions

  const hasActive = !!existingSession && !existingSession.ended_at;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${hasActive ? "#4338ca" : BORDER}` }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isLive ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
          <p className="text-sm font-semibold text-white truncate">{camera.zone_name ?? camera.name}</p>
          {hasActive && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}>
              ● Session live · {formatDuration(existingSession.started_at, null)}
            </span>
          )}
        </div>
        {!isLive && <WifiOff size={14} className="text-gray-600 shrink-0" />}
      </div>

      <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        {/* Live stats — grid on mobile so numbers don't push off-screen */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-x-4 gap-y-3 sm:gap-5 flex-1">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Now</p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{current.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Peak</p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: "#818cf8" }}>{peak.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Entries</p>
            <p className="text-2xl font-bold text-green-400 tabular-nums">{entries.toLocaleString()}</p>
          </div>
          {camera.zone_capacity > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Capacity</p>
              <p className="text-lg font-semibold tabular-nums" style={{ color: "var(--text-muted)" }}>{camera.zone_capacity.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Action button */}
        {hasActive ? (
          <button
            onClick={() => onEnd(existingSession.session_id)}
            disabled={ending === existingSession.session_id}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 sm:shrink-0"
            style={{ background: "#dc2626" }}>
            <Square size={13} />
            {ending === existingSession.session_id ? "Ending…" : "End session"}
          </button>
        ) : (
          <button
            onClick={() => onStart(camera)}
            disabled={starting === camera.camera_id || !isLive}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 sm:shrink-0"
            style={{ background: isLive ? "#4f46e5" : "var(--bg-hover)" }}
            title={!isLive ? (edge ? "This camera isn't counting — start Camera Mode or the camera computer first" : "Camera not live — start a worker first") : undefined}>
            <Play size={13} />
            {starting === camera.camera_id ? "Starting…" : "Start session"}
          </button>
        )}
      </div>

      {/* Active session detail */}
      {hasActive && (
        <div className="px-5 py-3 flex items-center gap-4" style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(99,102,241,0.04)" }}>
          <p className="text-xs text-gray-400 flex-1 truncate">{existingSession.name || "Unnamed session"}</p>
          <p className="text-xs text-gray-500">started {new Date(existingSession.started_at).toLocaleTimeString()}</p>
          <Link href={`/seating`}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0">
            Seat map →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Manual start form (collapsed by default) ────────────────────────────────
function ManualStartForm({ cameras, onCreated }: {
  cameras: Camera[];
  onCreated: (s: SessionResponse) => void;
}) {
  const [open, setOpen]           = useState(false);
  const [name, setName]           = useState("");
  const [cameraId, setCameraId]   = useState(cameras[0]?.camera_id ?? "");
  const [capacity, setCapacity]   = useState("");
  const [creating, setCreating]   = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  // Auto-fill capacity from selected camera
  useEffect(() => {
    const cam = cameras.find((c) => c.camera_id === cameraId);
    if (cam && cam.zone_capacity > 0) setCapacity(String(cam.zone_capacity));
  }, [cameraId, cameras]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setErr(null);
    if (inDemoMode()) {
      const newSess: SessionResponse = {
        session_id: `sess-demo-${Date.now()}`,
        camera_id: cameraId, name,
        started_at: new Date().toISOString(), ended_at: null,
        venue_capacity: parseInt(capacity, 10) || 0,
        peak_attendance: 0, total_entries: 0, total_exits: 0,
      };
      const all = addDemoSession(newSess);
      onCreated(newSess);
      setOpen(false); setCreating(false);
      return;
    }
    try {
      const s = await attendanceApi.createSession({ camera_id: cameraId, name, venue_capacity: parseInt(capacity, 10) || 0 });
      onCreated(s);
      setOpen(false);
    } catch (e: any) { setErr(e.message); }
    finally { setCreating(false); }
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-5 py-4 text-sm text-gray-400 hover:text-white transition-colors">
        <Plus size={15} className="text-indigo-400" />
        <span className="font-medium">Start a session manually</span>
        <ChevronRight size={14} className={`ml-auto transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <form onSubmit={submit} className="px-4 sm:px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end gap-3" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="flex flex-col gap-1 lg:w-52">
            <label className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Session name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required
              className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Camera</label>
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}
              className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }}>
              {cameras.filter((c) => c.location !== "queue").map((c) => (
                <option key={c.camera_id} value={c.camera_id}>{c.zone_name ?? c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 lg:w-28">
            <label className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Capacity</label>
            <input type="number" min="0" value={capacity} onChange={(e) => setCapacity(e.target.value)}
              placeholder="auto-filled"
              className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
              style={{ background: "var(--bg-base)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
          </div>
          {err && <p className="col-span-full lg:w-full text-xs text-red-400">{err}</p>}
          <button type="submit" disabled={creating}
            className="col-span-full sm:col-span-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "#4f46e5" }}>
            <Play size={13} />
            {creating ? "Starting…" : "Start"}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Past sessions list ───────────────────────────────────────────────────────
function SessionHistory({ sessions, onDownload, onRename, onDelete }: {
  sessions: SessionResponse[];
  onDownload: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editName, setEditName]     = useState("");

  const ended = sessions.filter((s) => !!s.ended_at).sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
  if (ended.length === 0) return null;

  function startEdit(s: SessionResponse) {
    setEditingId(s.session_id);
    setEditName(s.name);
  }

  function confirmRename(id: string) {
    if (editName.trim()) onRename(id, editName.trim());
    setEditingId(null);
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Past sessions</p>
      <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        {ended.map((s, i) => (
          <div key={s.session_id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4"
            style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : {}}>
            <div className="flex-1 min-w-0">
              {editingId === s.session_id ? (
                <div className="flex items-center gap-2 mb-1">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename(s.session_id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    className="bg-gray-900 border border-indigo-600 text-white text-sm rounded-lg px-3 py-1 focus:outline-none w-56"
                  />
                  <button onClick={() => confirmRename(s.session_id)}
                    className="text-xs px-2 py-1 rounded-lg text-white"
                    style={{ background: "#4f46e5" }}>Save</button>
                  <button onClick={() => setEditingId(null)}
                    className="text-xs text-gray-500 hover:text-white">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-0.5">
                  {s.name ? (
                    <p className="text-sm font-medium text-white">{s.name}</p>
                  ) : (
                    <p className="text-sm font-medium italic" style={{ color: "#6b7280" }}>Unnamed session</p>
                  )}
                  <button onClick={() => startEdit(s)}
                    className="text-xs text-gray-600 hover:text-gray-300 transition-colors">✎ rename</button>
                </div>
              )}
              <p className="text-xs" style={{ color: "#6b7280" }}>
                {new Date(s.started_at).toLocaleString()} · {formatDuration(s.started_at, s.ended_at)} ·{" "}
                Peak {s.peak_attendance} · {s.total_entries} entries
                {s.venue_capacity > 0 && ` · Cap ${s.venue_capacity}`}
                {" · "}<span className="font-mono">{s.camera_id}</span>
              </p>
            </div>
            <div className="flex items-center gap-3 sm:shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0" style={{ borderColor: BORDER }}>
              <button onClick={() => onDownload(s.session_id)}
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                <Download size={11} /> Export CSV
              </button>
              <button onClick={() => onDelete(s.session_id)}
                className="text-xs text-red-600 hover:text-red-400 transition-colors">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SessionsPage() {
  const { cameras, loading: camsLoading } = useCameras();
  const [sessions, setSessions]   = useState<SessionResponse[]>([]);
  const [loading, setLoading]     = useState(true);
  const [starting, setStarting]   = useState<string | null>(null);
  const [ending, setEnding]       = useState<string | null>(null);
  const [status, setStatus]       = useState<{ ok: boolean; msg: string } | null>(null);
  const { canViewAttendance, isAuthenticated, role } = useAuth();
  const router = useRouter();
  const [hydrated, setHydrated]   = useState(false);
  const [edge, setEdge]           = useState(false);
  useEffect(() => { setHydrated(true); setEdge(isEdgeLive()); }, []);
  const { venue: edgeVenue } = useEdgeVenue(edge);
  const zoneFor = (cameraId: string): ZoneLive | null =>
    edgeVenue?.zones.find((z) => z.camera_id === cameraId) ?? null;

  // Edge Live: keep the highest count seen while each session runs, saved
  // with the session so it survives leaving the page.
  const sessionsRef = useRef<SessionResponse[]>([]);
  sessionsRef.current = sessions;
  useEffect(() => {
    if (!edge || !edgeVenue) return;
    let changed = false;
    let all: SessionResponse[] | null = null;
    for (const sess of sessionsRef.current) {
      if (sess.ended_at) continue;
      const z = edgeVenue.zones.find((x) => x.camera_id === sess.camera_id);
      if (!z || !z.is_running || (z.current ?? 0) <= (sess.peak_attendance ?? 0)) continue;
      all = updateDemoSession(sess.session_id, { peak_attendance: z.current });
      changed = true;
    }
    if (changed && all) setSessions(all);
  }, [edge, edgeVenue]);

  useEffect(() => {
    if (!hydrated || inDemoMode()) return;
    if (!isAuthenticated) { router.replace("/login"); return; }
    if (!canViewAttendance) router.replace("/seating");
  }, [hydrated, isAuthenticated, canViewAttendance, router]);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (inDemoMode()) {
      setSessions(loadDemoSessions());
      setLoading(false);
      return;
    }
    try {
      const result = await attendanceApi.listSessions();
      setSessions(result);
      setLoadError(null);
    } catch (e: any) {
      // Previously this silently cleared the list on ANY failure
      // (expired token, brief network hiccup, backend restart) — making a
      // genuinely still-running session indistinguishable from "no
      // sessions at all". If you start a session, navigate away, and come
      // back to find it apparently gone, check here first: a visible
      // error means the fetch failed (the session is very likely still
      // running on the backend), not that it was actually ended.
      setLoadError(e?.message || "Failed to load sessions");
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // One-tap session start — pre-fills name from day/time, capacity from camera
  async function handleQuickStart(camera: Camera) {
    setStarting(camera.camera_id);
    setStatus(null);
    const name = ""; // User will name it — shown as "Unnamed session" until renamed
    const cap  = camera.zone_capacity ?? 0;
    if (inDemoMode()) {
      const s: SessionResponse = {
        session_id: `sess-demo-${Date.now()}`,
        camera_id: camera.camera_id, name,
        started_at: new Date().toISOString(), ended_at: null,
        venue_capacity: cap, peak_attendance: 0, total_entries: 0, total_exits: 0,
      };
      const all = addDemoSession(s);
      setSessions(all);
      setStatus({ ok: true, msg: `Session started — "${name}"` });
      setStarting(null);
      return;
    }
    try {
      const s = await attendanceApi.createSession({ camera_id: camera.camera_id, name, venue_capacity: cap });
      setSessions((prev) => [s, ...prev]);
      setStatus({ ok: true, msg: `Session started — "${name}"` });
    } catch (e: any) { setStatus({ ok: false, msg: e.message }); }
    finally { setStarting(null); }
  }

  async function handleEnd(sessionId: string) {
    setEnding(sessionId);
    setStatus(null);
    if (isEdgeLive()) {
      // Real numbers only: the highest count seen while the session ran,
      // plus whatever the camera's minute-by-minute history shows.
      const sess = loadDemoSessions().find((s) => s.session_id === sessionId);
      const endMs = Date.now();
      const patch: Partial<SessionResponse> = { ended_at: new Date(endMs).toISOString() };
      let note = "";
      if (sess) {
        let peak = sess.peak_attendance ?? 0;
        try {
          const rows = await edgeSessionRows(sess, endMs);
          if (rows.length) {
            peak = Math.max(peak, ...rows.map((r) => r.attendance || 0));
            const first = rows[0], last = rows[rows.length - 1];
            patch.total_entries = Math.max(0, (last.total_entries || 0) - (first.total_entries || 0));
            patch.total_exits   = Math.max(0, (last.total_exits || 0) - (first.total_exits || 0));
          }
        } catch {
          note = " (couldn't load the camera's history, so entries weren't added)";
        }
        patch.peak_attendance = peak;
      }
      setSessions(updateDemoSession(sessionId, patch));
      setStatus({ ok: true, msg: `Session ended — peak ${patch.peak_attendance ?? 0} saved${note}` });
      setEnding(null);
      return;
    }
    if (inDemoMode()) {
      const updated = updateDemoSession(sessionId, { ended_at: new Date().toISOString() });
      setSessions(updated);
      setStatus({ ok: true, msg: "Session ended — metrics saved" });
      setEnding(null);
      return;
    }
    try {
      await attendanceApi.endSession(sessionId);
      setStatus({ ok: true, msg: "Session ended — metrics saved" });
      await loadSessions();
    } catch (e: any) { setStatus({ ok: false, msg: e.message }); }
    finally { setEnding(null); }
  }

  async function handleRename(sessionId: string, newName: string) {
    if (inDemoMode()) {
      const updated = updateDemoSession(sessionId, { name: newName });
      setSessions(updated);
    } else {
      try {
        await attendanceApi.renameSession(sessionId, newName);
        setSessions((prev) => prev.map((s) => s.session_id === sessionId ? { ...s, name: newName } : s));
      } catch (e: any) { setStatus({ ok: false, msg: e.message }); }
    }
  }

  async function handleDelete(sessionId: string) {
    if (!confirm("Delete this session? This can't be undone.")) return;
    if (inDemoMode()) {
      const updated = loadDemoSessions().filter((s) => s.session_id !== sessionId);
      saveDemoSessions(updated);
      setSessions(updated);
    } else {
      try {
        await attendanceApi.deleteSession(sessionId);
        setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
        setStatus({ ok: true, msg: "Session deleted" });
      } catch (e: any) { setStatus({ ok: false, msg: e.message }); }
    }
  }

  async function downloadEdgeCsv(sessionId: string) {
    const session = loadDemoSessions().find((s) => s.session_id === sessionId);
    if (!session) return;
    const endMs = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
    const cap   = session.venue_capacity || 0;
    let rows: EdgeHistoryPoint[] = [];
    let failed = false;
    try { rows = await edgeSessionRows(session, endMs); } catch { failed = true; }
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    let lines: string[];
    if (rows.length) {
      lines = ["recorded_at,current_attendance,total_entries,total_exits,occupancy_percent"];
      for (const r of rows) {
        const occ = cap > 0 ? ((r.attendance / cap) * 100).toFixed(1) : String(r.occupancy_pct ?? 0);
        lines.push(`${r.timestamp},${r.attendance},${r.total_entries},${r.total_exits},${occ}`);
      }
    } else {
      // No per-minute rows (or they couldn't be loaded): summary only — never invented numbers.
      lines = [
        "session_name,camera_id,started_at,ended_at,peak_attendance,total_entries,total_exits,venue_capacity",
        [esc(session.name || "Unnamed session"), esc(session.camera_id), session.started_at, session.ended_at ?? "",
         session.peak_attendance, session.total_entries, session.total_exits, session.venue_capacity].join(","),
      ];
      setStatus({ ok: !failed, msg: failed
        ? "Couldn't load the camera's minute-by-minute counts — exported the session summary only."
        : "No minute-by-minute counts were recorded for this session — exported the session summary only." });
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `kyro-${(session.name || "session").replace(/\s+/g, "-").toLowerCase()}-${sessionId}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  function downloadCsv(sessionId: string) {
    if (isEdgeLive()) { downloadEdgeCsv(sessionId); return; }
    if (inDemoMode()) {
      const session = loadDemoSessions().find((s) => s.session_id === sessionId);
      if (!session) return;
      const start    = new Date(session.started_at).getTime();
      const end      = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
      const cap      = session.venue_capacity || 250;
      const peakEst  = session.peak_attendance > 0 ? session.peak_attendance : Math.round(cap * 0.8);
      const rows     = ["recorded_at,current_attendance,total_entries,total_exits,occupancy_percent"];
      let entries    = 0;
      let exits      = 0;
      const duration = end - start;
      for (let t = start; t <= end; t += 10 * 60_000) {
        const progress = (t - start) / Math.max(duration, 1);
        // Realistic ramp-up, plateau, ramp-down curve
        const curve    = progress < 0.4 ? progress / 0.4 : progress < 0.75 ? 1 : (1 - progress) / 0.25;
        const current  = Math.max(0, Math.round(peakEst * curve * (0.9 + Math.random() * 0.1)));
        const delta    = current - (entries - exits);
        if (delta > 0) entries += delta;
        else exits += Math.abs(delta);
        const occ = cap > 0 ? ((current / cap) * 100).toFixed(1) : "0.0";
        rows.push(`${new Date(t).toISOString()},${current},${entries},${exits},${occ}`);
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const a    = document.createElement("a");
      a.href     = URL.createObjectURL(blob);
      a.download = `kyro-${session.name.replace(/\s+/g, "-").toLowerCase()}-${sessionId}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      return;
    }
    const token = localStorage.getItem("kyro_token") ?? "";
    fetch(attendanceApi.exportSessionCsv(sessionId), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.blob() : Promise.reject(r))
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `kyro-session-${sessionId}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
      })
      .catch(() => setStatus({ ok: false, msg: "CSV export failed" }));
  }

  const indoorCameras = cameras.filter((c) => c.location !== "queue");

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: BG }}>
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0 p-3 sm:p-6 overflow-auto max-w-3xl flex flex-col gap-6">

        <div>
          <h1 className="text-xl font-bold text-white">Sessions</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Live cameras below — tap "Start session" to begin recording attendance
          </p>
        </div>

        {status && (
          <div className={`text-sm px-4 py-3 rounded-xl border ${status.ok ? "border-green-800 text-green-300" : "border-red-800 text-red-300"}`}
            style={{ background: status.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}>
            {status.msg}
          </div>
        )}

        {loadError && !inDemoMode() && (
          <div className="text-sm px-4 py-3 rounded-xl border border-amber-800 text-amber-300 flex items-center justify-between gap-3"
            style={{ background: "rgba(245,158,11,0.08)" }}>
            <span>Couldn't load sessions ({loadError}) — if you started one, it's very likely still running; this list just failed to refresh.</span>
            <button onClick={loadSessions} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-900/60 border border-amber-700">
              Retry
            </button>
          </div>
        )}

        {/* Live camera cards — one per indoor camera */}
        {camsLoading || loading ? (
          <p className="text-sm text-gray-500 text-center py-8">Loading…</p>
        ) : indoorCameras.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <Radio size={28} className="mx-auto mb-3 text-gray-700" />
            <p className="text-sm text-gray-500">No cameras registered — add cameras first to start sessions</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {indoorCameras.map((cam) => {
              const activeSession = sessions.find((s) => s.camera_id === cam.camera_id && !s.ended_at) ?? null;
              return (
                <LiveCameraCard
                  key={cam.camera_id}
                  camera={cam}
                  existingSession={activeSession}
                  onStart={handleQuickStart}
                  onEnd={handleEnd}
                  starting={starting}
                  ending={ending}
                  edge={edge}
                  edgeZone={edge ? zoneFor(cam.camera_id) : null}
                />
              );
            })}
          </div>
        )}

        {/* Manual start — collapsed, for custom names */}
        {!camsLoading && indoorCameras.length > 0 && (
          <ManualStartForm
            cameras={indoorCameras}
            onCreated={(s) => {
              // Re-read from localStorage to get the full saved list
              setSessions(inDemoMode() ? loadDemoSessions() : (prev) => [s, ...prev]);
              setStatus({ ok: true, msg: `Session started — "${s.name}"` });
            }}
          />
        )}

        {/* Past sessions */}
        <SessionHistory sessions={sessions} onDownload={downloadCsv} onRename={handleRename} onDelete={handleDelete} />

      </main>
    </div>
  );
}
