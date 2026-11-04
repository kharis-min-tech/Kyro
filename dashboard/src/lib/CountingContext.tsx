"use client";

/**
 * Counting on this computer, from anywhere in Kyro.
 *
 * This used to live inside the Camera Mode page, so counting stopped the moment
 * you clicked AI Count or Seat Map — silently, with no warning. It is mounted
 * once at the top of the app instead (layout.tsx), alongside the AI questions
 * and the other app-wide pieces, so moving around Kyro no longer interrupts it.
 *
 * The one thing a browser genuinely can't do is count with nothing open: some
 * Kyro tab has to stay open somewhere. Any page will do.
 *
 * It owns its own hidden <video> elements, because a picture can only be taken
 * from a video element that is on the page.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  loadEngine, listCameras, openCamera, cameraKey, grab, countPeople,
  sendReport, sendPicture, type Engine, type CameraReport, type Zone,
} from "@/lib/cameraMode";
import { SteadyCount, COUNT_CONFIDENCE, outsideZones, type Person } from "@/lib/peopleDetector";
import { isEdgeLive, edgeTokenPayload } from "@/lib/edgeAuth";

const ON_KEY = "kyro_counting_on";          // keep counting after a reload
const OFF_KEY = "kyro_camera_mode_off";     // cameras switched off on the website
const REPORT_EVERY_MS = 5_000;
const PICTURE_EVERY_MS = 20_000;

interface Cam {
  deviceId: string; key: string; label: string;
  stream: MediaStream | null; video: HTMLVideoElement | null; grabCanvas: HTMLCanvasElement;
  steady: SteadyCount; count: number; peak: number; people: Person[]; rawPeople: Person[];
  countedAt: number; secondsPerCount: number; error: string | null; lastPicture: number;
}

export interface CamView {
  key: string; label: string; count: number; people: Person[]; rawPeople: Person[];
  countedAt: number; secondsPerCount: number; error: string | null; streaming: boolean;
}

interface CountingValue {
  /** Allowed to count here at all (signed in as admin/operator on the live site, or Demo). */
  allowed: boolean;
  demo: boolean;
  phase: "idle" | "starting" | "running";
  step: string;
  progress: number;
  error: string | null;
  sendError: string | null;
  lastSent: number;
  engineInfo: string;
  /** The browser hasn't allowed the camera yet, so one click is unavoidable. */
  needsPermission: boolean;
  views: CamView[];
  total: number;
  /** Slowest seconds-per-count across the cameras — 0 before the first count. */
  secondsPerCount: number;
  start: () => Promise<void>;
  stop: () => void;
  /** The camera's live picture, for a preview. Straight from the camera, so no lag. */
  streamFor: (key: string) => MediaStream | null;
}

const Ctx = createContext<CountingValue | null>(null);
export const useCounting = () => useContext(Ctx);

function loadOff(): string[] { try { return JSON.parse(localStorage.getItem(OFF_KEY) ?? "[]"); } catch { return []; } }

