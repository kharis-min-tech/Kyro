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
import { isLiveMode } from "@/lib/liveMode";
import { notifyManualCount } from "@/lib/edgePush";
import { Users, Minus, Plus, CheckCircle, AlertTriangle, Trash2, Pencil, ClipboardCheck, Lock } from "lucide-react";

// Mode-scoped so a Demo-mode count never surfaces in a Live webhook send
// or headline total. attendance/page.tsx and integrations/page.tsx compute
// the same key inline (page.tsx cannot export arbitrary helpers in Next
// App Router — all three callers derive it the same way).
function manualCountsKey(): string {
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  return `kyro_${mode}_manual_counts`;
}
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
  // Approval flow — a count enters as a draft; at the end of service the
  // operator reviews everything and approves the final total. Only
  // approved counts feed the attendance headline and the integrations
  // webhook payload. Legacy records without the field are treated as
  // approved so pre-existing counts don't silently vanish from totals.
  approved?: boolean;
  approved_at?: number;      // epoch seconds
  approved_by?: string;
}

/** True when the record counts toward the final service total. */
function isApproved(h: ManualCount): boolean {
  return h.approved !== false; // undefined (legacy) → approved
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
    const raw = localStorage.getItem(manualCountsKey());
    return raw ? (JSON.parse(raw) as ManualCount[]) : [];
  } catch { return []; }
}

