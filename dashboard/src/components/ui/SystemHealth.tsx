"use client";

/**
 * Is Kyro working?
 *
 * One rule: a green light here means the checks behind it passed. Not that
 * nothing has complained, not that the connection is up — that every question
 * Kyro knows how to ask about that component was asked and answered.
 *
 * And the opposite rule: a problem stays on this page until the thing that
 * failed works again. If it was failing for twenty minutes this morning it
 * says so afterwards, because a problem that quietly disappears is how nobody
 * finds out why the figures looked odd.
 *
 * With one way out, added because the rule had no answer for the commonest
 * case there is. A camera that misbehaved and was then unplugged can never
 * report itself working again — so four red lines about a camera in a drawer
 * stayed here for ever, and the person reading them started clicking the red
 * ✗ icons hoping one of them was a button. They were decoration. Now an
 * administrator can **put a problem aside**, which marks it fixed rather than
 * deleting it: it keeps its times and its count down in "Fixed, but worth
 * knowing about", and the next time it happens it comes straight back to the
 * top. Nothing that is still going on can be hidden.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Camera, Users, Trash2 } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";
import { edgeVenueApi } from "@/lib/edgeVenue";
import { useAuth } from "@/hooks/useAuth";

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
  aside_by?: string | null;
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

/** A length of time somebody can read. "9 days 3 h", never "791909s". */
const ago = (s: number) => {
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m} min ${rs}s ago` : `${m} min ago`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 48) return rm ? `${h} h ${rm} min ago` : `${h} h ago`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} days ${rh} h ago` : `${d} days ago`;
};
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

/** The build these page files came from — see NewVersion.tsx. */
const BUILD = process.env.NEXT_PUBLIC_KYRO_BUILD ?? "";

