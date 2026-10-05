"use client";

/**
 * Manual Count — ushers count people in rooms without cameras.
 *
 * Design decisions:
 *  - A manual count is scoped to a (zone, session) pair. Submitting a
 *    second count for the same pair REPLACES the first — no additive
 *    double counting if the usher re-counts.
 *  - If a zone has an active camera, the UI warns before letting the
 *    usher submit — the camera already counts that zone, adding a
 *    manual count on top would double-count attendance.
 *  - A confirmation modal shows the exact number + zone before saving,
 *    so an accidental tap can't publish a wrong number.
 *  - Submitted counts show in a history list, each editable (updates
 *    the existing record for that zone+session rather than appending).
 */

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { useCameras } from "@/hooks/useCameras";
import { Users, Minus, Plus, CheckCircle, AlertTriangle, Trash2, Pencil } from "lucide-react";

const STORAGE_KEY = "kyro_manual_counts";
const CARD   = "var(--bg-card)";
const BORDER = "var(--border-subtle)";

interface ManualCount {
  id: string;
  zone: string;
  count: number;
  counted_by: string;
  counted_at: number;        // epoch seconds
  session_id: string;        // which service this belongs to
  camera_also_counting: boolean;
}

function currentSessionId(): string {
  // One session per calendar date — ushers counting on the same Sunday
  // overwrite each other's count for the same zone (that's the intent).
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadCounts(): ManualCount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ManualCount[]) : [];
  } catch { return []; }
}

function saveCounts(counts: ManualCount[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(counts)); } catch {}
  window.dispatchEvent(new Event("kyro_manual_counts_changed"));
}

function fmtTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString();
}