export function CountingProvider({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [demo, setDemo] = useState(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "running">("idle");
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState(0);
  const [engineInfo, setEngineInfo] = useState("");
  const [views, setViews] = useState<CamView[]>([]);
  // True when the only thing stopping us is the browser's camera permission.
  const [needsPermission, setNeedsPermission] = useState(false);

  const demoRef = useRef(false);
  const engine = useRef<Engine | null>(null);
  const cams = useRef<Map<string, Cam>>(new Map());
  const running = useRef(false);
  const offRef = useRef<string[]>([]);
  const zonesRef = useRef<Record<string, Zone[]>>({});
  const countConfidenceRef = useRef<number>(COUNT_CONFIDENCE);
  const wake = useRef<{ release(): Promise<void> } | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);

  const refreshViews = useCallback(() => {
    setViews([...cams.current.values()].map((c) => ({
      key: c.key, label: c.label, count: c.count, people: c.people, rawPeople: c.rawPeople,
      countedAt: c.countedAt, secondsPerCount: c.secondsPerCount, error: c.error, streaming: !!c.stream,
    })));
  }, []);

  /** Open every camera plugged in, and pick up ones plugged in later. */
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
          steady: new SteadyCount(3), count: 0, peak: 0, people: [], rawPeople: [],
          countedAt: 0, secondsPerCount: 0, error: null, lastPicture: 0,
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
          c.error = e instanceof Error && e.name === "NotReadableError"
            ? "Another program is using this camera" : "Couldn't open this camera";
        }
      } else if (!wanted && c.stream) {
        c.stream.getTracks().forEach((t) => t.stop()); c.stream = null;
      }
      // Its own hidden video element, so a picture can be taken from any page.
      if (c.stream && holder.current) {
        if (!c.video) {
          const v = document.createElement("video");
          v.muted = true; v.playsInline = true; v.autoplay = true;
          v.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
          holder.current.appendChild(v);
          c.video = v;
        }
        if (c.video.srcObject !== c.stream) { c.video.srcObject = c.stream; c.video.play().catch(() => {}); }
      } else if (!c.stream && c.video) {
        c.video.remove(); c.video = null;
      }
    }
    for (const [key, c] of cams.current) {
      if (!seen.has(key)) {
        c.stream?.getTracks().forEach((t) => t.stop());
        c.video?.remove();
        cams.current.delete(key);
      }
    }
    refreshViews();
  }, [refreshViews]);

  /** Cameras take turns; always the newest picture. */
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
          // Everything the AI noticed, before the "sure enough to count" cutoff,
          // so "nobody there" can be told apart from "seen but not sure".
          c.rawPeople = people;
          c.people = outsideZones(people.filter((p) => p.score >= countConfidenceRef.current), zonesRef.current[c.key], px.width, px.height);
          c.count = c.steady.add(c.people.length);
          c.peak = Math.max(c.peak, c.count);
          c.countedAt = Date.now();
          c.secondsPerCount = (performance.now() - t0) / 1000;
          c.error = null;
        } catch (e) {
          c.error = `Counting problem: ${e instanceof Error ? e.message : e}`.slice(0, 120);
        }
        did = true;
      }
      refreshViews();
      // A breather between rounds, so the page stays responsive on a computer
      // without fast graphics (the AI shares the same thread).
      await new Promise((r) => setTimeout(r, did ? 350 : 500));
    }
  }, [refreshViews]);

  const stop = useCallback(() => {
    running.current = false;
    for (const c of cams.current.values()) {
      c.stream?.getTracks().forEach((t) => t.stop()); c.stream = null;
      c.video?.remove(); c.video = null;
    }
    try { localStorage.setItem(ON_KEY, "0"); } catch {}
    wake.current?.release().catch(() => {});
    setPhase("idle"); refreshViews();
  }, [refreshViews]);

  const start = useCallback(async () => {
    if (running.current) return;
    setError(null); setPhase("starting"); setProgress(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use cameras. Use Chrome or Edge.");
      setStep("Asking to use the cameras…");
      const perm = await navigator.permissions?.query({ name: "camera" as PermissionName }).catch(() => null);
      if (perm?.state !== "granted") {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      }
      if (!engine.current) {
        engine.current = await loadEngine((p, s) => { setProgress(Math.round(p)); setStep(s); });
        setEngineInfo(engine.current.kind === "accurate"
          ? "Most accurate AI, using this computer's graphics chip"
          : "Lighter AI — this computer's graphics are too slow for the most accurate one");
      }
      await syncCameras();
      if (![...cams.current.values()].some((c) => c.stream)) {
        throw new Error("No camera found. Plug your camera into this computer, then press Start again. (The computer's own built-in camera is never used.)");
      }
      running.current = true;
      setNeedsPermission(false);
      try { localStorage.removeItem(ON_KEY); } catch {}
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

  // Who may count here, and pick up again after a reload.
  useEffect(() => {
    const role = edgeTokenPayload()?.role;
    const isDemo = localStorage.getItem("kyro_mode") !== "live";
    demoRef.current = isDemo; setDemo(isDemo);
    const may = isDemo || (isEdgeLive() && (role === "admin" || role === "operator"));
    setAllowed(may);
    offRef.current = loadOff();
    if (!may) return;
    // Count whenever we can, without being asked. The only reasons not to:
    // someone pressed Stop, or the browser hasn't been allowed the camera yet
    // (a page can't switch a camera on without a click — that's the browser's
    // rule, not ours, and the card says so).
    let stopped = false;
    try { stopped = localStorage.getItem(ON_KEY) === "0"; } catch {}
    if (stopped) return;
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: "camera" as PermissionName });
        if (p && p.state !== "granted") { setNeedsPermission(true); return; }
        const cams = await listCameras();
        if (cams.length) start();
      } catch { /* leave it to the Start button */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send counts and pictures to the website.
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
        const { disabled, zones, countConfidence } = await sendReport(reports);
        zonesRef.current = zones;
        if (countConfidence !== undefined) countConfidenceRef.current = countConfidence;
        setLastSent(Date.now()); setSendError(null);
        const newlyOff = disabled.filter((k) => !offRef.current.includes(k));
        if (newlyOff.length) {
          offRef.current = [...offRef.current, ...newlyOff];
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

  // Idle but allowed: start the moment a camera is plugged in.
  useEffect(() => {
    if (phase !== "idle" || !allowed || needsPermission) return;
    let stopped = false;
    try { stopped = localStorage.getItem(ON_KEY) === "0"; } catch {}
    if (stopped) return;
    const look = async () => {
      try { if ((await listCameras()).length) start(); } catch { /* nothing plugged in */ }
    };
    navigator.mediaDevices?.addEventListener("devicechange", look);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", look);
  }, [phase, allowed, needsPermission, start]);

  // Keep the screen awake, and notice cameras being plugged in or out.
  useEffect(() => {
    if (phase !== "running") return;
    const lock = async () => {
      try { wake.current = await (navigator as unknown as { wakeLock?: { request(k: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* not supported */ }
    };
    lock();
    const onVis = () => { if (document.visibilityState === "visible") lock(); };
    const onDevices = () => { syncCameras().catch(() => {}); };
    // Closing the tab really does stop counting, so it is still worth a warning.
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    document.addEventListener("visibilitychange", onVis);
    navigator.mediaDevices.addEventListener("devicechange", onDevices);
    window.addEventListener("beforeunload", onLeave);
    const poll = setInterval(onDevices, 10_000);   // some browsers don't announce plug-ins
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      navigator.mediaDevices.removeEventListener("devicechange", onDevices);
      window.removeEventListener("beforeunload", onLeave);
      clearInterval(poll);
    };
  }, [phase, syncCameras]);

  const streamFor = useCallback((key: string) => cams.current.get(key)?.stream ?? null, []);
  const total = views.filter((v) => v.streaming).reduce((n, v) => n + v.count, 0);
  const secondsPerCount = views.reduce((m, v) => Math.max(m, v.secondsPerCount), 0);

  return (
    <Ctx.Provider value={{ allowed, demo, phase, step, progress, error, sendError, lastSent, engineInfo, needsPermission, views, total, secondsPerCount, start, stop, streamFor }}>
      {children}
      {/* The cameras' own video elements: on the page everywhere, visible nowhere. */}
      <div ref={holder} aria-hidden style={{ position: "fixed", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }} />
    </Ctx.Provider>
  );
}
