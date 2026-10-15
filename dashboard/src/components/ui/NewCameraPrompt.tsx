"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, Check, X, Loader2 } from "lucide-react";
import { isEdgeLive, edgeTokenPayload } from "@/lib/edgeAuth";
import { edgeVenueApi, type EdgeCamera } from "@/lib/edgeVenue";

/**
 * Mounted once in the root layout. When a camera is plugged into a camera
 * computer, the box doesn't open it — it tells the website, and this asks an
 * administrator: "We see you've connected … Do you want it on Kyro?"
 * Yes → it starts counting and streaming. No → it stays switched off
 * (it can be switched on later on the Cameras page).
 */
export function NewCameraPrompt() {
  const pathname = usePathname();
  const [waiting, setWaiting] = useState<EdgeCamera[]>([]);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [added, setAdded] = useState<EdgeCamera | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => { setAdmin(isEdgeLive() && edgeTokenPayload()?.role === "admin"); }, [pathname]);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    const load = async () => {
      try {
        const all = await edgeVenueApi.cameras(true);
        if (alive) setWaiting(all.filter((c) => c.pending && c.present));
      } catch { /* try again next time */ }
    };
    load();
    const id = setInterval(load, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [admin]);

  if (!admin || pathname === "/" || pathname?.startsWith("/login")) return null;

  const cam = waiting[0];
  const answer = async (yes: boolean) => {
    if (!cam) return;
    setBusy(yes ? "yes" : "no"); setErr(null);
    try {
      await edgeVenueApi.updateCamera(cam.camera_id, { hidden: !yes });
      setWaiting((w) => w.filter((c) => c.camera_id !== cam.camera_id));
      if (yes) setAdded(cam);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't reach Kyro — try again");
    }
    setBusy(null);
  };

  if (!cam && !added) return null;

  return (
    <div className="fixed z-50 bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:w-96 rounded-2xl p-4 shadow-2xl"
      style={{ background: "var(--bg-card)", border: "1px solid rgba(99,102,241,0.55)" }}
      role="dialog" aria-live="polite">
      {cam ? (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(99,102,241,0.18)" }}>
              <Camera size={16} style={{ color: "#818cf8" }} />
            </span>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>New camera connected</p>
          </div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            We see you&apos;ve connected <b style={{ color: "var(--text-primary)" }}>{cam.name}</b>
            {cam.device_name ? <> to <b style={{ color: "var(--text-primary)" }}>{cam.device_name}</b></> : null}.
            Do you want it on Kyro?
          </p>
          {err && <p className="text-xs mt-2" style={{ color: "var(--danger-text)" }}>{err}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => answer(true)} disabled={!!busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
              {busy === "yes" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Yes, add it
            </button>
            <button onClick={() => answer(false)} disabled={!!busy}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
              {busy === "no" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} No
            </button>
          </div>
          {waiting.length > 1 && <p className="text-xs mt-2" style={{ color: "var(--text-faint)" }}>{waiting.length - 1} more new camera{waiting.length > 2 ? "s" : ""} after this one</p>}
        </>
      ) : added && (
        <>
          <div className="flex items-start gap-2">
            <Check size={16} className="mt-0.5 shrink-0" style={{ color: "#22c55e" }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{added.name} is on Kyro</p>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
                It starts counting in a few seconds. Give it its room and number of seats so Kyro can show seats left.
              </p>
              <Link href="/cameras" onClick={() => setAdded(null)} className="inline-block mt-2 text-sm font-semibold text-indigo-400 hover:text-indigo-300">
                Set room and seats →
              </Link>
            </div>
            <button onClick={() => setAdded(null)} aria-label="Close" style={{ color: "var(--text-faint)" }}><X size={15} /></button>
          </div>
        </>
      )}
    </div>
  );
}