export default function ManualCountPage() {
  const { cameras } = useCameras();
  const [zone,       setZone]       = useState("");
  const [count,      setCount]      = useState(0);
  const [countedBy,  setCountedBy]  = useState("");
  const [history,    setHistory]    = useState<ManualCount[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [status,     setStatus]     = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setHistory(loadCounts());
    try { setCountedBy(localStorage.getItem("kyro_demo_last_user") ?? ""); } catch {}
  }, []);

  const sessionId = currentSessionId();

  // Is this zone already being counted by an active camera?
  const cameraCountingThisZone = zone.trim() && cameras.some(
    (c) => (c.zone_name ?? "").toLowerCase().trim() === zone.toLowerCase().trim() && c.is_active
  );

  // Is there already a manual count for this zone+session?
  const existing = history.find((h) => h.zone.toLowerCase() === zone.toLowerCase() && h.session_id === sessionId);

  const commit = useCallback(() => {
    if (!zone.trim()) return;
    const trimmed = zone.trim();
    const all = loadCounts().filter(
      (h) => !(h.zone.toLowerCase() === trimmed.toLowerCase() && h.session_id === sessionId)
    );
    const record: ManualCount = {
      id: existing?.id ?? `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      zone: trimmed,
      count,
      counted_by: countedBy.trim() || "Unknown",
      counted_at: Math.floor(Date.now() / 1000),
      session_id: sessionId,
      camera_also_counting: !!cameraCountingThisZone,
    };
    all.unshift(record);
    saveCounts(all);
    setHistory(all);
    setConfirming(false);
    setEditingId(null);
    setStatus({ ok: true, msg: existing
      ? `Updated: ${record.zone} → ${record.count}`
      : `Saved: ${record.zone} → ${record.count}` });
    setZone(""); setCount(0);
    setTimeout(() => setStatus(null), 3000);
  }, [zone, count, countedBy, sessionId, existing, cameraCountingThisZone]);

  function removeOne(id: string) {
    if (!window.confirm("Remove this manual count? It cannot be undone.")) return;
    const next = loadCounts().filter((h) => h.id !== id);
    saveCounts(next);
    setHistory(next);
  }

  function edit(h: ManualCount) {
    setEditingId(h.id);
    setZone(h.zone);
    setCount(h.count);
  }

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      <main className="flex-1 pt-14 md:pt-0 p-3 sm:p-6 overflow-auto max-w-3xl flex flex-col gap-5">

        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users size={18} /> Manual Count
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            For rooms without a camera. Ushers can enter a headcount; the system
            keeps one count per zone per service.
          </p>
        </div>

        {/* Entry form */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-sm font-semibold text-white">
              {editingId ? "Edit count" : "New count"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Session: {sessionId}
            </p>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Zone / room name</label>
              <input
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="e.g. Overflow Room, Mothers' Room, Youth Hall"
                className="rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>People counted</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.max(0, c - 1))}
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-xl"
                  style={{ background: "var(--bg-hover)", border: `1px solid ${BORDER}` }}
                  aria-label="Decrease"
                >
                  <Minus size={18} />
                </button>
                <input
                  type="number"
                  min={0}
                  value={count}
                  onChange={(e) => setCount(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="flex-1 rounded-lg px-3 py-3 text-center text-2xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                  style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}
                />
                <button
                  type="button"
                  onClick={() => setCount((c) => c + 1)}
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-xl"
                  style={{ background: "var(--bg-hover)", border: `1px solid ${BORDER}` }}
                  aria-label="Increase"
                >
                  <Plus size={18} />
                </button>
                {[5, 10, 25].map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => setCount((c) => c + inc)}
                    className="px-3 h-11 rounded-lg text-sm font-medium text-indigo-200"
                    style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)" }}
                  >
                    +{inc}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Counted by</label>
              <input
                value={countedBy}
                onChange={(e) => setCountedBy(e.target.value)}
                placeholder="Your name"
                className="rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}
              />
            </div>

            {/* Dedup warning */}
            {cameraCountingThisZone && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.35)" }}>
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200">
                  A camera is already counting {`"${zone.trim()}"`}. Adding a manual
                  count will double-count this zone. Only submit if you&apos;re sure
                  the camera is offline or missing people.
                </p>
              </div>
            )}

            {existing && !editingId && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.35)" }}>
                <AlertTriangle size={14} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-200">
                  A count of <strong>{existing.count}</strong> already exists for this
                  zone this service. Submitting will <strong>replace</strong> it (not add to it).
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!zone.trim() || count < 0}
              className="self-start px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40"
              style={{ background: "#4f46e5" }}
            >
              Review &amp; submit
            </button>
          </div>
        </div>

        {status && (
          <div className={`rounded-xl px-4 py-3 flex items-center gap-2 ${status.ok ? "text-green-300" : "text-red-300"}`}
            style={{
              background: status.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${status.ok ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"}`,
            }}>
            <CheckCircle size={14} /> <span className="text-sm">{status.msg}</span>
          </div>
        )}

        {/* History */}
        <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {history.length} count{history.length !== 1 ? "s" : ""} today
            </p>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
              No manual counts yet. Fill out the form above to add one.
            </p>
          ) : (
            history.map((h, i) => (
              <div key={h.id} className="px-5 py-4 flex items-center gap-4"
                style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : {}}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{h.zone}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    by {h.counted_by} · {fmtTime(h.counted_at)}
                  </p>
                  {h.camera_also_counting && (
                    <p className="text-xs text-amber-300 mt-1">⚠ Camera also counting this zone</p>
                  )}
                </div>
                <div className="text-2xl font-bold text-white tabular-nums">{h.count}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => edit(h)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}
                    aria-label="Edit">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => removeOne(h.id)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-red-400"
                    style={{ background: "rgba(239,68,68,0.08)" }}
                    aria-label="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          Counts live in this browser. When Kyro is connected to the backend
          they&apos;ll sync automatically across devices.
        </p>
      </main>

      {/* Confirmation modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)" }}>
          <div className="rounded-2xl w-full max-w-sm shadow-2xl"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <div className="px-6 pt-6 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Confirm count
              </p>
              <p className="text-lg font-bold text-white mt-1">
                {zone.trim()}: <span className="text-indigo-300">{count}</span> people
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
                Counted by {countedBy.trim() || "Unknown"} · {sessionId}
              </p>
              {cameraCountingThisZone && (
                <p className="text-xs text-amber-300 mt-3">
                  ⚠ A camera is also counting this zone — this will cause double counting.
                </p>
              )}
              {existing && (
                <p className="text-xs text-blue-300 mt-3">
                  Replaces previous count of {existing.count} for this zone today.
                </p>
              )}
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: BORDER }}>
              <button onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 rounded-lg text-sm text-gray-300"
                style={{ background: "var(--bg-hover)" }}>
                Cancel
              </button>
              <button onClick={commit}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white"
                style={{ background: "#4f46e5" }}>
                Confirm &amp; save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
