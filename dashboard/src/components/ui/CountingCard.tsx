"use client";

import { AlertTriangle, Loader2, Play, Square, Users } from "lucide-react";
import { useCounting } from "@/lib/CountingContext";

/**
 * "Counting: on" for the Cameras page.
 *
 * Counting now runs for the whole of Kyro (CountingContext), so this is just a
 * switch and a status — move to AI Count, the Seat Map or anywhere else and it
 * keeps going. Only closing the Kyro tab stops it.
 */
export function CountingCard() {
  const c = useCounting();
  if (!c || !c.allowed) return null;

  const { phase, step, progress, error, sendError, lastSent, engineInfo, needsPermission, views, total, secondsPerCount, start, stop, demo } = c;
  const on = phase === "running";
  const busy = phase === "starting";
  const live = views.filter((v) => v.streaming);
  const slow = secondsPerCount > 4;

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Counting on this computer</p>
      <div className="rounded-xl p-4 flex flex-col gap-3"
        style={{ background: "var(--bg-card)", border: `1px solid ${on ? "rgba(34,197,94,0.4)" : "var(--border-subtle)"}` }}>

        <div className="flex items-start gap-3">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${on ? "animate-pulse" : ""}`}
            style={{ background: on ? "#22c55e" : "#6b7280" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {on ? "Counting" : busy ? "Starting…" : needsPermission ? "One tap to allow the camera" : "Waiting for a camera"}
            </p>
            {on && (
              <p className="text-2xl font-bold tabular-nums mt-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <Users size={20} /> {total}
                <span className="text-sm font-normal" style={{ color: "var(--text-secondary)" }}>
                  {total === 1 ? "person now" : "people now"}
                </span>
              </p>
            )}
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {on
                ? "You can move around Kyro freely — counting carries on. It only stops if you close this Kyro tab."
                : needsPermission
                ? "Your browser hasn't let Kyro use the camera yet. That first tap is the browser's rule — after it, counting starts by itself whenever a camera is plugged in."
                : "Plug your camera into this computer — straight in, or a wireless transmitter's receiver through a capture card. Counting starts by itself."}
            </p>
            {busy && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{step} {progress > 0 ? `${progress}%` : ""}</p>}
          </div>
          <button onClick={() => (on ? stop() : start())} disabled={busy}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
            style={on
              ? { background: "var(--bg-hover)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" }
              : { background: "#4f46e5", color: "#fff" }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : on ? <Square size={13} /> : <Play size={14} />}
            {busy ? "Starting" : on ? "Stop" : needsPermission ? "Allow and start" : "Start counting"}
          </button>
        </div>

        {on && !demo && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
            Counting in a browser sends <strong>the number of people</strong>. AI questions, seat-by-seat colours, in/out and
            face matching are worked out by the installed counter, so they stay empty in this mode.
          </p>
        )}

        {on && demo && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)" }}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: "#fbbf24" }} />
            <p className="text-xs leading-relaxed" style={{ color: "#fbbf24" }}>
              <strong>These counts are NOT being saved.</strong> You&apos;re in Demo mode, so the number stays on this computer and
              never reaches your Analytics or calendar. Sign out and sign in again choosing <strong>Live</strong> to record it.
            </p>
          </div>
        )}

        {on && !demo && sendError && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)" }}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: "#f87171" }} />
            <p className="text-xs leading-relaxed" style={{ color: "#fca5a5" }}>
              <strong>These counts are not reaching Kyro.</strong> {sendError}. Kyro keeps trying, but nothing is being saved
              until this clears.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.08)" }}>
            <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          </div>
        )}

        {on && live.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {live.map((v) => (
              <div key={v.key} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1" style={{ color: "var(--text-secondary)" }}>{v.label}</span>
                {v.error
                  ? <span className="text-amber-400 shrink-0">{v.error}</span>
                  : <span className="tabular-nums shrink-0" style={{ color: "var(--text-primary)" }}>{v.count} {v.count === 1 ? "person" : "people"}</span>}
              </div>
            ))}
          </div>
        )}

        {on && (
          <div className="flex flex-col gap-0.5">
            {secondsPerCount > 0 && (
              <p className="text-xs" style={{ color: slow ? "#f59e0b" : "var(--text-faint)" }}>
                A new count about every {secondsPerCount < 1 ? "second" : `${secondsPerCount.toFixed(1)} seconds`}
                {slow ? " — slow for this computer, so the number will lag behind the room" : ""}
              </p>
            )}
            {engineInfo && <p className="text-xs" style={{ color: "var(--text-faint)" }}>{engineInfo}</p>}
            <p className="text-xs" style={{ color: sendError ? "#f59e0b" : "var(--text-faint)" }}>
              {demo ? "Demo mode: the count stays on this computer."
                : sendError ? `Not sending: ${sendError} — retrying`
                : lastSent ? `Sent to Kyro ${Math.max(0, Math.round((Date.now() - lastSent) / 1000))} s ago`
                : "Connecting to Kyro…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
