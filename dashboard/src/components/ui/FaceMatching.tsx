"use client";

import { useEffect, useState } from "react";
import { Loader2, ScanFace, ShieldCheck } from "lucide-react";
import { edgeFetch } from "@/lib/edgeAuth";
import { useEdgeVenue } from "@/lib/edgeVenue";

interface Privacy {
  face_matching: boolean;
  switched_on_by?: string; switched_on_at?: string;
  switched_off_by?: string; switched_off_at?: string;
}

/**
 * Face matching across cameras: off unless an administrator switches it on,
 * after confirming the church's data protection impact assessment and the
 * notices at the entrances (recorded with their name and the time).
 */
export function FaceMatching() {
  const [p, setP] = useState<Privacy | null>(null);
  const [asking, setAsking] = useState(false);
  const [dpia, setDpia] = useState(false);
  const [notices, setNotices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { venue } = useEdgeVenue(!!p?.face_matching);
  // Face matching only actually runs while a service is being recorded (face
  // data belongs to the service and is wiped when it ends). Switched on with
  // no service running, it looked broken — "On", and nothing happening.
  const [live, setLive] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  const loadLive = () => edgeFetch<{ live: { id: string; name: string } | null }>("/api/live/services")
    .then((r) => setLive(r.live))
    .catch(() => setLive(null));

  useEffect(() => { edgeFetch<Privacy>("/api/live/privacy").then(setP).catch(() => setP({ face_matching: false })); }, []);
  useEffect(() => { loadLive(); const t = setInterval(loadLive, 15_000); return () => clearInterval(t); }, []);

  async function startService() {
    setStarting(true); setErr(null);
    try { await edgeFetch("/api/live/service/start", { method: "POST" }); await loadLive(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't start a service"); }
    setStarting(false);
  }

  async function save(on: boolean) {
    setBusy(true); setErr(null);
    try {
      setP(await edgeFetch<Privacy>("/api/live/privacy", { method: "PUT",
        body: JSON.stringify({ face_matching: on, dpia_confirmed: dpia, notices_confirmed: notices }) }));
      setAsking(false); setDpia(false); setNotices(false);
    } catch (e: any) { setErr(e?.message ?? "Couldn't save"); }
    setBusy(false);
  }

  if (!p) return null;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const twice = (venue as any)?.seen_on_two_cameras ?? 0;
  // Switched on, and actually reading faces, are two different things. The
  // face AI is a 10 MB download that runs in whichever browser is counting;
  // if it never loads, counting carries on without it and this card used to
  // sit there saying "On".
  const faceCams: number = (venue as any)?.face_cameras ?? 0;
  const facePeople: number = (venue as any)?.face_people ?? 0;
  const faceErr: string | null = (venue as any)?.face_error ?? null;
  const faceReady: boolean = (venue as any)?.face_engine_ready ?? false;

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Face matching</p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <ScanFace size={18} className={p.face_matching ? "text-green-400 shrink-0 mt-0.5" : "text-gray-500 shrink-0 mt-0.5"} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">{p.face_matching ? "On" : "Off"}</p>
            <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
              Stops the same person being counted twice: once if they step out and come back (so they aren&apos;t a new arrival),
              and once if two cameras both see them. Kyro keeps no photos of faces and doesn&apos;t know who anyone is — each face
              becomes a list of numbers. Those numbers are kept for the length of the service and deleted when it ends, so that
              Kyro can still recognise people after a restart; before, a restart lost them and people already counted were
              counted again. They are deleted when the service ends, when a different service starts, the moment face matching
              is switched off, and in any case within twelve hours — whether or not a service ever ended properly.
              Adds a 10 MB download the first time.
            </p>
            {p.face_matching && (
              <p className="text-xs text-gray-500 mt-1.5">
                Switched on by {p.switched_on_by} · {when(p.switched_on_at)} · right now {twice} {twice === 1 ? "person is" : "people are"} seen
                on two cameras and counted once
              </p>
            )}
            {!p.face_matching && p.switched_off_at && (
              <p className="text-xs text-gray-500 mt-1.5">Switched off by {p.switched_off_by} · {when(p.switched_off_at)}</p>
            )}
            {p.face_matching && live === null && (
              <div className="mt-2 rounded-lg px-3 py-2 flex flex-col gap-2"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
                <p className="text-xs leading-relaxed" style={{ color: "#fbbf24" }}>
                  <span className="font-semibold">Switched on, but not running yet.</span> Face matching only works while a
                  service is being recorded, because the face codes belong to that service and are wiped when it ends.
                  A service starts on its own once 5 people have been in the room for 2 minutes — so on your own,
                  testing, it never starts. Start one by hand to try it.
                </p>
                <button onClick={startService} disabled={starting}
                  className="self-start px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
                  style={{ background: "#4f46e5" }}>
                  {starting ? "Starting…" : "Start a service now"}
                </button>
              </div>
            )}
            {p.face_matching && live && (
              <p className="text-xs mt-1.5" style={{ color: "#22c55e" }}>Running now, during “{live.name}”</p>
            )}
            {/* Is it actually reading faces? */}
            {p.face_matching && live && (
              faceCams > 0 ? (
                <p className="text-xs mt-1" style={{ color: "#22c55e" }}>
                  Working — reading faces on {faceCams} {faceCams === 1 ? "camera" : "cameras"}, {facePeople} {facePeople === 1 ? "face" : "faces"} in the last reading.
                </p>
              ) : faceReady ? (
                /* The AI is loaded and looking at every count. It found nobody
                   this time, which is not a fault: a face has to be towards a
                   camera and big enough in the picture to read, and a room of
                   people facing the front shows the backs of their heads. */
                <p className="text-xs mt-1" style={{ color: "#22c55e" }}>
                  Working — the face AI is loaded and looking at every count. No face is clear enough to read just now:
                  someone has to be facing a camera, and close enough that their face is more than a few dozen pixels across.
                  A camera above a doorway, pointing at people as they come towards it, is what gets the most.
                </p>
              ) : (
                <div className="mt-2 rounded-lg px-3 py-2"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
                  <p className="text-xs leading-relaxed" style={{ color: "#fbbf24" }}>
                    <span className="font-semibold">On, but the face AI isn&apos;t running.</span>{" "}
                    {faceErr
                      ? faceErr
                      : `The browser doing the counting hasn't loaded it. It is a 10 MB download that happens once — if that
                         computer has just been reloaded, or has only just started counting, give it a minute. The counting
                         itself is unaffected either way.`}
                  </p>
                </div>
              )
            )}
          </div>
          {p.face_matching
            ? <button onClick={() => save(false)} disabled={busy}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gray-700 hover:bg-gray-600 disabled:opacity-50">
                {busy ? "…" : "Switch off"}
              </button>
            : !asking && <button onClick={() => setAsking(true)}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500">Switch on…</button>}
        </div>

        {/* What happens to the data, next to the switch that starts it. */}
        <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
          Face codes last one service and are then deleted — when it ends, when another starts, the moment this is
          switched off, and within twelve hours whatever happens.{" "}
          <a href="https://kyro-help.kharischurch.com/pages/data-protection" target="_blank" rel="noreferrer"
            style={{ color: "#818cf8", textDecoration: "underline" }}>
            What Kyro does with face data
          </a>
        </p>

        {asking && !p.face_matching && (
          <div className="rounded-lg p-3 flex flex-col gap-2.5" style={{ background: "var(--bg-hover)" }}>
            <p className="text-xs text-gray-300 leading-relaxed">
              Face codes are biometric data under UK GDPR. Before switching on, the church needs both of these in place:
            </p>
            <label className="flex items-start gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={dpia} onChange={(e) => setDpia(e.target.checked)} className="mt-0.5" />
              A data protection impact assessment (DPIA) for face matching has been completed and approved by the church,
              covering face codes being kept for the length of a service and deleted when it ends.
            </label>
            <label className="flex items-start gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={notices} onChange={(e) => setNotices(e.target.checked)} className="mt-0.5" />
              Clear notices at every entrance say that cameras use face matching to count attendance, with how to opt out.
            </label>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <div className="flex gap-2">
              <button onClick={() => save(true)} disabled={busy || !dpia || !notices}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Switch on
              </button>
              <button onClick={() => { setAsking(false); setErr(null); }} className="px-3 py-1.5 rounded-lg text-xs text-gray-300" style={{ background: "var(--bg-card)" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