function saveCounts(counts: ManualCount[]) {
  try { localStorage.setItem(manualCountsKey(), JSON.stringify(counts)); } catch {}
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
  const [approving,  setApproving]  = useState(false);

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
      // Enters as a draft. Headline total and webhook payload ignore
      // drafts; the operator approves them once at the end of service.
      // Editing an approved count demotes it back to draft so the number
      // can't quietly change after approval without a fresh sign-off.
      approved: false,
      approved_at: undefined,
      approved_by: undefined,
    };
    all.unshift(record);
    saveCounts(all);
    setHistory(all);
    // Live mode only: alert leaders' phones. Capacity comes from the
    // camera covering the same zone, when there is one.
    if (isLiveMode()) {
      const cap = cameras.find(
        (c) => (c.zone_name ?? "").toLowerCase().trim() === trimmed.toLowerCase() && c.zone_capacity > 0,
      )?.zone_capacity ?? null;
      notifyManualCount({ kind: "count", zone: record.zone, count: record.count, capacity: cap, counted_by: record.counted_by });
    }
    setConfirming(false);
    setEditingId(null);
    setStatus({ ok: true, msg: existing
      ? `Updated: ${record.zone} → ${record.count}`
      : `Saved: ${record.zone} → ${record.count}` });
    setZone(""); setCount(0);
    setTimeout(() => setStatus(null), 3000);
  }, [zone, count, countedBy, sessionId, existing, cameraCountingThisZone, cameras]);

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

  // Rows for today's service only — ordering: drafts first (because they
  // need attention), then approved.
  const todayHistory = history.filter((h) => h.session_id === sessionId);
  const drafts       = todayHistory.filter((h) => !isApproved(h));
  const approved     = todayHistory.filter((h) =>  isApproved(h));
  const draftsTotal  = drafts.reduce((s, h) => s + (h.count || 0), 0);
  const approvedTotal = approved.reduce((s, h) => s + (h.count || 0), 0);

  function approveAll() {
    const stamp = Math.floor(Date.now() / 1000);
    const by    = countedBy.trim() || (typeof window !== "undefined"
      ? (localStorage.getItem("kyro_demo_last_user") ?? "operator")
      : "operator");
    const all = loadCounts().map((h) =>
      h.session_id === sessionId && !isApproved(h)
        ? { ...h, approved: true, approved_at: stamp, approved_by: by }
        : h
    );
    saveCounts(all);
    setHistory(all);
    setApproving(false);
    if (isLiveMode()) {
      notifyManualCount({ kind: "approved", count: draftsTotal + approvedTotal, counted_by: by });
    }
    setStatus({ ok: true, msg: `Approved ${drafts.length} count${drafts.length !== 1 ? "s" : ""} for this service — total ${draftsTotal + approvedTotal}` });
    setTimeout(() => setStatus(null), 4000);
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

          <div className="p-4 sm:p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Zone / room name</label>
              <input
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                placeholder="e.g. Overflow Room, Mothers' Room, Youth Hall"
                className="rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>People counted</label>
              {/* Minus, big number input, plus — always on one row, with the
                  input flexing. The quick-add buttons go on their OWN row
                  below so a 320px phone doesn't push +25 off the right
                  edge. inputMode="numeric" opens the digit keypad on
                  phones instead of the full qwerty. */}
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setCount((c) => Math.max(0, c - 1))}
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-xl shrink-0"
                  style={{ background: "var(--bg-hover)", border: `1px solid ${BORDER}` }}
                  aria-label="Decrease"
                >
                  <Minus size={18} />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={count}
                  onChange={(e) => setCount(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="flex-1 min-w-0 rounded-lg px-3 py-3 text-center text-2xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                  style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}
                />
                <button
                  type="button"
                  onClick={() => setCount((c) => c + 1)}
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-xl shrink-0"
                  style={{ background: "var(--bg-hover)", border: `1px solid ${BORDER}` }}
                  aria-label="Increase"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="grid grid-cols-3 sm:flex gap-2">
                {[5, 10, 25].map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => setCount((c) => c + inc)}
                    className="h-10 sm:h-9 rounded-lg text-sm font-medium"
                    style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--accent-indigo, #6366f1)" }}
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
              className="w-full sm:w-auto sm:self-start px-5 py-3 rounded-lg text-sm font-medium text-white disabled:opacity-40"
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

        {/* Drafts section — appears whenever there's at least one unapproved
            count for today. Clicking "Approve final count" sums all drafts
            + already-approved and locks them as the service's final total. */}
        {drafts.length > 0 && (
          <div className="rounded-2xl overflow-hidden"
            style={{ background: CARD, border: "1px solid rgba(245,158,11,0.35)" }}>
            <div className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"
              style={{ borderBottom: `1px solid ${BORDER}`, background: "rgba(245,158,11,0.06)" }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#f59e0b" }}>
                  {drafts.length} draft{drafts.length !== 1 ? "s" : ""} awaiting approval
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Not yet counted toward the service total — approve at the end of service.
                </p>
              </div>
              <button onClick={() => setApproving(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium text-white sm:shrink-0"
                style={{ background: "#16a34a" }}>
                <ClipboardCheck size={13} /> Approve final count
              </button>
            </div>
            {drafts.map((h, i) => (
              <div key={h.id} className="px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4"
                style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : {}}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white truncate">{h.zone}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                      DRAFT
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    by {h.counted_by} · {fmtTime(h.counted_at)}
                  </p>
                  {h.camera_also_counting && (
                    <p className="text-xs text-amber-300 mt-1">⚠ Camera also counting this zone</p>
                  )}
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white tabular-nums shrink-0">{h.count}</div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => edit(h)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}
                    aria-label="Edit">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => removeOne(h.id)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-red-400"
                    style={{ background: "rgba(239,68,68,0.08)" }}
                    aria-label="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Approved section — the final locked counts for today's service.
            Showing these separately makes it obvious which numbers are
            feeding the attendance headline and the webhook payload. */}
        {approved.length > 0 && (
          <div className="rounded-2xl overflow-hidden"
            style={{ background: CARD, border: "1px solid rgba(16,185,129,0.3)" }}>
            <div className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3"
              style={{ borderBottom: `1px solid ${BORDER}`, background: "rgba(16,185,129,0.06)" }}>
              <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "#16a34a" }}>
                <Lock size={11} /> Approved — total {approvedTotal.toLocaleString()}
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Counts toward service total</p>
            </div>
            {approved.map((h, i) => (
              <div key={h.id} className="px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4"
                style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : {}}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-white truncate">{h.zone}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(16,185,129,0.15)", color: "#16a34a" }}>
                      APPROVED
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    by {h.counted_by}
                    {h.approved_by && h.approved_at
                      ? ` · approved by ${h.approved_by} at ${fmtTime(h.approved_at)}`
                      : ""}
                  </p>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white tabular-nums shrink-0">{h.count}</div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Edit demotes back to draft (see commit record); keep the
                      option available so a late correction is possible, but
                      the operator must re-approve. */}
                  <button onClick={() => edit(h)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}
                    aria-label="Edit (will revert to draft)" title="Editing resets this count to a draft">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => removeOne(h.id)}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-red-400"
                    style={{ background: "rgba(239,68,68,0.08)" }}
                    aria-label="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {todayHistory.length === 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
              No manual counts yet. Fill out the form above to add one.
            </p>
          </div>
        )}

        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          Drafts are saved as you enter them but only approved counts count toward
          the service total. When Kyro is connected to the backend, both sync
          automatically across devices.
        </p>
      </main>

      {/* Approve-all modal — the end-of-service sign-off that locks today's
          drafts and lets them feed the attendance headline + webhook send. */}
      {approving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)" }}>
          <div className="rounded-2xl w-full max-w-md shadow-2xl"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <div className="px-6 pt-6 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#16a34a" }}>
                End of service — approve final count
              </p>
              <p className="text-lg font-bold text-white mt-1">
                {drafts.length} new count{drafts.length !== 1 ? "s" : ""} ready to approve
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
                Session: {sessionId}
              </p>
              <div className="mt-4 rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                {drafts.map((d, i) => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2"
                    style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : {}}>
                    <span className="text-sm text-white truncate">{d.zone}</span>
                    <span className="text-sm font-bold text-white tabular-nums">{d.count}</span>
                  </div>
                ))}
                {approved.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-2"
                    style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(16,185,129,0.05)" }}>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Already approved · {approved.length} count{approved.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: "#16a34a" }}>{approvedTotal}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-3 py-2.5"
                  style={{ borderTop: `1px solid ${BORDER}`, background: "var(--bg-inset)" }}>
                  <span className="text-sm font-semibold text-white">Service total after approval</span>
                  <span className="text-xl font-bold tabular-nums" style={{ color: "#16a34a" }}>
                    {(draftsTotal + approvedTotal).toLocaleString()}
                  </span>
                </div>
              </div>
              <p className="text-xs mt-3" style={{ color: "var(--text-faint)" }}>
                Once approved, these counts feed the attendance headline and the
                integrations webhook. Editing an approved count later resets it
                back to draft and asks you to approve again.
              </p>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: BORDER }}>
              <button onClick={() => setApproving(false)}
                className="flex-1 py-2.5 rounded-lg text-sm text-gray-300"
                style={{ background: "var(--bg-hover)" }}>
                Not yet
              </button>
              <button onClick={approveAll}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-1.5"
                style={{ background: "#16a34a" }}>
                <ClipboardCheck size={14} /> Approve
              </button>
            </div>
          </div>
        </div>
      )}

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
