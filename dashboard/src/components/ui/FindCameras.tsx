"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Loader2, Radar, Wifi, X } from "lucide-react";
import { edgeVenueApi, type FoundCamera, type FoundCameras } from "@/lib/edgeVenue";

/**
 * "Find cameras": the camera computer at church looks for Wi-Fi / network
 * cameras on its own network (only when this button is pressed), and each one
 * it finds can be added with the camera's own username and password.
 */
export function FindCameras({ onAdded, multipleComputers }: { onAdded: () => void; multipleComputers: boolean }) {
  const [state, setState] = useState<FoundCameras | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<FoundCamera | null>(null);
  const startedAt = useRef(0);

  // While the camera computer is looking, check every 2 s.
  useEffect(() => {
    if (!state?.searching) return;
    const t = setInterval(async () => {
      try {
        const s = await edgeVenueApi.foundCameras();
        // Give up waiting if the camera computer never answers.
        if (s.searching && Date.now() - startedAt.current > 45_000) {
          setErr("The camera computer didn't answer. Check it's switched on and connected, then try again.");
          setState({ ...s, searching: false });
        } else setState(s);
      } catch { /* try again next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [state?.searching]);

  async function find() {
    setStarting(true); setErr(null);
    try {
      await edgeVenueApi.findCameras();
      startedAt.current = Date.now();
      setState({ searching: true, searched: true, results: [] });
    } catch (e: any) { setErr(e?.message ?? "Couldn't start looking for cameras"); }
    finally { setStarting(false); }
  }

  const searching = starting || !!state?.searching;
  const results = state?.results ?? [];

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Wi-Fi cameras</p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-xs text-gray-400 leading-relaxed flex-1">
            Looks for security cameras on the same Wi-Fi as the camera computer at church. Kyro only looks when you press the
            button, and no passwords are tried.
          </p>
          <button onClick={find} disabled={searching}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 shrink-0">
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
            {searching ? "Looking…" : state?.searched ? "Look again" : "Find cameras"}
          </button>
        </div>

        {err && <p className="text-xs text-amber-400">{err}</p>}

        {state?.searched && !searching && !err && results.length === 0 && (
          <p className="text-xs text-gray-400 leading-relaxed">
            No cameras answered. Check the camera is switched on and joined to the <strong>same Wi-Fi</strong> as the camera computer, and that
            <strong> ONVIF</strong> is switched on in the camera&apos;s own app (Tapo: Advanced settings → Camera account; Reolink: on by default).
            Then press Look again.
          </p>
        )}

        {results.length > 0 && (
          <div className="flex flex-col gap-2">
            {results.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: "var(--bg-hover)" }}>
                <Wifi size={15} className="text-indigo-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{c.name || c.model || "Camera"}{c.model && c.name && c.model !== c.name ? ` · ${c.model}` : ""}</p>
                  <p className="text-xs text-gray-500 truncate">{c.ip}{multipleComputers && c.device_name ? ` · seen by ${c.device_name}` : ""}</p>
                </div>
                {c.added
                  ? <span className="flex items-center gap-1 text-xs text-green-400 shrink-0"><Check size={13} /> On Kyro</span>
                  : <button onClick={() => setAdding(c)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 shrink-0">Add</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <AddFoundCamera camera={adding} onClose={() => setAdding(null)}
          onAdded={async () => { setAdding(null); onAdded(); try { setState(await edgeVenueApi.foundCameras()); } catch { /* fine */ } }} />
      )}
    </div>
  );
}

function AddFoundCamera({ camera, onClose, onAdded }: { camera: FoundCamera; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState(camera.name || "");
  const [cap, setCap] = useState("");
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { job_id } = await edgeVenueApi.addFound({ id: camera.id, username: username.trim(), password, name: name.trim(), zone_capacity: parseInt(cap, 10) || 0 });
      // The camera computer asks the camera for its video and checks the picture (up to ~30 s).
      const until = Date.now() + 90_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await edgeVenueApi.addFoundStatus(job_id);
        if (s.done) {
          if (s.ok) { onAdded(); return; }
          setErr(s.error || "Couldn't add that camera"); setBusy(false); return;
        }
      }
      setErr("The camera computer didn't answer in time. Check it's switched on, then try again.");
    } catch (e: any) { setErr(e?.message ?? "Couldn't add that camera"); }
    setBusy(false);
  }

  const input = "bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-0";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.7)" }} role="dialog" aria-label="Add this camera">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)" }}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Add this camera?</p>
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>{camera.name || camera.model || "Camera"} · {camera.ip}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: "var(--text-faint)" }}><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-400">Name on Kyro
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Balcony" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-400">Seats it covers (optional)
            <input value={cap} onChange={(e) => setCap(e.target.value)} type="number" min="0" placeholder="e.g. 250" className={input} />
          </label>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          The camera&apos;s own login — set in the camera&apos;s app (Tapo: Camera account; Reolink: the camera&apos;s admin login).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-400">Camera username
            <input value={username} onChange={(e) => setUser(e.target.value)} required autoComplete="off" spellCheck={false} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-400">Camera password
            <input value={password} onChange={(e) => setPass(e.target.value)} type="password" autoComplete="new-password" className={input} />
          </label>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        {busy && <p className="text-xs text-gray-400">Connecting to the camera and checking its picture — this can take up to half a minute…</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {busy ? "Adding…" : "Yes, add it"}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
