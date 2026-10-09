"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { isEdgeLive, edgeTokenPayload } from "@/lib/edgeAuth";
import {
  loadEngine, listCameras, openCamera, cameraKey, grab, countPeople,
  sendReport, sendPicture, type Engine, type CameraReport,
} from "@/lib/cameraMode";
import { SteadyCount, COUNT_CONFIDENCE, type Person } from "@/lib/peopleDetector";
import { Video, Loader2, Play, Square, AlertTriangle, CheckCircle, Users, MonitorSmartphone, Terminal, Copy, Check, KeyRound } from "lucide-react";
import { edgeVenueApi } from "@/lib/edgeVenue";
import { HELP_URL } from "@/lib/help";

const CARD_BG = "var(--bg-card)";
const BORDER = "var(--border-subtle)";
const AUTO_KEY = "kyro_camera_mode_auto";
const OFF_KEY = "kyro_camera_mode_off";
const REPORT_EVERY_MS = 5_000;
const PICTURE_EVERY_MS = 20_000;

interface Cam {
  deviceId: string; key: string; label: string;
  stream: MediaStream | null; video: HTMLVideoElement | null; grabCanvas: HTMLCanvasElement;
  steady: SteadyCount; count: number; peak: number; people: Person[];
  countedAt: number; secondsPerCount: number; error: string | null; lastPicture: number;
}

/** What the page shows for each camera (copied from the live objects a few times a second). */
interface CamView { key: string; label: string; count: number; people: Person[]; countedAt: number; secondsPerCount: number; error: string | null; streaming: boolean }

function loadOff(): string[] { try { return JSON.parse(localStorage.getItem(OFF_KEY) ?? "[]"); } catch { return []; } }

