"use client";

/**
 * Seat management: where an administrator corrects what Kyro worked out.
 *
 * Kyro finds the seats by itself and gets some of them wrong — a coat over a
 * chair back, a chair that has since been moved, the same chair seen by two
 * cameras. Until now there was nowhere to say so, which made every mistake
 * permanent and left the seat map quietly untrustworthy.
 *
 * Three rules this page keeps to:
 *
 *   - Nothing is destroyed. Rejecting or removing a seat marks it, keeps its
 *     id for ever so it can never be handed to a different chair, and can be
 *     undone.
 *   - Nothing is guessed. Duplicate chairs are PROPOSED, with the evidence
 *     that produced them, and merged only when somebody says so.
 *   - Everything is attributable. Every change records who made it and when,
 *     and the history is on the page rather than in a log file.
 */

import { useCallback, useEffect, useState } from "react";
import { Armchair, Check, X, Undo2, Merge, Split, Trash2, RotateCcw, Plus, History, AlertTriangle } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";
import { useAuth } from "@/hooks/useAuth";

const BORDER = "var(--border-subtle)";

interface Proposal {
  keep: string; drop: string; views: string[];
  agreements: number; disagreements: number; confidence: number;
}
interface MasterSeat {
  id: string; section: string; kind: string; places: number; row: string; number: number;
  confirmed: boolean; cameras: string[]; place: { x: number; y: number } | null; by: string;
}
interface Overview {
  version: number;
  stage_of: Record<string, string>;
  total: number; places: number; seen_by_more_than_one_camera: number;
  unconfirmed: number; rejected: number; removed: number; merged: number;
  proposals: Proposal[];
  seats: MasterSeat[];
  history: { at: string; by: string; what: string }[];
}

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

