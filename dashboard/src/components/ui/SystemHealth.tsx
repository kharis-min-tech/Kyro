"use client";

/**
 * Is Kyro working?
 *
 * One rule: a green light here means the checks behind it passed. Not that
 * nothing has complained, not that the connection is up — that every question
 * Kyro knows how to ask about that component was asked and answered.
 *
 * And the opposite rule: a problem stays on this page until the thing that
 * failed works again. It cannot be dismissed, cleared or tidied away. If it
 * was failing for twenty minutes this morning it says so afterwards, because
 * a problem that quietly disappears is how nobody finds out why the figures
 * looked odd.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Camera, Users } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";

const BORDER = "var(--border-subtle)";
const GOOD = "#22c55e", BAD = "#ef4444", WARN = "#f59e0b";

interface Check { name: string; ok: boolean; says: string }
interface CamHealth {
  camera_id: string; name: string; where: string; ok: boolean; state: string;
  checks: Check[]; worst: string | null; last_seen: string | null;
  fps: number; needs_fps: number; picture_size: string | null;
}
interface Problem {
  where: string; what: string; detail: string; happened: number;
  since: string; last: string; ago_s: number; fixed: boolean; fixed_at: string | null;
}
interface Health {
  ok: boolean; checked_at: string; code: string;
  cameras: CamHealth[]; cameras_working: number; cameras_total: number;
  service: { id: string; name: string; since: string } | null;
  counting: {
    register_running: boolean; people_in_register: number; building_seats: number;
    attendance_is_from_register: boolean;
  };
  problems: Problem[]; problems_now: number;
}

const ago = (s: number) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

export function SystemHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => edgeFetch<Health>("/api/live/health")
    .then((r) => { setH(r); setErr(null); })
    .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't reach Kyro to ask")), []);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 15_000); return () => clearInterval(t); }, [load]);

  // Kyro not answering at all is itself a failure, and says so rather than
  // showing nothing.
  if (err) {
    return (
      <div className="rounded-2xl px-5 py-4" style={{ background: "var(--bg-card)", border: `1px solid ${BAD}55` }}>
        <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: BAD }}>
          <XCircle size={14} /> Kyro isn&apos;t answering
        </p>
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{err}</p>
      </div>
    );
  }
  if (!h) return null;

  const live = h.problems.filter((p) => !p.fixed);
  const fixed = h.problems.filter((p) => p.fixed).slice(0, 8);
  const colour = h.ok ? GOOD : live.length ? BAD : WARN;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: `1px solid ${h.ok ? BORDER : `${colour}55`}` }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <Activity size={14} /> Is Kyro working?
          </p>
          <p className="flex items-center gap-1.5" style={{ fontSize: 12, color: colour, marginTop: 3, fontWeight: 600 }}>
            {h.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {h.ok
              ? `Yes — ${h.cameras_working} of ${h.cameras_total} cameras working, every check passed`
              : `${live.length > 0 ? `${live.length} problem${live.length === 1 ? "" : "s"}` : "Something needs attention"}`
                + ` · ${h.cameras_working} of ${h.cameras_total} cameras working`}
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{open ? "Hide" : "Show"}</span>
      </button>

      {/* Live problems are shown whether or not the panel is open. A failure
          you have to go looking for is a failure nobody finds. */}
      {live.length > 0 && (
        <ul style={{ borderTop: `1px solid ${BORDER}` }}>
          {live.map((p, i) => (
            <li key={`${p.where}-${i}`} className="px-5 py-3" style={{ borderTop: i ? `1px solid ${BORDER}` : undefined, background: "rgba(239,68,68,0.06)" }}>
              <p className="flex items-start gap-2" style={{ fontSize: 13, color: "var(--text-primary)" }}>
                <XCircle size={13} style={{ color: BAD, flexShrink: 0, marginTop: 2 }} />
                <span><strong>{p.where}</strong> — {p.what}</span>
              </p>
              <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 21 }}>
                {p.happened > 1 ? `${p.happened.toLocaleString()} times since ${when(p.since)}` : `since ${when(p.since)}`}
                {" · last "}{ago(p.ago_s)}
                {p.detail && ` · ${p.detail}`}
              </p>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          {/* Cameras, each question answered separately. */}
          <div className="px-5 py-3">
            <p className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <Camera size={11} /> Cameras
            </p>
          </div>
          {h.cameras.map((c) => (
            <div key={c.camera_id} className="px-5 py-2.5" style={{ borderTop: `1px solid ${BORDER}` }}>
              <p className="flex items-center gap-2" style={{ fontSize: 13 }}>
                {c.ok ? <CheckCircle2 size={13} style={{ color: GOOD }} /> : <XCircle size={13} style={{ color: BAD }} />}
                <strong style={{ color: "var(--text-primary)" }}>{c.name}</strong>
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                  {c.where === "entrance" ? "on the entrance" : "on a room"}
                  {c.picture_size && ` · ${c.picture_size}`}
                  {c.fps > 0 && ` · ${c.fps} counts a second`}
                </span>
              </p>
              {!c.ok && c.worst && (
                <p style={{ fontSize: 12, color: BAD, marginLeft: 21, marginTop: 2 }}>{c.worst}</p>
              )}
              <ul className="flex flex-wrap gap-x-4 gap-y-0.5" style={{ marginLeft: 21, marginTop: 3 }}>
                {c.checks.map((k) => (
                  <li key={k.name} style={{ fontSize: 11, color: k.ok ? "var(--text-faint)" : BAD }}>
                    {k.ok ? "✓" : "✗"} {k.name}
                    <span style={{ color: "var(--text-faint)" }}> — {k.says}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Counting. */}
          <div className="px-5 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
            <p className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <Users size={11} /> Counting
            </p>
            <ul style={{ marginTop: 6 }}>
              <li style={{ fontSize: 12, color: h.counting.attendance_is_from_register ? "var(--text-secondary)" : WARN }}>
                {h.counting.attendance_is_from_register
                  ? `✓ Attendance is the register of people — ${h.counting.people_in_register.toLocaleString()} different people this service`
                  : "⚠ No register yet, so attendance is each camera's own count — which counts the same people repeatedly and reads too high"}
              </li>
              <li style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {h.counting.building_seats > 0
                  ? `✓ ${h.counting.building_seats.toLocaleString()} seats found in the building`
                  : "· No seats found yet"}
              </li>
              <li style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {h.service ? `✓ Recording “${h.service.name}” since ${when(h.service.since)}` : "· No service being recorded"}
              </li>
            </ul>
          </div>

          {fixed.length > 0 && (
            <div className="px-5 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Fixed, but worth knowing about
              </p>
              <ul style={{ marginTop: 4 }}>
                {fixed.map((p, i) => (
                  <li key={`${p.where}-f-${i}`} style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                    <strong>{p.where}</strong> — {p.what} · {p.happened.toLocaleString()}×, {when(p.since)} to {when(p.last)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="px-5 py-2.5" style={{ fontSize: 11, color: "var(--text-faint)", borderTop: `1px solid ${BORDER}` }}>
            Checked {when(h.checked_at)} · live-cameras code {h.code} · a problem here stays until the thing that failed works again
          </p>
        </div>
      )}
    </div>
  );
}