export function SystemHealth() {
  const { role } = useAuth();
  const admin = role === "admin";
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /**
   * Which camera is being asked about before it is removed.
   *
   * Asked here in the page rather than in one of the browser's own boxes —
   * those appear for reloads too, cannot say what is about to happen, and
   * teach people to click through warnings without reading them.
   */
  const [removing, setRemoving] = useState<CamHealth | null>(null);
  /** Asked before clearing out every camera that has stopped reporting. */
  const [tidying, setTidying] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A problem being put aside, so its own button can say so. */
  const [asiding, setAsiding] = useState<string | null>(null);

  const load = useCallback(() => edgeFetch<Health>("/api/live/health")
    .then((r) => { setH(r); setErr(null); })
    .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't reach Kyro to ask")), []);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 15_000); return () => clearInterval(t); }, [load]);

  const putAside = useCallback(async (body: { where?: string; what?: string; all?: boolean }, tag: string) => {
    setAsiding(tag); setErr(null);
    try {
      await edgeFetch("/api/live/health/aside", { method: "POST", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't put that aside");
    }
    setAsiding(null);
  }, [load]);

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
  /** Cameras that have stopped reporting altogether — the ones worth clearing. */
  const gone = h.cameras.filter((c) => c.state === "not reporting");
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
          {/**
            * Which version of Kyro this page is actually running.
            *
            * An open page keeps its own files for days, by design, so it can
            * be running code from before a fix and look perfectly healthy
            * doing it. That happened five times in one evening, and the only
            * way to find out was for me to fetch the live files and compare
            * them by hand. Printed here, anybody can read it off the screen
            * and say which version they are looking at.
            */}
          {BUILD && (
            <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>
              This page is running {BUILD}
            </p>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{open ? "Hide" : "Show"}</span>
      </button>

      {/* Live problems are shown whether or not the panel is open. A failure
          you have to go looking for is a failure nobody finds. */}
      {live.length > 0 && (
        <ul style={{ borderTop: `1px solid ${BORDER}` }}>
          {live.map((p, i) => (
            <li key={`${p.where}-${i}`} className="px-5 py-3" style={{ borderTop: i ? `1px solid ${BORDER}` : undefined, background: "rgba(239,68,68,0.06)" }}>
              <div className="flex items-start gap-2">
                {/* Not a button, and no longer sitting where a button goes.
                    This icon was clicked over and over by somebody trying to
                    get rid of the line it sits next to. The button is on the
                    right, and says what it does. */}
                <XCircle size={13} aria-hidden style={{ color: BAD, flexShrink: 0, marginTop: 3 }} />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 13, color: "var(--text-primary)" }}>
                    <strong>{p.where}</strong> — {p.what}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {p.happened > 1 ? `${p.happened.toLocaleString()} times since ${when(p.since)}` : `since ${when(p.since)}`}
                    {" · last "}{ago(p.ago_s)}
                    {p.detail && ` · ${p.detail}`}
                  </p>
                </div>
                {admin && (
                  <button onClick={() => putAside({ where: p.where, what: p.what }, `${p.where}-${i}`)}
                    disabled={!!asiding}
                    title="Mark this as dealt with. It stays in the record below, and comes back if it happens again."
                    className="shrink-0 px-2 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
                    style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
                    {asiding === `${p.where}-${i}` ? "Putting aside…" : "Put aside"}
                  </button>
                )}
              </div>
            </li>
          ))}
          {admin && (
            <li className="px-5 py-2.5 flex flex-wrap items-center gap-2" style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(239,68,68,0.06)" }}>
              {live.length > 1 && (
                <button onClick={() => putAside({ all: true }, "all")} disabled={!!asiding}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
                  style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
                  {asiding === "all" ? "Putting aside…" : `Put all ${live.length} aside`}
                </button>
              )}
              <span style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                Putting one aside doesn&apos;t delete it — it moves down to <strong>Fixed, but worth knowing
                about</strong>, and comes straight back up here if it happens again. Use it for a camera you&apos;ve
                unplugged or switched off: it can&apos;t tell Kyro it&apos;s working again, because it isn&apos;t there.
              </span>
            </li>
          )}
        </ul>
      )}

      {open && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          {/* Cameras, each question answered separately. */}
          <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <Camera size={11} /> Cameras
            </p>
            {/* Old cameras pile up: a browser that registered again, a webcam
                tried once, a test. Each one is a row of red saying something
                true and useless. Clearing them out one at a time is a chore,
                so there is one button for the lot — and it only ever offers
                the ones that have stopped reporting. */}
            {admin && gone.length > 1 && (
              <button onClick={() => { setTidying(true); setErr(null); }} disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
                style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
                <Trash2 size={11} /> Remove the {gone.length} that have gone
              </button>
            )}
          </div>

          {tidying && (
            <div className="px-5 py-4 flex flex-col gap-2"
              style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(239,68,68,0.07)" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                Remove {gone.length} cameras that have stopped reporting?
              </p>
              <ul style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {gone.map((c) => (
                  <li key={c.camera_id}>• {c.name} — {c.last_seen ? `last heard from ${ago(Math.round((Date.now() - Date.parse(c.last_seen)) / 1000))}` : "has never reported"}</li>
                ))}
              </ul>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                Their names, rooms, seats and settings go. <strong>The counts they recorded stay.</strong> Any that are
                still plugged in somewhere will come back as new cameras for you to add.
              </p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy}
                  onClick={async () => {
                    setBusy(true); setErr(null);
                    // One at a time, and stop at the first failure rather than
                    // carrying on and reporting a tidy-up that half happened.
                    for (const c of gone) {
                      try {
                        await edgeVenueApi.removeCamera(c.camera_id, true);
                      } catch (e) {
                        setErr(`Removed what it could, then stopped at ${c.name}: ${e instanceof Error ? e.message : e}`);
                        break;
                      }
                    }
                    setTidying(false);
                    await load();
                    setBusy(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#b91c1c" }}>
                  {busy ? "Removing…" : `Yes, remove all ${gone.length}`}
                </button>
                <button onClick={() => setTidying(false)} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
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
                <span className="flex-1" />
                {admin && (
                  <button onClick={() => { setRemoving(c); setErr(null); }} disabled={busy}
                    title={`Remove ${c.name} from Kyro`} aria-label={`Remove ${c.name}`}
                    className="shrink-0 rounded-lg p-1 disabled:opacity-40"
                    style={{ color: "var(--text-faint)" }}>
                    <Trash2 size={13} />
                  </button>
                )}
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

          {/* Asked before anything is removed, and said in terms of what is
              about to happen rather than "are you sure?". */}
          {removing && (
            <div className="px-5 py-4 flex flex-col gap-2"
              style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(239,68,68,0.07)" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                Remove “{removing.name}” from Kyro?
              </p>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                Its name, its room, its seats and its settings go. <strong>The counts it has already
                recorded stay</strong> — Analytics and the day&apos;s figures are not touched.
                {" "}If this camera is still plugged in somewhere, it comes back as a new camera and Kyro asks whether to
                add it, so removing one that is still running is not permanent — removing one that has gone, is.
              </p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy}
                  onClick={async () => {
                    setBusy(true); setErr(null);
                    try {
                      await edgeVenueApi.removeCamera(removing.camera_id, true);
                      setRemoving(null);
                      await load();
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : "Couldn't remove that camera");
                    }
                    setBusy(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#b91c1c" }}>
                  {busy ? "Removing…" : "Yes, remove it"}
                </button>
                <button onClick={() => setRemoving(null)} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

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
                    {p.aside_by && ` · put aside by ${p.aside_by}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="px-5 py-2.5" style={{ fontSize: 11, color: "var(--text-faint)", borderTop: `1px solid ${BORDER}` }}>
            Checked {when(h.checked_at)} · live-cameras code {h.code} · a problem here stays until the thing that failed
            works again, or an administrator puts it aside
          </p>
        </div>
      )}
    </div>
  );
}