export default function CameraModePage() {
  const [ready, setReady] = useState(false);          // after mount (no server/browser mismatch)
  const [allowed, setAllowed] = useState(false);
  const [demo, setDemo] = useState(false);            // Demo: count on this computer only, nothing sent
  const demoRef = useRef(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "running">("idle");
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<CamView[]>([]);
  const [off, setOff] = useState<string[]>([]);
  const [auto, setAuto] = useState(false);
  const [lastSent, setLastSent] = useState<number>(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [engineInfo, setEngineInfo] = useState<string>("");

  const engine = useRef<Engine | null>(null);
  const cams = useRef<Map<string, Cam>>(new Map());
  const running = useRef(false);
  const offRef = useRef<string[]>([]);
  const wake = useRef<{ release(): Promise<void> } | null>(null);
  const videoEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  const overlayEls = useRef<Map<string, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    const role = edgeTokenPayload()?.role;
    const isDemo = localStorage.getItem("kyro_mode") !== "live";
    demoRef.current = isDemo; setDemo(isDemo);
    setAllowed(isDemo || (isEdgeLive() && (role === "admin" || role === "operator")));
    try { setAuto(localStorage.getItem(AUTO_KEY) === "1"); } catch {}
    offRef.current = loadOff(); setOff(offRef.current);
    setReady(true);
  }, []);

  const refreshViews = useCallback(() => {
    setViews([...cams.current.values()].map((c) => ({
      key: c.key, label: c.label, count: c.count, people: c.people, countedAt: c.countedAt,
      secondsPerCount: c.secondsPerCount, error: c.error, streaming: !!c.stream,
    })));
  }, []);

  // ── Cameras: open every camera plugged in (and pick up new ones) ──────────
  const syncCameras = useCallback(async () => {
    const found = await listCameras();
    const seen = new Set<string>();
    for (const d of found) {
      const key = await cameraKey(d.deviceId);
      seen.add(key);
      let c = cams.current.get(key);
      if (!c) {
        c = {
          deviceId: d.deviceId, key, label: d.label || `Camera ${cams.current.size + 1}`,
          stream: null, video: null, grabCanvas: document.createElement("canvas"),
          steady: new SteadyCount(5), count: 0, peak: 0, people: [], countedAt: 0, secondsPerCount: 0, error: null, lastPicture: 0,
        };
        cams.current.set(key, c);
      }
      const wanted = !offRef.current.includes(key);
      if (wanted && !c.stream) {
        try {
          c.stream = await openCamera(d.deviceId);
          c.error = null;
          c.stream.getVideoTracks()[0]?.addEventListener("ended", () => { c!.stream = null; c!.error = "Unplugged"; refreshViews(); });
        } catch (e) {
          c.error = e instanceof Error && e.name === "NotReadableError" ? "Another program is using this camera" : "Couldn't open this camera";
        }
      } else if (!wanted && c.stream) {
        c.stream.getTracks().forEach((t) => t.stop()); c.stream = null;
      }
    }
    for (const [key, c] of cams.current) {
      if (!seen.has(key)) { c.stream?.getTracks().forEach((t) => t.stop()); cams.current.delete(key); }
    }
    refreshViews();
  }, [refreshViews]);

  // Attach streams to the <video> elements once they're on the page.
  useEffect(() => {
    for (const c of cams.current.values()) {
      const v = videoEls.current.get(c.key);
      if (v && c.stream && v.srcObject !== c.stream) { v.srcObject = c.stream; v.play().catch(() => {}); }
      c.video = v ?? null;
    }
  }, [views]);

  // ── Counting loop: cameras take turns, newest picture each time ──────────
  const countLoop = useCallback(async () => {
    while (running.current) {
      let did = false;
      for (const c of [...cams.current.values()]) {
        if (!running.current) break;
        if (!c.stream || !c.video || !engine.current) continue;
        const px = grab(c.video, c.grabCanvas);
        if (!px) continue;
        const t0 = performance.now();
        try {
          const people = await countPeople(engine.current, px);
          c.people = people.filter((p) => p.score >= COUNT_CONFIDENCE);
          c.count = c.steady.add(c.people.length);
          c.peak = Math.max(c.peak, c.count);
          c.countedAt = Date.now();
          c.secondsPerCount = (performance.now() - t0) / 1000;
          c.error = null;
          drawBoxes(overlayEls.current.get(c.key), px.width, px.height, c.people);
        } catch (e) {
          c.error = `Counting problem: ${e instanceof Error ? e.message : e}`.slice(0, 120);
        }
        did = true;
      }
      refreshViews();
      // A short breather between rounds keeps the page responsive to clicks
      // (on a computer without fast graphics the AI runs on the same thread).
      await new Promise((r) => setTimeout(r, did ? 350 : 500));
    }
  }, [refreshViews]);

  // ── Sending counts + pictures to the website ─────────────────────────────
  useEffect(() => {
    if (phase !== "running" || demoRef.current) return;
    const tick = async () => {
      const list = [...cams.current.values()].filter((c) => c.stream);
      const reports: CameraReport[] = list.map((c) => ({
        key: c.key, label: c.label, current: c.count, peak: c.peak,
        status: c.error || Date.now() - c.countedAt > 60_000 ? "error" : "online",
        error: c.error ?? (c.countedAt ? null : "Starting…"),
        fps: c.secondsPerCount ? +(1 / c.secondsPerCount).toFixed(1) : 0,
        width: c.video?.videoWidth ?? 0, height: c.video?.videoHeight ?? 0,
      }));
      try {
        const disabled = await sendReport(reports);
        setLastSent(Date.now()); setSendError(null);
        // Switched off on the Cameras page → stop counting it here too.
        const newlyOff = disabled.filter((k) => !offRef.current.includes(k));
        if (newlyOff.length) {
          offRef.current = [...offRef.current, ...newlyOff]; setOff(offRef.current);
          try { localStorage.setItem(OFF_KEY, JSON.stringify(offRef.current)); } catch {}
          await syncCameras();
        }
        for (const c of list) {
          if (Date.now() - c.lastPicture >= PICTURE_EVERY_MS && c.countedAt) {
            c.lastPicture = Date.now();
            sendPicture(c.key, c.grabCanvas);
          }
        }
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "Couldn't reach the Kyro website");
      }
    };
    tick();
    const t = setInterval(tick, REPORT_EVERY_MS);
    return () => clearInterval(t);
  }, [phase, syncCameras]);

  // ── Keep the screen on; notice the page being hidden ─────────────────────
  useEffect(() => {
    if (phase !== "running") return;
    const lock = async () => {
      try { wake.current = await (navigator as any).wakeLock?.request("screen"); } catch {}
    };
    lock();
    const onVis = () => { setHidden(document.visibilityState === "hidden"); if (document.visibilityState === "visible") lock(); };
    const onDevices = () => { syncCameras().catch(() => {}); };
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    document.addEventListener("visibilitychange", onVis);
    navigator.mediaDevices.addEventListener("devicechange", onDevices);
    window.addEventListener("beforeunload", onLeave);
    const poll = setInterval(onDevices, 10_000);  // some browsers don't announce plug-ins
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      navigator.mediaDevices.removeEventListener("devicechange", onDevices);
      window.removeEventListener("beforeunload", onLeave);
      clearInterval(poll);
      wake.current?.release().catch(() => {});
    };
  }, [phase, syncCameras]);

  const start = useCallback(async () => {
    setError(null); setPhase("starting"); setProgress(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use cameras. Use Chrome or Edge.");
      setStep("Asking to use the cameras…");
      // One request so the browser asks permission and reveals camera names.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((t) => t.stop());
      if (!engine.current) {
        engine.current = await loadEngine((p, s) => { setProgress(Math.round(p)); setStep(s); });
        setEngineInfo(engine.current.kind === "accurate"
          ? "Most accurate AI, using this computer's graphics chip"
          : "Lighter AI — this computer’s graphics are too slow for the most accurate AI (a computer with better graphics, in Chrome or Edge, counts more people)");
      }
      await syncCameras();
      if (![...cams.current.values()].some((c) => c.stream)) throw new Error("No camera found. Plug a camera into this computer, then press Start again.");
      running.current = true;
      setPhase("running");
      countLoop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/NotAllowed|Permission/i.test(`${(e as Error)?.name} ${msg}`)
        ? "The browser wasn't allowed to use the camera. Click the camera icon in the address bar, choose Allow, then press Start."
        : msg);
      setPhase("idle");
    }
  }, [syncCameras, countLoop]);

  const stop = useCallback(() => {
    running.current = false;
    for (const c of cams.current.values()) { c.stream?.getTracks().forEach((t) => t.stop()); c.stream = null; }
    setPhase("idle"); refreshViews();
  }, [refreshViews]);

  // Start by itself when the page opens (if chosen, and the browser already allows the camera).
  useEffect(() => {
    if (!ready || !allowed || !auto || phase !== "idle" || error) return;
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: "camera" as PermissionName });
        if (!p || p.state === "granted") start();
      } catch { start(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, allowed]);

  useEffect(() => () => { running.current = false; for (const c of cams.current.values()) c.stream?.getTracks().forEach((t) => t.stop()); }, []);

  const toggleAuto = (v: boolean) => { setAuto(v); try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch {} };
  const toggleCam = async (key: string) => {
    offRef.current = offRef.current.includes(key) ? offRef.current.filter((k) => k !== key) : [...offRef.current, key];
    setOff(offRef.current);
    try { localStorage.setItem(OFF_KEY, JSON.stringify(offRef.current)); } catch {}
    await syncCameras();
  };

  const total = views.filter((v) => v.streaming).reduce((n, v) => n + v.count, 0);

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0 px-4 py-4 sm:px-8 sm:py-8 overflow-auto">
        <div className="mb-6 max-w-3xl">
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Video size={20} /> Camera Mode</h1>
          <p className="text-sm mt-0.5" style={{ color: "#6b7280" }}>
            Count people with cameras plugged into this computer — nothing to install. Keep this page open during the service.
          </p>
        </div>

        {!ready ? null : !allowed ? (
          <div className="rounded-xl p-5 max-w-3xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
            <p className="text-sm text-white font-medium">Camera Mode is for administrators and operators.</p>
            <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>Ask an administrator to give your account the Operator role.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 max-w-5xl">
            {/* Status / controls */}
            <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
              {phase === "running" ? (
                <div className="flex flex-wrap items-center gap-4 justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#22c55e" }}>
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Counting
                    </div>
                    <p className="text-3xl font-bold text-white tabular-nums mt-1 flex items-center gap-2"><Users size={24} /> {total} <span className="text-base font-normal" style={{ color: "#9ca3af" }}>people now</span></p>
                    <p className="text-xs mt-1" style={{ color: sendError ? "#f59e0b" : "#6b7280" }}>
                      {demo ? "Demo mode: the count stays on this computer. Sign in with Live to send it to your dashboard." : sendError ? `Not sending: ${sendError} — retrying` : lastSent ? `Sent to your Kyro dashboard ${Math.max(0, Math.round((Date.now() - lastSent) / 1000))} s ago` : "Connecting to Kyro…"}
                    </p>
                    {engineInfo && <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{engineInfo}</p>}
                  </div>
                  <button onClick={stop} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: "var(--bg-hover)", color: "var(--text-primary, #e5e7eb)", border: `1px solid ${BORDER}` }}>
                    <Square size={14} /> Stop
                  </button>
                </div>
              ) : phase === "starting" ? (
                <div>
                  <div className="flex items-center gap-2 text-sm text-white"><Loader2 size={16} className="animate-spin" /> {step}</div>
                  <div className="h-2 rounded-full mt-3 overflow-hidden" style={{ background: "var(--bg-hover)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: "#6366f1" }} />
                  </div>
                  <p className="text-xs mt-2" style={{ color: "#6b7280" }}>The first time downloads the AI (about 40 MB). After that it starts in seconds.</p>
                </div>
              ) : (
                <div>
                  <ol className="text-sm space-y-1.5 mb-4" style={{ color: "#9ca3af" }}>
                    <li><b className="text-white">1.</b> Plug your camera(s) into this computer.</li>
                    <li><b className="text-white">2.</b> Press <b className="text-white">Start counting</b> and allow the camera when the browser asks.</li>
                    <li><b className="text-white">3.</b> {demo
                      ? "Demo mode: you'll see the count here. Sign in with Live to send it to AI Count and Live Cameras."
                      : "Leave this page open. Counts appear on AI Count and Live Cameras for everyone."}</li>
                  </ol>
                  <button onClick={start} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "#6366f1", color: "#fff" }}>
                    <Play size={15} /> Start counting
                  </button>
                </div>
              )}
              {error && (
                <div className="mt-4 flex gap-2 text-sm rounded-lg p-3" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
                </div>
              )}
              <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer" style={{ color: "#9ca3af" }}>
                <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
                Start counting by itself whenever this page is opened on this computer
              </label>
            </div>

            {phase === "running" && hidden && (
              <div className="flex gap-2 text-sm rounded-lg p-3" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                This page is hidden, so the browser may slow the counting down. Keep Kyro on screen during the service.
              </div>
            )}

            {/* Cameras */}
            {views.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {views.map((v) => {
                  const isOff = off.includes(v.key);
                  return (
                    <div key={v.key} className="rounded-xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
                      <div className="relative bg-black aspect-video">
                        {v.streaming ? (
                          <>
                            <video ref={(el) => { if (el) videoEls.current.set(v.key, el); else videoEls.current.delete(v.key); }}
                              muted playsInline className="w-full h-full object-contain" />
                            <canvas ref={(el) => { if (el) overlayEls.current.set(v.key, el); else overlayEls.current.delete(v.key); }}
                              className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                            <div className="absolute top-2 right-2 px-2.5 py-1 rounded-lg text-sm font-bold" style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}>
                              {v.count} {v.count === 1 ? "person" : "people"}
                            </div>
                          </>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "#6b7280" }}>
                            {isOff ? "Not counting this camera" : v.error ?? "Camera off"}
                          </div>
                        )}
                      </div>
                      <div className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{v.label}</p>
                          <p className="text-xs truncate" style={{ color: v.error ? "#f59e0b" : "#6b7280" }}>
                            {v.error ?? (v.countedAt ? `Counts every ${v.secondsPerCount.toFixed(1)} s` : v.streaming ? "Starting…" : "")}
                          </p>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs shrink-0 cursor-pointer" style={{ color: "#9ca3af" }}>
                          <input type="checkbox" checked={!isOff} onChange={() => toggleCam(v.key)} /> Count
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="rounded-xl p-4 text-sm flex gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, color: "#9ca3af" }}>
              <MonitorSmartphone size={18} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p><CheckCircle size={13} className="inline mr-1 text-green-500" />Plug in another camera any time — it&apos;s picked up within a few seconds.</p>
                <p><CheckCircle size={13} className="inline mr-1 text-green-500" />Always the newest AI: it comes with the website, so there&apos;s nothing to update.</p>
                <p><CheckCircle size={13} className="inline mr-1 text-green-500" />Keep the computer plugged in, with this page open and on screen. Use Chrome or Edge for the most accurate count.</p>
              </div>
            </div>

            <InstallSection demo={demo} isAdmin={edgeTokenPayload()?.role === "admin"} />
          </div>
        )}
      </main>
    </div>
  );
}

