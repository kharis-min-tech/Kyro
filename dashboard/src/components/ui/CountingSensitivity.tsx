"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";

/**
 * How sure the AI must be before it counts someone.
 *
 * Lowering it counts people the AI can see but isn't certain about; raising it
 * counts only the obvious ones. Which way helps depends on the room and the
 * camera, so the page tells people to compare Kyro's number with a real count
 * rather than guess from the lighting.
 *
 * Applies to every camera: the camera computers and anything counting in a
 * browser pick it up within a couple of seconds.
 */
// Which way to go depends on the room, not on a rule of thumb: on dim test
// photos the lighter AI counted 35 where 28 people stood at Normal, and exactly
// 28 at Careful. So the honest advice is "compare with the real number".
const LEVELS = [
  { v: 0.2, name: "Sensitive", hint: "Counts people the AI is less sure about. Use when Kyro's number is LOWER than the real one." },
  { v: 0.3, name: "Normal", hint: "Kyro's tested setting. Start here." },
  { v: 0.4, name: "Careful", hint: "Only counts people the AI is sure about. Use when Kyro's number is HIGHER than the real one." },
];

export function CountingSensitivity() {
  const [value, setValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    edgeFetch<{ count_confidence: number }>("/api/live/counting")
      .then((r) => setValue(r.count_confidence))
      .catch(() => setValue(0.3));
  }, []);

  async function choose(v: number) {
    const before = value;
    setValue(v); setBusy(true); setErr(null); setSaved(false);
    try {
      const r = await edgeFetch<{ count_confidence: number }>("/api/live/counting", {
        method: "PUT", body: JSON.stringify({ count_confidence: v }),
      });
      setValue(r.count_confidence); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setValue(before ?? 0.3);
      setErr(e?.message ?? "Couldn't save that");
    }
    setBusy(false);
  }

  if (value === null) return null;

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Counting sensitivity</p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <SlidersHorizontal size={18} className="text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-400 leading-relaxed flex-1">
            How sure the AI must be before it counts someone. Count the people in the room yourself once, compare it with
            Kyro&apos;s number, then adjust: <strong>Sensitive</strong> if Kyro is counting too few, <strong>Careful</strong> if
            it&apos;s counting too many. Every camera picks this up within a couple of seconds.
          </p>
          {busy && <Loader2 size={14} className="animate-spin text-gray-500 shrink-0 mt-0.5" />}
          {saved && !busy && <span className="text-xs text-green-400 shrink-0 flex items-center gap-1"><Check size={12} /> Saved</span>}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          {LEVELS.map((l) => {
            const on = Math.abs(value - l.v) < 0.001;
            return (
              <button key={l.v} onClick={() => choose(l.v)} disabled={busy}
                className="flex-1 text-left rounded-lg px-3 py-2.5 disabled:opacity-60"
                style={{ background: on ? "rgba(99,102,241,0.15)" : "var(--bg-hover)", border: `1px solid ${on ? "#6366f1" : "transparent"}` }}>
                <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: on ? "#a5b4fc" : "var(--text-primary)" }}>
                  {on && <Check size={13} />}{l.name}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">{l.hint}</span>
              </button>
            );
          })}
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}
