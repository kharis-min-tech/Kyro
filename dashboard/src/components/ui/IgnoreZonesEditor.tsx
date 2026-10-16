"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { edgeVenueApi, useEdgeSnapshot, type Zone } from "@/lib/edgeVenue";

/**
 * "Don't count this area": an administrator drags a box over something on the
 * camera's picture that the AI mistakes for a person (a statue, a mannequin, a
 * life-size poster). Anything lying mostly inside the box isn't counted, by the
 * Camera Box or Camera Mode; someone walking in front of it only partly
 * overlaps, so they still count.
 */
export function IgnoreZonesEditor({ cameraId, initial, onClose, onSaved }: {
  cameraId: string; initial: Zone[]; onClose: () => void; onSaved: () => void;
}) {
  const snap = useEdgeSnapshot(cameraId, true, 20_000);
  const [zones, setZones] = useState<Zone[]>(initial);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The box matches the camera picture's own shape, so areas line up with what the camera sees.
  const [ratio, setRatio] = useState(16 / 9);
  const box = useRef<HTMLDivElement>(null);

  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: React.PointerEvent) => { const p = at(e); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y }); };
  const move = (e: React.PointerEvent) => { if (drag) { const p = at(e); setDrag({ ...drag, x2: p.x, y2: p.y }); } };
  const up = () => {
    if (!drag) return;
    const z: Zone = [Math.min(drag.x, drag.x2), Math.min(drag.y, drag.y2), Math.max(drag.x, drag.x2), Math.max(drag.y, drag.y2)];
    if (z[2] - z[0] > 0.01 && z[3] - z[1] > 0.01 && zones.length < 10) setZones([...zones, z]);
    setDrag(null);
  };
  const save = async () => {
    setSaving(true); setErr(null);
    try { await edgeVenueApi.updateCamera(cameraId, { ignore_zones: zones }); onSaved(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    setSaving(false);
  };
  const pct = (v: number) => `${v * 100}%`;
  const shown: Zone[] = drag ? [...zones, [Math.min(drag.x, drag.x2), Math.min(drag.y, drag.y2), Math.max(drag.x, drag.x2), Math.max(drag.y, drag.y2)]] : zones;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" style={{ background: "rgba(0,0,0,0.7)" }} role="dialog" aria-label="Don't count an area">
      <div className="w-full max-w-3xl rounded-2xl p-4 sm:p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }}>
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1">
            <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Don&apos;t count an area</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Drag a box over a statue, mannequin or anything else Kyro mistakes for a person. Nothing mostly inside the box is
              counted. Draw it tightly: a person standing inside the box wouldn&apos;t be counted either.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: "var(--text-faint)" }}><X size={18} /></button>
        </div>

        <div ref={box} className="relative rounded-lg overflow-hidden select-none touch-none cursor-crosshair"
          style={{ aspectRatio: String(ratio), width: `min(100%, calc(65vh * ${ratio}))`, margin: "0 auto", background: "#0f1222" }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          {snap.url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={snap.url} alt="" className="absolute inset-0 w-full h-full pointer-events-none" draggable={false}
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight); }} />
            : <span className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Waiting for the camera&apos;s picture…</span>}
          {shown.map(([x1, y1, x2, y2], i) => (
            <div key={i} className="absolute pointer-events-none"
              style={{ left: pct(x1), top: pct(y1), width: pct(x2 - x1), height: pct(y2 - y1),
                background: "rgba(148,163,184,0.3)", border: "2px dashed #e2e8f0" }}>
              <span className="absolute top-0 left-0 px-1.5 text-xs font-semibold text-white keep-white" style={{ background: "rgba(15,18,34,0.8)" }}>
                Not counted {i + 1}
              </span>
            </div>
          ))}
        </div>

        {zones.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {zones.map((_, i) => (
              <button key={i} onClick={() => setZones(zones.filter((__, k) => k !== i))}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                <Trash2 size={12} /> Remove area {i + 1}
              </button>
            ))}
          </div>
        )}
        {err && <p className="text-xs mt-2" style={{ color: "var(--danger-text)" }}>{err}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