/** Outline each person counted, on a see-through layer over the video. */
function drawBoxes(canvas: HTMLCanvasElement | undefined, w: number, h: number, people: Person[]) {
  if (!canvas) return;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = Math.max(2, w / 640);
  for (const p of people) {
    const [x1, y1, x2, y2] = p.box;
    ctx.strokeStyle = p.score >= 0.5 ? "#22c55e" : "#f59e0b";
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
}

const INSTALL = {
  windows: 'powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install/install-windows.ps1 | iex"',
  mac: "curl -fsSL https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install/install.sh | bash",
};

/** The installed version (Kyro Camera Box): one command in the terminal, for counting without a page open. */
function InstallSection({ demo, isAdmin }: { demo: boolean; isAdmin: boolean }) {
  const [os, setOs] = useState<"windows" | "mac">("windows");
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (/Mac|Linux|CrOS/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent)) setOs("mac"); }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(INSTALL[os]); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  const getCode = async () => {
    setBusy(true); setCodeErr(null);
    try { setCode(await edgeVenueApi.pairingCode()); } catch (e) { setCodeErr(e instanceof Error ? e.message : "Couldn't get a code"); }
    setBusy(false);
  };

  const tab = (id: "windows" | "mac", label: string) => (
    <button onClick={() => setOs(id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
      style={os === id ? { background: "#6366f1", color: "#fff" } : { background: "var(--bg-hover)", color: "#9ca3af" }}>
      {label}
    </button>
  );

  return (
    <div className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <h2 className="text-base font-semibold text-white flex items-center gap-2"><Terminal size={17} /> Want the installed version?</h2>
      <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>
        Installing Kyro on the camera computer counts without this page being open, starts by itself when the
        computer turns on, and installs every new AI update by itself. Run this once in the terminal on that
        computer. Running it again later is safe — it just brings everything up to date.
      </p>

      <div className="flex gap-2 mt-4">{tab("windows", "Windows")}{tab("mac", "Mac / Linux")}</div>
      <p className="text-xs mt-3" style={{ color: "#6b7280" }}>
        {os === "windows"
          ? "1. Click Start, type PowerShell and open it.  2. Paste this line and press Enter:"
          : "1. Open Terminal (press Cmd + Space and type Terminal).  2. Paste this line and press Enter:"}
      </p>
      <div className="mt-2 flex items-stretch gap-2">
        <code className="flex-1 min-w-0 rounded-lg px-3 py-2.5 text-xs break-all font-mono"
          style={{ background: "var(--bg-hover)", color: "var(--text-primary, #e5e7eb)" }}>
          {INSTALL[os]}
        </code>
        <button onClick={copy} className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold"
          style={{ background: "#6366f1", color: "#fff" }} aria-label="Copy the command">
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
        </button>
      </div>
      <p className="text-xs mt-3" style={{ color: "#6b7280" }}>
        3. The first time takes 10–20 minutes. When it asks for a <b>pairing code</b>, use the one below.
        It&apos;s done when it says <b>All done!</b> — the computer then shows as Online on the Cameras page.
      </p>

      <div className="mt-4">
        {demo ? (
          <p className="text-xs" style={{ color: "#f59e0b" }}>The installed version sends counts to your Live dashboard — sign in with Live to get a pairing code.</p>
        ) : isAdmin ? (
          code ? (
            <div className="rounded-lg p-3 inline-block" style={{ background: "var(--bg-hover)" }}>
              <p className="text-xs" style={{ color: "#9ca3af" }}>Pairing code — type this when the installer asks</p>
              <p className="text-2xl font-bold tracking-widest text-white font-mono mt-1">{code.code}</p>
              <p className="text-xs mt-1" style={{ color: "#6b7280" }}>Works until {new Date(code.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          ) : (
            <button onClick={getCode} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: "var(--bg-hover)", color: "var(--text-primary, #e5e7eb)", border: `1px solid ${BORDER}` }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Get a pairing code
            </button>
          )
        ) : (
          <p className="text-xs" style={{ color: "#9ca3af" }}>Ask an administrator for a pairing code (Cameras → Pair a camera computer).</p>
        )}
        {codeErr && <p className="text-xs mt-2" style={{ color: "#f87171" }}>{codeErr}</p>}
      </div>

      <p className="text-xs mt-4" style={{ color: "#6b7280" }}>
        Step-by-step help: <a href={`${HELP_URL}/guides/camera-setup`} target="_blank" rel="noopener noreferrer" className="underline">camera setup guide</a>.
      </p>
    </div>
  );
}
