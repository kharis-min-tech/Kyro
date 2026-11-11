"use client";

/**
 * Who came in, and whether they have gone out again.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * "make sure when people come in you log them in case they come out."
 *
 * The register already knew when somebody was first seen and when they were
 * last seen — and those are not the same thing. Somebody who comes in at ten,
 * steps out at half past and comes back at twenty to eleven has their
 * last-seen time moved forward, and the fact that they LEFT disappears. Right
 * for the attendance figure, which must not count them twice. Useless for the
 * question a church actually asks at the end of a service, which is whether
 * the building is clear.
 *
 * So every visit is kept with an end, and the ones with no end yet are the
 * people still inside.
 *
 * ── Who these people are ───────────────────────────────────────────────────
 *
 * Nobody. A person here is a NUMBER, for one service, and it goes when the
 * service does. Kyro has no names, no photographs and no way to recognise
 * anybody from one Sunday to the next — and this is the one screen where
 * somebody might reasonably assume otherwise, so it says so.
 */

import { useCallback, useEffect, useState } from "react";
import { DoorOpen, LogIn, LogOut } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";

const BORDER = "var(--border-subtle)";

interface Visit { person: number; in: string; out: string | null }
interface Log {
  service: string | null;
  service_name?: string;
  inside: number;
  people: number;
  visits: Visit[];
}

const at = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
};
/** "1 h 12 min", for how long somebody has been in. */
const forHowLong = (from: string, to: string | null) => {
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from);
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function ComingsAndGoings() {
  const [log, setLog] = useState<Log | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    edgeFetch<Log>("/api/live/visits").then(setLog).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => clearInterval(t);
  }, [load]);

  // No service, nothing counted: nothing to show, and no panel saying so.
  if (!log?.service || !log.visits.length) return null;
  const inside = log.visits.filter((v) => v.out === null);
  const shown = open ? log.visits : log.visits.slice(0, 8);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: `1px solid ${BORDER}` }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <DoorOpen size={14} /> Comings and goings
          </p>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
            <strong>{inside.length}</strong> still inside · {log.people} different{" "}
            {log.people === 1 ? "person" : "people"} · {log.visits.length}{" "}
            {log.visits.length === 1 ? "visit" : "visits"}
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{open ? "Hide" : "Show"}</span>
      </button>

      <ul style={{ borderTop: `1px solid ${BORDER}` }}>
        {shown.map((v, i) => (
          <li key={`${v.person}-${v.in}`} className="px-5 py-2.5 flex items-center gap-3"
            style={{ borderTop: i ? `1px solid ${BORDER}` : undefined }}>
            {v.out === null
              ? <LogIn size={13} className="shrink-0" style={{ color: "#4ade80" }} />
              : <LogOut size={13} className="shrink-0" style={{ color: "var(--text-faint)" }} />}
            <span className="tabular-nums shrink-0" style={{ fontSize: 12, color: "var(--text-muted)", width: "4.5rem" }}>
              Person {v.person}
            </span>
            <span className="flex-1 min-w-0 tabular-nums" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              in {at(v.in)}
              {v.out ? <> · out {at(v.out)}</> : <> · still here</>}
            </span>
            <span className="tabular-nums shrink-0" style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {forHowLong(v.in, v.out)}
            </span>
          </li>
        ))}
      </ul>

      {log.visits.length > shown.length && (
        <button onClick={() => setOpen(true)} className="w-full px-5 py-2 text-left"
          style={{ fontSize: 12, color: "var(--text-tertiary)", borderTop: `1px solid ${BORDER}` }}>
          Show all {log.visits.length}
        </button>
      )}

      {open && (
        <p className="px-5 py-3" style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5, borderTop: `1px solid ${BORDER}` }}>
          A person here is a number, for this service only, and it goes when the service ends. Kyro has no names and
          no photographs, and cannot recognise anybody from one Sunday to the next. Somebody is recorded as having
          left once no camera has seen them for five minutes — and the time shown is when they were last seen, not
          when Kyro became sure of it.
        </p>
      )}
    </div>
  );
}