export function SeatManager({ cameras }: { cameras: { camera_id: string; name: string; location?: string | null }[] }) {
  const { role } = useAuth();
  const admin = role === "admin";
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState<{ what: string; run: () => void } | null>(null);

  const load = useCallback(() => edgeFetch<Overview>("/api/live/building")
    .then((r) => { setD(r); setErr(null); })
    .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the seating")), []);
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    if (!d) return;
    setBusy(true); setErr(null);
    try {
      const r = await edgeFetch<Overview & { error?: string }>("/api/live/building", {
        method: "POST", body: JSON.stringify({ ...body, version: d.version }),
      });
      if (r.error) setErr(r.error); else setD(r);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make that change"); }
    setBusy(false);
  };
  /** Destructive things ask first. */
  const ask = (what: string, body: Record<string, unknown>) =>
    setConfirming({ what, run: () => { setConfirming(null); act(body); } });

  if (!d) return null;
  const roomCameras = cameras.filter((c) => c.location !== "entrance" && c.location !== "queue");

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: `1px solid ${BORDER}` }}>
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <Armchair size={14} /> Seat management
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {d.total.toLocaleString()} seats{d.places !== d.total ? ` · ${d.places.toLocaleString()} places` : ""}
            {d.seen_by_more_than_one_camera > 0 && ` · ${d.seen_by_more_than_one_camera} seen by more than one camera`}
            {d.unconfirmed > 0 && ` · ${d.unconfirmed} not yet confirmed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {admin && (
            <button onClick={() => act({ do: "undo" })} disabled={busy || !d.history.length}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
              style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
              <Undo2 size={12} /> Undo last change
            </button>
          )}
          <button onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
            style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-tertiary)" }}>
            <History size={12} /> {showHistory ? "Hide history" : "History"}
          </button>
        </div>
      </div>

      {err && (
        <p className="px-5 py-2.5 flex items-start gap-2" style={{ fontSize: 12, color: "#b45309", background: "rgba(245,158,11,0.08)" }}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {err}
        </p>
      )}

      {!admin && (
        <p className="px-5 py-3" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          You can see the seating here. Changing it is for administrators.
        </p>
      )}

      {/* Where the stage is, per camera. Row A is the row nearest it, and
          Kyro has no way of knowing which way that is without being told. */}
      {admin && roomCameras.length > 0 && (
        <div className="px-5 py-4 flex flex-col gap-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>Where is the stage?</p>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            Row A is the row nearest the stage. Kyro cannot tell which end that is from the picture, and guessing
            wrongly makes row A the back row.
          </p>
          {roomCameras.map((c) => (
            <div key={c.camera_id} className="flex flex-wrap items-center gap-2">
              <span style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 140 }}>{c.name}</span>
              <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}` }}>
                {(["top", "bottom", "left", "right"] as const).map((w) => (
                  <button key={w} onClick={() => act({ do: "stage", camera: c.camera_id, where: w })} disabled={busy}
                    aria-pressed={(d.stage_of[c.camera_id] ?? "top") === w}
                    className="px-2.5 py-1 rounded-md text-xs font-medium"
                    style={(d.stage_of[c.camera_id] ?? "top") === w
                      ? { background: "#4f46e5", color: "#fff" } : { color: "var(--text-muted)" }}>
                    {w === "top" ? "Top of picture" : w === "bottom" ? "Bottom" : w === "left" ? "Left" : "Right"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Duplicates, with the evidence that produced them. */}
      {d.proposals.length > 0 && (
        <div className="px-5 py-4 flex flex-col gap-2" style={{ borderBottom: `1px solid ${BORDER}`, background: "rgba(79,70,229,0.05)" }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
            Possibly the same chair, seen by two cameras
          </p>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
            Kyro noticed the same person in both of these at the same moment, more than once. Nobody is in two places
            at once, so they are probably one chair — but two chairs side by side can look identical, so this is for
            you to decide, not for Kyro.
          </p>
          {d.proposals.slice(0, 12).map((p) => (
            <div key={`${p.keep}-${p.drop}`} className="flex flex-wrap items-center gap-2 py-1.5" style={{ borderTop: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                <strong>{p.keep}</strong> and <strong>{p.drop}</strong>
              </span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                same person in both {p.agreements} times{p.disagreements ? `, different ${p.disagreements}` : ""}
              </span>
              <span className="flex-1" />
              {admin && (
                <button onClick={() => act({ do: "merge", seat: p.keep, other: p.drop })} disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: "#4f46e5" }}>
                  <Merge size={12} /> One chair
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Every seat. */}
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-inset)", color: "var(--text-muted)", fontSize: 11 }}>
              <th className="text-left font-medium px-5 py-2">Seat</th>
              <th className="text-left font-medium px-3 py-2">Where</th>
              <th className="text-left font-medium px-3 py-2">Cameras</th>
              {admin && <th className="text-right font-medium px-5 py-2">Correct it</th>}
            </tr>
          </thead>
          <tbody>
            {d.seats.map((s) => (
              <tr key={s.id} style={{ borderTop: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
                <td className="px-5 py-1.5">
                  <strong style={{ color: "var(--text-primary)" }}>{s.row}{s.number || ""}</strong>
                  <span style={{ color: "var(--text-faint)", fontSize: 11 }}> · {s.id}</span>
                  {!s.confirmed && <span style={{ color: "#b45309", fontSize: 11 }}> · not confirmed</span>}
                  {s.places > 1 && <span style={{ color: "var(--text-faint)", fontSize: 11 }}> · {s.places} places</span>}
                </td>
                <td className="px-3 py-1.5" style={{ fontSize: 12 }}>{s.section}</td>
                <td className="px-3 py-1.5" style={{ fontSize: 11, color: "var(--text-faint)" }}>{s.cameras.length}</td>
                {admin && (
                  <td className="px-5 py-1.5 text-right whitespace-nowrap">
                    {!s.confirmed && (
                      <button onClick={() => act({ do: "confirm", seat: s.id })} disabled={busy}
                        title="Yes, this is a seat" className="px-1.5" style={{ color: "#22c55e" }}><Check size={14} /></button>
                    )}
                    <button onClick={() => ask(`Reject ${s.row}${s.number} (${s.id})? Kyro will stop treating it as a seat. You can undo this.`,
                      { do: "reject", seat: s.id })} disabled={busy}
                      title="Not a seat at all" className="px-1.5" style={{ color: "var(--text-muted)" }}><X size={14} /></button>
                    <button onClick={() => ask(`Remove ${s.row}${s.number} (${s.id})? Use this when the chair is no longer in the building. Its id is kept and never reused, and you can restore it.`,
                      { do: "remove", seat: s.id })} disabled={busy}
                      title="This chair is gone" className="px-1.5" style={{ color: "#f87171" }}><Trash2 size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 flex flex-wrap items-center gap-3" style={{ borderTop: `1px solid ${BORDER}` }}>
        {admin && (
          <button onClick={() => act({ do: "add", section: "Main" })} disabled={busy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "var(--bg-inset)", border: `1px solid ${BORDER}`, color: "var(--text-secondary)" }}>
            <Plus size={12} /> Add a seat Kyro missed
          </button>
        )}
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          {d.removed > 0 && `${d.removed} removed · `}
          {d.rejected > 0 && `${d.rejected} rejected · `}
          {d.merged > 0 && `${d.merged} merged · `}
          nothing is ever deleted, and every id is kept for good
        </span>
        {admin && (d.removed > 0 || d.rejected > 0) && (
          <button onClick={() => act({ do: "undo" })} disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs" style={{ color: "var(--text-tertiary)" }}>
            <RotateCcw size={11} /> Undo
          </button>
        )}
      </div>

      {showHistory && (
        <ul style={{ borderTop: `1px solid ${BORDER}` }} className="max-h-64 overflow-y-auto">
          {d.history.length === 0 && <li className="px-5 py-3" style={{ fontSize: 12, color: "var(--text-faint)" }}>Nothing changed yet.</li>}
          {d.history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="px-5 py-2 flex items-center gap-3" style={{ borderTop: i ? `1px solid ${BORDER}` : undefined, fontSize: 12 }}>
              <span className="tabular-nums" style={{ color: "var(--text-faint)", fontSize: 11, minWidth: 120 }}>{when(h.at)}</span>
              <span style={{ color: "var(--text-secondary)" }}>{h.what}</span>
              <span className="flex-1" />
              <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{h.by || "—"}</span>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <div className="px-5 py-4 flex flex-col gap-2" style={{ borderTop: `1px solid ${BORDER}`, background: "rgba(185,28,28,0.07)" }}>
          <p style={{ fontSize: 12, color: "var(--text-primary)" }}>{confirming.what}</p>
          <div className="flex gap-2">
            <button onClick={confirming.run} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: "#b91c1c" }}>
              Yes, do it
            </button>
            <button onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
