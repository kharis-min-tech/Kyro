"use client";

import { useAuth } from "@/hooks/useAuth";
import { FormEvent, useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { useCameras } from "@/hooks/useCameras";
import { DEMO_MODE } from "@/lib/demo";

function isLiveMode(): boolean { if (typeof window === "undefined") return false; return localStorage.getItem("kyro_mode") === "live"; }
const inDemoMode = () => typeof window !== "undefined" && (localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL);
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { isEdgeLive } from "@/lib/edgeAuth";
import { edgeVenueApi, type EdgeCamera, type EdgeDevice } from "@/lib/edgeVenue";
import {
  Camera, Wifi, Monitor, HelpCircle, Loader2, Zap,
  ChevronDown, ChevronUp, Plus, Pencil, Check, X, Terminal,
  Users, MapPin, AlertCircle, AlertTriangle, Trash2, RefreshCw,
  Cpu, Power, KeyRound, ExternalLink, Radio,
} from "lucide-react";
import type { Camera as CameraType } from "@/types";
import { InstallCommand } from "@/components/ui/InstallCommand";
import { IgnoreZonesEditor } from "@/components/ui/IgnoreZonesEditor";

// ─── Queue camera detection ───────────────────────────────────────────────────

const QUEUE_KEYWORDS = ["outside", "queue", "entrance", "foyer", "lobby", "car park",
  "carpark", "waiting", "exterior", "outdoor", "outside area", "front door", "gate"];

function looksLikeQueue(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return QUEUE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isQueueCamera(cam: CameraType): boolean {
  return cam.location === "queue" || looksLikeQueue(cam.name) || looksLikeQueue(cam.zone_name ?? "");
}

// ─── Camera type options ──────────────────────────────────────────────────────

const CAMERA_TYPES = [
  {
    id: "ip",
    label: "IP / Network Camera",
    description: "Security camera on WiFi or ethernet",
    icon: Wifi,
    urlTemplate: "rtsp://admin:password@192.168.1.XX/stream",
    urlHint: "Found in your camera's app or web interface under Settings → Network",
    urlPlaceholder: "rtsp://192.168.1.100/stream",
  },
  {
    id: "webcam",
    label: "USB Webcam",
    description: "Webcam plugged into this computer",
    icon: Camera,
    urlTemplate: "0",
    urlHint: "Use 0 for the first webcam, 1 for a second",
    urlPlaceholder: "0",
  },
  {
    id: "ndi",
    label: "NDI (wireless)",
    description: "Wireless HDMI → NDI source on the LAN",
    icon: Radio,
    urlTemplate: "ndi://",
    urlHint: "The NDI source name as it appears on the LAN (e.g. CHURCH-TX1 (Camera))",
    urlPlaceholder: "ndi://CHURCH-TX1 (Camera)",
  },
  {
    id: "srt",
    label: "SRT / RTMP",
    description: "Wireless transmitter streaming SRT or RTMP",
    icon: Radio,
    urlTemplate: "srt://",
    urlHint: "Address + port from your transmitter's SRT/RTMP output (e.g. srt://192.168.1.50:9999)",
    urlPlaceholder: "srt://192.168.1.50:9999",
  },
  {
    id: "other",
    label: "Other",
    description: "Any RTSP, MJPEG, or custom URL",
    icon: Monitor,
    urlTemplate: "",
    urlHint: "Enter the full stream URL",
    urlPlaceholder: "rtsp://...",
  },
] as const;

// ─── Registered camera card ───────────────────────────────────────────────────

function CameraCard({ cam, onUpdated, onUpdate, onDelete, canManage, edge = false }: {
  cam: CameraType;
  /** Live mode on the Cloudflare build — camera comes from the camera computer at church. */
  edge?: boolean;
  /** Only admins can change venue hardware; everyone else sees a read-only card. */
  canManage: boolean;
  onUpdated: () => void;
  onUpdate: (id: string, fields: Partial<CameraType>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing]       = useState(false);
  const [zonesOpen, setZonesOpen]   = useState(false);
  const [draft, setDraft]           = useState({
    name:          cam.name,
    zone_name:     cam.zone_name ?? cam.name,
    stream_url:    cam.stream_url,
    zone_capacity: cam.zone_capacity ?? 0,
    location:      cam.location ?? "",
  });
  const [showCmd, setShowCmd]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]     = useState(false);

  const isQueue  = isQueueCamera(cam);
  const edgeCam  = edge ? (cam as EdgeCamera) : null;
  const isUsb    = edgeCam?.kind === "usb";
  const isWebcam = edgeCam ? isUsb : (cam.stream_url === "0" || /^\d$/.test(cam.stream_url));
  /** A browser camera — picked via the plug-and-play detector. Lives on the
   *  user's phone/laptop. Named with a webcam://<deviceId> stream URL and
   *  the "web-" camera_id prefix set by CameraContext.addCamera. */
  const isBrowserCam = cam.camera_id.startsWith("web-") || (cam.stream_url?.startsWith("webcam://") ?? false);

  async function save() {
    setSaving(true); setErr(null);
    try {
      await onUpdate(cam.camera_id, {
        name:          draft.name.trim()      || cam.name,
        zone_name:     draft.zone_name.trim() || cam.name,
        stream_url:    draft.stream_url.trim(),
        zone_capacity: draft.location === "queue" ? 0 : (Number(draft.zone_capacity) || 0),
        location:      draft.location || undefined,
      });
      setEditing(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(cam.camera_id);
    } catch (e: any) {
      setErr(e.message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className={`bg-gray-900 rounded-xl overflow-hidden border ${
      isQueue ? "border-amber-900/40" : "border-gray-800"
    }`}>
      {/* Queue badge */}
      {isQueue && !editing && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium"
          style={{ background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
          <Users size={12} className="text-amber-400" />
          <span className="text-amber-300">Queue / outdoor camera</span>
          <span className="text-gray-500 ml-auto">counts people waiting — not seats</span>
        </div>
      )}

      {/* Browser camera badge — plug-and-play camera on the user's device.
          This is a REAL camera entry in Kyro (shows in Seat Map, Rota,
          Sessions, Live Cameras) but counting needs the Kyro camera
          computer to see the feed. We say that honestly instead of
          pretending counts will magically appear. */}
      {isBrowserCam && !editing && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium"
          style={{ background: "rgba(99,102,241,0.08)", borderBottom: "1px solid rgba(99,102,241,0.25)" }}>
          <Camera size={12} className="text-indigo-400" />
          <span className="text-indigo-300">Browser camera · on this device</span>
          <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
            Pair a Kyro camera computer for automatic counting
          </span>
        </div>
      )}

      <div className="px-4 py-4">
        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Camera name</label>
                <input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Zone name</label>
                <input value={draft.zone_name} onChange={(e) => setDraft((p) => ({ ...p, zone_name: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!edge && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">Stream URL</label>
                  <input value={draft.stream_url} onChange={(e) => setDraft((p) => ({ ...p, stream_url: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Camera type</label>
                <select value={draft.location} onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Indoor (has seats)</option>
                  <option value="queue">Outdoor / queue (no seats)</option>
                </select>
              </div>
            </div>
            {draft.location !== "queue" && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Seat capacity</label>
                <input type="number" min="0" value={draft.zone_capacity}
                  onChange={(e) => setDraft((p) => ({ ...p, zone_capacity: Number(e.target.value) }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40" />
              </div>
            )}
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
                <Check size={13} /> {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => { setEditing(false); setErr(null); }}
                className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-white">{cam.name}</p>
              {canManage && (
                <>
                  <button onClick={() => setEditing(true)} className="text-gray-600 hover:text-gray-300 transition-colors" aria-label="Edit camera">
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="ml-auto text-gray-600 hover:text-red-400 transition-colors"
                    title={isUsb ? "Switch camera off" : "Delete camera"}
                    aria-label={isUsb ? "Switch camera off" : "Delete camera"}
                  >
                    {isUsb ? <Power size={13} /> : <Trash2 size={13} />}
                  </button>
                </>
              )}
            </div>

            {/* Delete confirmation */}
            {confirmDelete && (
              <div className="mb-3 rounded-xl px-4 py-3 flex flex-col gap-2"
                style={{ background: "rgba(185,28,28,0.1)", border: "1px solid rgba(185,28,28,0.4)" }}>
                <p className="text-sm font-semibold text-white">{isUsb ? `Switch off "${cam.name}"?` : `Delete "${cam.name}"?`}</p>
                <p className="text-xs text-gray-400">
                  {isUsb
                    ? "Kyro will stop counting with this camera. You can switch it back on below at any time."
                    : "This will permanently remove the camera. This can't be undone."}
                </p>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-700 hover:bg-red-600 disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    {isUsb ? (deleting ? "Switching off…" : "Yes, switch it off") : (deleting ? "Deleting…" : "Yes, delete it")}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {edgeCam && (
              <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
                <span className={`inline-block w-2 h-2 rounded-full ${cam.is_active ? (edgeCam.error_reason ? "bg-amber-400" : "bg-green-500") : "bg-gray-600"}`} />
                <span className={cam.is_active ? "text-gray-300" : "text-gray-500"}>
                  {cam.is_active ? (edgeCam.error_reason ? "Needs attention" : "Online") : "Offline"}
                </span>
                {edgeCam.error_reason && <span className="text-amber-400 break-words">· {edgeCam.error_reason}</span>}
              </div>
            )}
            {edgeCam && canManage && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                <button onClick={() => setZonesOpen(true)} className="text-indigo-400 hover:text-indigo-300 underline">
                  Don&apos;t count an area
                </button>
                {(edgeCam.ignore_zones?.length ?? 0) > 0 && (
                  <span className="text-gray-500">· {edgeCam.ignore_zones!.length} area{edgeCam.ignore_zones!.length > 1 ? "s" : ""} not counted</span>
                )}
              </div>
            )}
            {zonesOpen && edgeCam && (
              <IgnoreZonesEditor cameraId={cam.camera_id} initial={edgeCam.ignore_zones ?? []}
                onClose={() => setZonesOpen(false)} onSaved={onUpdated} />
            )}
            {edgeCam && !cam.is_active && !edgeCam.hidden && (
              <p className="text-xs text-gray-500 mb-2 leading-relaxed">
                {edgeCam.kind === "web"
                  ? "This camera was added by Camera Mode, so it only counts while the Camera Mode page is open on that computer. For everyday counting, install the Kyro counter on that computer (Camera Mode → Want the installed version?) — it then counts by itself, with no page open."
                  : edgeCam.kind === "usb"
                    ? "Not counting right now: the computer this camera is plugged into isn't sending counts. Check that computer is on and online, and the camera is plugged in."
                    : "Not counting right now: the camera computer can't reach this camera. Check the camera is on and the address is right."}
              </p>
            )}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-500">Zone:</span>
              <span className="text-xs font-medium text-indigo-400">
                {cam.zone_name || <span className="text-gray-600 italic">not set</span>}
              </span>
              {canManage && (
                <button onClick={() => setEditing(true)} className="text-gray-600 hover:text-gray-300 transition-colors" aria-label="Edit zone">
                  <Pencil size={11} />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-gray-600 min-w-0">
                {isWebcam ? <Camera size={12} /> : <Wifi size={12} />}
                <span className="font-mono truncate max-w-[200px]">{cam.stream_url}</span>
                {!isQueue && cam.zone_capacity > 0 && (
                  <span>· {cam.zone_capacity.toLocaleString()} seats</span>
                )}
                {isQueue && <span className="text-amber-600">· queue counter</span>}
              </div>
              {canManage && !edge && (
                <button onClick={() => setShowCmd((p) => !p)}
                  className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 rounded-lg px-2.5 py-1">
                  <Terminal size={11} />
                  {showCmd ? "Hide command" : "Start worker"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {showCmd && !editing && (
        <div className="border-t border-gray-800 bg-gray-950 px-4 py-3">
          <p className="text-xs text-gray-500 mb-2">Run on the machine where Kyro is installed:</p>
          <pre className="text-xs text-indigo-300 font-mono bg-gray-900 rounded-lg px-3 py-2 overflow-x-auto">
            python -m ai.worker --camera-id {cam.camera_id} --stream {cam.stream_url}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Add camera form ──────────────────────────────────────────────────────────

// ─── Detected-device card (plug-and-play webcams) ────────────────────────────
//
// Browsers can enumerate real video input devices (built-in webcam, USB cam,
// phone back/front cameras) through MediaDevices. We lead the Add flow with
// those so the common case — "I plugged in a camera, use it" — is one tap:
// detect → preview → fill name → save. The RTSP / IP-camera form stays
// available for cameras that aren't physically attached to this device, but
// it's no longer the first thing a non-technical operator sees.

interface DetectedDevice {
  id: string;      // MediaDevices deviceId
  label: string;   // Human label, e.g. "FaceTime HD Camera"
}

function DetectedDeviceCard({ device, onPick, picked, onReject }: {
  device: DetectedDevice;
  onPick: () => void;
  picked: boolean;
  onReject?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "preview" | "denied" | "error">("idle");
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setState("idle");
  }, []);

  async function startPreview() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: device.id } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => {});
      }
      setState("preview");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.name : "error";
      setState(msg === "NotAllowedError" ? "denied" : "error");
    }
  }

  // Stop the preview when the card is unmounted or its "picked" status flips
  // off — leaving a <video> live after the user has moved on would keep the
  // camera indicator LED on, which looks like a bug (or a privacy problem).
  useEffect(() => () => stop(), [stop]);
  useEffect(() => { if (!picked) stop(); }, [picked, stop]);

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: picked ? "1px solid #4f46e5" : "1px solid var(--border-subtle)" }}>
      <div className="aspect-video flex items-center justify-center" style={{ background: "var(--bg-inset)" }}>
        {state === "preview" ? (
          <video ref={videoRef} autoPlay playsInline muted
            className="w-full h-full object-cover" />
        ) : state === "denied" ? (
          <div className="text-center p-4">
            <AlertTriangle size={22} className="mx-auto mb-1" style={{ color: "#f59e0b" }} />
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Browser blocked camera access. Allow it in your browser's address bar lock icon and try again.
            </p>
          </div>
        ) : state === "error" ? (
          <div className="text-center p-4">
            <AlertCircle size={22} className="mx-auto mb-1 text-red-400" />
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              Couldn't open this camera. Another app may be using it.
            </p>
          </div>
        ) : (
          <Camera size={28} style={{ color: "var(--text-faint)" }} />
        )}
      </div>
      <div className="p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{device.label}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {state === "preview" ? "Preview live — this is what the system sees" : "Tap preview to confirm it's the right one"}
          </p>
        </div>
        {state === "preview" ? (
          <button type="button" onClick={stop}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}>
            Stop
          </button>
        ) : (
          <button type="button" onClick={startPreview}
            className="text-xs px-3 py-1.5 rounded-lg text-white"
            style={{ background: "var(--bg-hover)", border: "1px solid var(--border-strong)" }}>
            Preview
          </button>
        )}
        <button type="button" onClick={onPick}
          className="text-xs px-3 py-1.5 rounded-lg text-white font-medium"
          style={{ background: picked ? "#16a34a" : "#4f46e5" }}>
          {picked ? <><Check size={12} className="inline -mt-0.5 mr-0.5" /> Picked</> : "Use this"}
        </button>
        {onReject && (
          <button type="button" onClick={() => { stop(); onReject(); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
            aria-label="Not this one — remove from list"
            title="Not this one">
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function AddCameraForm({ onAdded, cameraCount }: { onAdded: () => void; cameraCount: number }) {
  const { addCamera } = useCameras();
  const [open, setOpen]         = useState(cameraCount === 0);
  // "transmitter" is a routing step — once the user tells us how the
  // receiver connects (USB capture or network stream) we forward them to
  // "detect" or "ip" with transmitter-specific wording set below.
  const [mode, setMode]         = useState<"detect" | "ip" | "advanced" | "transmitter" | null>(null);
  // When the user came in via the transmitter card we display slightly
  // different wording in the detect/ip sub-screens — set once on entry.
  const [transmitterPath, setTransmitterPath] = useState<"usb" | "network" | null>(null);
  const [type, setType]         = useState<typeof CAMERA_TYPES[number] | null>(null);
  const [name, setName]         = useState("");
  const [url, setUrl]           = useState("");
  const [zone, setZone]         = useState("");
  const [cap, setCap]           = useState("");
  const [adding, setAdding]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  // Smart detection state
  const [queuePrompt, setQueuePrompt]   = useState<"idle" | "asking" | "confirmed" | "dismissed">("idle");
  const [isQueueCam, setIsQueueCam]     = useState(false);

  // Device enumeration — plug-detection style.
  //
  // The user plugs a camera in BEFORE tapping Scan. We capture a baseline of
  // existing video-input device IDs the moment they enter the detect mode
  // (without prompting for permission — this returns IDs with blank labels,
  // which is fine for comparison). On Scan, we enumerate again with
  // permission so we get real labels, and only show device IDs that are
  // NEW since the baseline — i.e. the camera they just plugged in.
  //
  // This stops the old behaviour where the built-in webcam / phone front
  // and back cameras appeared unprompted even when the user hadn't
  // connected anything.
  const [detecting, setDetecting]     = useState(false);
  const [baselineIds, setBaselineIds] = useState<Set<string> | null>(null);
  const [newDevices, setNewDevices]   = useState<DetectedDevice[]>([]);
  const [allDevices, setAllDevices]   = useState<DetectedDevice[]>([]);
  const [showAll, setShowAll]         = useState(false);
  const [pickedId, setPickedId]       = useState<string | null>(null);
  const [detectErr, setDetectErr]     = useState<string | null>(null);
  const [scanned, setScanned]         = useState(false);

  const supportsMediaDevices = typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.enumerateDevices
    && !!navigator.mediaDevices?.getUserMedia;

  // Baseline — enumerate silently (no permission prompt) to record what was
  // ALREADY connected when the user opened the detect flow. Runs once on
  // entering detect mode.
  useEffect(() => {
    if (mode !== "detect" || baselineIds !== null || !supportsMediaDevices) return;
    (async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const ids = new Set(list.filter((d) => d.kind === "videoinput").map((d) => d.deviceId));
        setBaselineIds(ids);
      } catch {
        setBaselineIds(new Set());
      }
    })();
  }, [mode, baselineIds, supportsMediaDevices]);

  const detect = useCallback(async () => {
    if (!supportsMediaDevices) {
      setDetectErr("Your browser can't scan for cameras — please use a modern browser over HTTPS.");
      return;
    }
    setDetecting(true);
    setDetectErr(null);
    setScanned(true);
    try {
      // One-shot permission request so the subsequent enumerate() returns
      // real labels instead of empty strings. Stream released immediately.
      const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      temp.getTracks().forEach((t) => t.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids = list
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      setAllDevices(vids);
      const base = baselineIds ?? new Set<string>();
      const fresh = vids.filter((v) => !base.has(v.id));
      setNewDevices(fresh);
      if (fresh.length === 0) {
        setDetectErr("No new camera found — nothing was plugged in. Connect a camera, then tap Scan again.");
      }
    } catch (e: unknown) {
      const name = (e as Error)?.name;
      if (name === "NotAllowedError") {
        setDetectErr("Camera access blocked. Allow it in your browser's address bar and try again.");
      } else if (name === "NotFoundError") {
        setDetectErr("No cameras found on this device at all.");
      } else {
        setDetectErr("Couldn't scan for cameras. Try reloading the page.");
      }
    } finally {
      setDetecting(false);
    }
  }, [supportsMediaDevices, baselineIds]);

  function pickDevice(d: DetectedDevice) {
    setPickedId(d.id);
    // Browser-source identifier the vision worker can distinguish from
    // RTSP input. Format: webcam://<deviceId> — reserved by this app.
    setUrl(`webcam://${d.id}`);
    // Do NOT auto-fill the name — the user names the camera themselves
    // (per the operator's own ask: "don't give me a random camera name").
  }

  function rejectDevice(id: string) {
    // User doesn't want this camera — remove it from the list and clear
    // the pick if it was the picked one. The baseline is updated too so
    // the same device won't resurface on the next Scan.
    setNewDevices((prev) => prev.filter((d) => d.id !== id));
    setBaselineIds((prev) => {
      const next = new Set(prev ?? []);
      next.add(id);
      return next;
    });
    if (pickedId === id) { setPickedId(null); setUrl(""); }
  }

  function handleNameChange(val: string) {
    setName(val);
    if (looksLikeQueue(val) && queuePrompt === "idle" && !isQueueCam) {
      setQueuePrompt("asking");
    } else if (!looksLikeQueue(val) && queuePrompt === "asking") {
      setQueuePrompt("idle");
    }
  }

  function confirmQueue(yes: boolean) {
    setIsQueueCam(yes);
    setQueuePrompt(yes ? "confirmed" : "dismissed");
    if (yes) {
      setCap("0"); // no seats for queue cameras
      if (!zone) setZone("Outside Queue");
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAdding(true); setErr(null);
    try {
      await addCamera({
        name,
        stream_url:    url,
        zone_name:     zone || name,
        zone_capacity: isQueueCam ? 0 : (parseInt(cap, 10) || 0),
        zone_order:    cameraCount,
        location:      isQueueCam ? "queue" : undefined,
      });
      setName(""); setUrl(""); setZone(""); setCap("");
      setType(null); setIsQueueCam(false); setQueuePrompt("idle");
      setMode(null); setPickedId(null); setTransmitterPath(null);
      setBaselineIds(null); setNewDevices([]); setAllDevices([]);
      setShowAll(false); setScanned(false);
      setOpen(false);
      onAdded();
    } catch (e: any) { setErr(e.message); }
    finally { setAdding(false); }
  }

  const canSubmit = !!name.trim() && !!url.trim();

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ background: "var(--bg-card)" }}>
        <div className="flex items-center gap-2">
          <Plus size={15} className="text-indigo-400" />
          <span className="text-sm font-medium text-white">Add a camera</span>
        </div>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>

      {open && (
        <div className="p-4 flex flex-col gap-4"
          style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border-subtle)" }}>

          {/* Mode picker — leads with the plug-and-play path. */}
          {!mode && (
            <div className="flex flex-col gap-3">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>How is this camera connected?</p>

              <button type="button" onClick={() => setMode("detect")}
                className="text-left rounded-xl p-4 flex items-start gap-3 transition-colors"
                style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.35)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(99,102,241,0.15)" }}>
                  <Zap size={18} className="text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">
                    Plugged into this device <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>· recommended</span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    Phone or laptop camera, USB webcam. Kyro will scan and show you a live preview — just pick the one you want.
                  </p>
                </div>
              </button>

              <button type="button" onClick={() => { setMode("ip"); setType(CAMERA_TYPES[0]); setUrl(""); }}
                className="text-left rounded-xl p-4 flex items-start gap-3 transition-colors"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(59,130,246,0.12)" }}>
                  <Wifi size={18} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Network IP camera</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    Security camera on your WiFi (Hikvision, Reolink, TP-Link…). You'll paste its RTSP address.
                  </p>
                </div>
              </button>

              <button type="button" onClick={() => { setMode("transmitter"); setUrl(""); }}
                className="text-left rounded-xl p-4 flex items-start gap-3 transition-colors"
                style={{ background: "var(--bg-inset)", border: "1px solid rgba(236,72,153,0.3)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(236,72,153,0.12)" }}>
                  <Radio size={18} style={{ color: "#ec4899" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Through a wireless transmitter</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    Wireless HDMI (Teradek, Hollyland), NDI, SRT. Kyro walks you through hooking the
                    receiver up so the camera's seen like any other.
                  </p>
                </div>
              </button>

              <button type="button" onClick={() => { setMode("advanced"); setType(CAMERA_TYPES[CAMERA_TYPES.length - 1]); setUrl(""); }}
                className="text-left rounded-xl p-4 flex items-start gap-3 transition-colors"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(107,114,128,0.15)" }}>
                  <Terminal size={18} style={{ color: "var(--text-muted)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Advanced / other</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    Any MJPEG, HLS or custom URL. For when you know exactly what you're doing.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Wireless transmitter sub-chooser — pick the receiver type and
              Kyro routes you to the right path. HDMI RX via a USB capture
              card looks like a USB camera to the OS so it goes through the
              detect flow unchanged; everything else is a network stream. */}
          {mode === "transmitter" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => { setMode(null); setTransmitterPath(null); }}
                  className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                  ← Back
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                How does the transmitter's RECEIVER reach this device?
              </p>

              <button type="button" onClick={() => { setTransmitterPath("usb"); setMode("detect"); }}
                className="text-left rounded-xl p-4 flex items-start gap-3 transition-colors"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(99,102,241,0.15)" }}>
                  <Zap size={18} className="text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Receiver plugs into USB (recommended)</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    Wireless HDMI receiver + a USB capture card (Elgato Cam Link, Magewell, HDMI-to-USB
                    dongle). The camera will show up like any plugged-in webcam.
                  </p>
                </div>
              </button>

              <button type="button" onClick={() => { setTransmitterPath("network"); setMode("ip"); setType(CAMERA_TYPES.find((t) => t.id === "ndi") ?? CAMERA_TYPES[0]); setUrl(""); }}
                className="text-left rounded-xl p-4 flex items-start gap-3 transition-colors"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "rgba(236,72,153,0.12)" }}>
                  <Wifi size={18} style={{ color: "#ec4899" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Transmitter sends a network stream</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    NDI, SRT, RTMP, or RTSP over WiFi/ethernet. You'll paste the stream address from
                    the transmitter's control app.
                  </p>
                </div>
              </button>

              <div className="rounded-xl px-3 py-2.5 text-xs flex items-start gap-2"
                style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", color: "var(--text-tertiary)" }}>
                <HelpCircle size={13} className="text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  Not sure? Most church setups use <strong>HDMI → USB capture</strong>. Pick that if
                  your receiver has an HDMI output and you've got a USB capture dongle.
                </span>
              </div>
            </div>
          )}

          {/* Plug-and-play detector — plug-detection style.
              The baseline is captured silently when the user enters this
              mode. Only devices that appear AFTER a Scan (= plugged in
              since opening the page) are surfaced as fresh cards. Built-in
              webcams / phone cameras stay out of the list unless the user
              opts into "Show all cameras". */}
          {mode === "detect" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => {
                    setMode(null); setPickedId(null); setUrl(""); setScanned(false);
                    setNewDevices([]); setAllDevices([]); setShowAll(false);
                    setTransmitterPath(null);
                  }}
                  className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                  ← Back
                </button>
              </div>

              {/* Pre-scan instructions — only shown before the first Scan.
                  The copy is tailored when the user came in via the
                  wireless-transmitter path so they know to connect the
                  RECEIVER + capture card, not the camera itself. */}
              {!scanned && !detecting && (
                <div className="rounded-xl p-4 flex flex-col items-center gap-3 text-center"
                  style={{ background: "var(--bg-inset)", border: "1px dashed var(--border-strong)" }}>
                  {transmitterPath === "usb" ? <Radio size={20} style={{ color: "#ec4899" }} /> : <Zap size={20} className="text-indigo-400" />}
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {transmitterPath === "usb"
                        ? "Hook the transmitter up to this device"
                        : "Plug a camera in now"}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                      {transmitterPath === "usb" ? (
                        <>
                          Turn on the wireless transmitter + receiver. Connect the receiver's HDMI
                          output into a <strong>USB capture card</strong> (Elgato Cam Link, Magewell,
                          or any HDMI-to-USB dongle), then plug the dongle into this device. Tap&nbsp;
                          <strong>Scan</strong> — Kyro will see the receiver as if it were a USB camera.
                        </>
                      ) : (
                        <>
                          Connect your USB webcam, phone, or any camera to this device, then tap&nbsp;
                          <strong>Scan</strong>. Kyro will show you only the one you just connected.
                        </>
                      )}
                    </p>
                  </div>
                  <button type="button" onClick={detect}
                    className="px-5 py-2 rounded-lg text-sm font-medium text-white"
                    style={{ background: "#4f46e5" }}>
                    Scan
                  </button>
                </div>
              )}

              {detecting && (
                <div className="rounded-xl p-6 flex flex-col items-center gap-2"
                  style={{ background: "var(--bg-inset)", border: "1px dashed var(--border-strong)" }}>
                  <Loader2 size={22} className="animate-spin text-indigo-400" />
                  <p className="text-sm text-white">Scanning for the camera you just plugged in…</p>
                  <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                    Your browser may ask for camera permission. Allow it so Kyro can read the connected camera.
                  </p>
                </div>
              )}

              {/* After a scan, show results. */}
              {scanned && !detecting && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      {newDevices.length > 0 ? `New camera${newDevices.length !== 1 ? "s" : ""} detected` : "Scan result"}
                    </p>
                    <button type="button" onClick={detect} disabled={detecting}
                      className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}>
                      <RefreshCw size={11} /> Scan again
                    </button>
                  </div>

                  {detectErr && (
                    <div className="rounded-xl p-3 flex items-start gap-2"
                      style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}>
                      <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-200">{detectErr}</p>
                    </div>
                  )}

                  {newDevices.length > 0 && (
                    <div className="flex flex-col gap-3">
                      {newDevices.map((d) => (
                        <DetectedDeviceCard
                          key={d.id}
                          device={d}
                          picked={pickedId === d.id}
                          onPick={() => pickDevice(d)}
                          onReject={() => rejectDevice(d.id)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Escape hatch — the user may genuinely want to use a
                      camera that was already connected before they opened
                      this page. Hidden by default so built-ins don't clutter
                      the common path. */}
                  {allDevices.length > newDevices.length && (
                    <div>
                      <button type="button" onClick={() => setShowAll((v) => !v)}
                        className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {showAll
                          ? "Hide already-connected cameras"
                          : `Show already-connected cameras (${allDevices.length - newDevices.length})`}
                      </button>
                      {showAll && (
                        <div className="flex flex-col gap-3 mt-2">
                          {allDevices
                            .filter((d) => !newDevices.find((n) => n.id === d.id))
                            .map((d) => (
                              <DetectedDeviceCard
                                key={d.id}
                                device={d}
                                picked={pickedId === d.id}
                                onPick={() => pickDevice(d)}
                                onReject={() => rejectDevice(d.id)}
                              />
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* IP / RTSP / advanced URL mode — the old form path, kept for
              cameras that don't physically plug into this device. */}
          {(mode === "ip" || mode === "advanced") && type && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setMode(null); setType(null); setUrl(""); setTransmitterPath(null); }}
                  className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                  ← Back
                </button>
              </div>
              {transmitterPath === "network" && (
                <div className="rounded-xl px-3 py-2.5 text-xs flex items-start gap-2"
                  style={{ background: "rgba(236,72,153,0.08)", border: "1px solid rgba(236,72,153,0.3)", color: "var(--text-tertiary)" }}>
                  <Radio size={13} style={{ color: "#ec4899" }} className="shrink-0 mt-0.5" />
                  <span>
                    Pick your transmitter's protocol below, then paste the stream address shown in its
                    control app. NDI sources appear by their name (e.g. <span className="font-mono">CHURCH-TX1 (Camera)</span>).
                  </span>
                </div>
              )}
              {mode === "ip" && (
                <div className="flex flex-wrap gap-1.5">
                  {CAMERA_TYPES.filter((t) => t.id !== "other").map((t) => {
                    const Icon = t.icon;
                    const active = type.id === t.id;
                    return (
                      <button key={t.id} type="button" onClick={() => { setType(t); setUrl(t.urlTemplate); }}
                        className="rounded-lg px-2.5 py-1.5 text-xs transition-colors flex items-center gap-1"
                        style={{
                          background: active ? "rgba(99,102,241,0.15)" : "var(--bg-inset)",
                          border: `1px solid ${active ? "#4f46e5" : "var(--border-subtle)"}`,
                          color: active ? "#a5b4fc" : "var(--text-muted)",
                        }}>
                        <Icon size={11} />
                        <span className="truncate">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Shared name + zone + capacity form — shown once a mode is chosen
              and (for IP/advanced) a type is selected OR (for detect) a device
              is picked. Writes to the same storage either way. */}
          {(mode === "ip" || mode === "advanced" || (mode === "detect" && pickedId)) && (
            <form onSubmit={handleAdd} className="flex flex-col gap-3">

              {/* Name + zone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: "var(--text-muted)" }}>Camera name</label>
                  <input value={name} onChange={(e) => handleNameChange(e.target.value)} required
                    placeholder="e.g. Main Auditorium"
                    className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs" style={{ color: "var(--text-muted)" }}>Zone / area name</label>
                  <input value={zone} onChange={(e) => setZone(e.target.value)}
                    placeholder="e.g. Main Floor, Balcony"
                    className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
                </div>
              </div>

              {/* Smart queue detection prompt */}
              {queuePrompt === "asking" && (
                <div className="rounded-xl p-4 flex flex-col gap-3"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}>
                  <div className="flex items-start gap-2.5">
                    <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-white mb-0.5">Is this an outdoor or queue camera?</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                        It looks like this camera might be watching an outside area or entrance queue —
                        not a seated room. Outdoor cameras don't have seats — they count
                        how many people are waiting outside to come in.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button type="button" onClick={() => confirmQueue(true)}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                      style={{ background: "rgba(245,158,11,0.7)" }}>
                      <Users size={14} /> Yes, outdoor / queue
                    </button>
                    <button type="button" onClick={() => confirmQueue(false)}
                      className="px-4 py-2 rounded-lg text-sm"
                      style={{ background: "var(--bg-hover)", color: "var(--text-tertiary)" }}>
                      No, it has seats
                    </button>
                  </div>
                </div>
              )}

              {(queuePrompt === "confirmed" || isQueueCam) && (
                <div className="rounded-xl px-4 py-3 flex items-center gap-2.5"
                  style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <Users size={14} className="text-amber-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-amber-300">Outdoor / queue camera</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Counts people outside; no seat capacity needed.
                    </p>
                  </div>
                  <button type="button" onClick={() => { setIsQueueCam(false); setQueuePrompt("dismissed"); }}
                    className="shrink-0" style={{ color: "var(--text-faint)" }}>
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Stream address — only shown when the user is going through
                  the IP/advanced URL path. The detect path has already
                  filled in a webcam://<deviceId> URL from the picked card. */}
              {(mode === "ip" || mode === "advanced") && type && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs" style={{ color: "var(--text-muted)" }}>Stream address</label>
                    <input value={url} onChange={(e) => setUrl(e.target.value)} required
                      placeholder={type.urlPlaceholder}
                      className="text-sm rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                      style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>{type.urlHint}</p>
                  </div>
                  {!isQueueCam && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs" style={{ color: "var(--text-muted)" }}>Seat capacity (optional)</label>
                      <input value={cap} onChange={(e) => setCap(e.target.value)}
                        type="number" inputMode="numeric" min="0" placeholder="e.g. 250"
                        className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                        style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
                    </div>
                  )}
                </div>
              )}

              {/* Capacity on its own in detect mode (URL is already set) */}
              {mode === "detect" && !isQueueCam && (
                <div className="flex flex-col gap-1 max-w-xs">
                  <label className="text-xs" style={{ color: "var(--text-muted)" }}>Seat capacity (optional)</label>
                  <input value={cap} onChange={(e) => setCap(e.target.value)}
                    type="number" inputMode="numeric" min="0" placeholder="e.g. 250"
                    className="text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }} />
                </div>
              )}

              {err && <p className="text-red-400 text-xs">{err}</p>}

              <button type="submit" disabled={adding || !canSubmit}
                className="w-full sm:w-auto sm:self-start text-sm rounded-lg px-5 py-2.5 font-medium text-white disabled:opacity-40"
                style={{ background: "#4f46e5" }}>
                {adding ? "Adding…" : "Add camera"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Live mode on the Cloudflare build: camera computers ─────────────────────

const SETUP_GUIDE = "https://kyro-help.kharischurch.com/guides/camera-setup";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function PairingSteps({ code, expiresAt }: { code: string; expiresAt: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.35)" }}>
      <p className="text-xs text-gray-400">Your pairing code</p>
      <p className="font-mono font-bold text-white tracking-widest break-all" style={{ fontSize: "clamp(28px, 9vw, 40px)" }}>{code}</p>
      <p className="text-sm text-gray-300">
        Install Kyro on the computer the camera plugs into — yours or the church&apos;s, any one works. This line
        includes the code, so there&apos;s nothing to type. Then plug in your cameras: they appear here by themselves.{" "}
        <a href={SETUP_GUIDE} target="_blank" rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline inline-flex items-center gap-1">
          Step-by-step help <ExternalLink size={11} />
        </a>
      </p>
      <InstallCommand code={code} />
      <p className="text-xs text-gray-500">
        This code works once and expires at {new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
      </p>
    </div>
  );
}

function CameraComputersSection({ devices, error, onChanged }: {
  devices: EdgeDevice[] | null;
  error: string | null;
  onChanged: () => void;
}) {
  const [pairing, setPairing]   = useState<{ code: string; expires_at: string } | null>(null);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [confirmId, setConfirm] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function getCode() {
    setBusy(true); setErr(null);
    try { setPairing(await edgeVenueApi.pairingCode()); }
    catch (e: any) { setErr(e?.message ?? "Couldn't get a pairing code"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setRemoving(true); setErr(null);
    try { await edgeVenueApi.removeDevice(id); setConfirm(null); onChanged(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't remove that camera computer"); }
    finally { setRemoving(false); }
  }

  const pairButton = (
    <button onClick={getCode} disabled={busy}
      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 self-start">
      <KeyRound size={14} /> {busy ? "Getting a code…" : pairing ? "Get a new code" : "Pair a camera computer"}
    </button>
  );

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Camera computers{devices && devices.length > 0 ? ` (${devices.length})` : ""}
      </p>
      <div className="flex flex-col gap-3">
        {error && !devices && <p className="text-xs text-amber-400">Couldn't load camera computers: {error}</p>}

        {devices && devices.length === 0 && !pairing && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <Cpu size={18} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white mb-1">No camera computer yet</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Kyro counts people using a computer at church that your cameras plug into.
                  Pair that computer once and every camera connected to it shows up here by itself —
                  nothing else to type in.
                </p>
              </div>
            </div>
            {pairButton}
          </div>
        )}

        {devices && devices.map((d) => (
          <div key={d.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${d.online ? "bg-green-500" : "bg-gray-600"}`}
                title={d.online ? "Online" : "Offline"} />
              <p className="text-sm font-semibold text-white truncate">{d.name}</p>
              <button onClick={() => setConfirm(d.id)}
                className="ml-auto text-gray-600 hover:text-red-400 transition-colors shrink-0"
                title="Remove camera computer" aria-label="Remove camera computer">
                <Trash2 size={13} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {d.online ? "Online" : "Offline"} · last seen {timeAgo(d.last_seen)}
              {" · "}{d.cameras} camera{d.cameras === 1 ? "" : "s"}
              {d.version ? ` · version ${d.version}` : ""}
            </p>
            {confirmId === d.id && (
              <div className="mt-3 rounded-xl px-4 py-3 flex flex-col gap-2"
                style={{ background: "rgba(185,28,28,0.1)", border: "1px solid rgba(185,28,28,0.4)" }}>
                <p className="text-sm font-semibold text-white">Remove "{d.name}"?</p>
                <p className="text-xs text-gray-400">
                  Its cameras will stop counting. To use it again you'll need to pair it with a new code.
                </p>
                <div className="flex gap-2 mt-1">
                  <button onClick={() => remove(d.id)} disabled={removing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-700 hover:bg-red-600 disabled:opacity-50">
                    <Trash2 size={11} /> {removing ? "Removing…" : "Yes, remove it"}
                  </button>
                  <button onClick={() => setConfirm(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white bg-gray-800">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {pairing && <PairingSteps code={pairing.code} expiresAt={pairing.expires_at} />}
        {devices && (devices.length > 0 || pairing) && pairButton}
        {err && <p className="text-red-400 text-xs">{err}</p>}
      </div>
    </div>
  );
}

function SwitchedOffCameras({ cameras, onChanged }: { cameras: EdgeCamera[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  if (cameras.length === 0) return null;

  async function switchOn(id: string) {
    setBusyId(id); setErr(null);
    try { await edgeVenueApi.updateCamera(id, { hidden: false }); onChanged(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't switch it back on"); }
    finally { setBusyId(null); }
  }

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Switched off ({cameras.length})
      </p>
      <div className="flex flex-col gap-2">
        {cameras.map((c) => (
          <div key={c.camera_id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
            <Power size={14} className="text-gray-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-300 truncate">{c.name}</p>
              <p className="text-xs text-gray-600 truncate">{c.stream_url}</p>
            </div>
            <button onClick={() => switchOn(c.camera_id)} disabled={busyId === c.camera_id}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
              {busyId === c.camera_id ? "Switching on…" : "Switch back on"}
            </button>
          </div>
        ))}
        {err && <p className="text-red-400 text-xs">{err}</p>}
      </div>
    </div>
  );
}

function EdgeAddCameraForm({ onAdded, cameraCount, devices }: {
  onAdded: () => void;
  cameraCount: number;
  devices: EdgeDevice[];
}) {
  const { addCamera } = useCameras();
  const [open, setOpen]     = useState(false);
  const [name, setName]     = useState("");
  const [url, setUrl]       = useState("");
  const [cap, setCap]       = useState("");
  const [deviceId, setDev]  = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAdding(true); setErr(null);
    try {
      if (devices.length > 1 && deviceId) {
        // Several camera computers: say which one should run it.
        await edgeVenueApi.addStream({ url: url.trim(), name: name.trim(), zone_name: name.trim(), zone_capacity: parseInt(cap, 10) || 0, device_id: deviceId });
      } else {
        await addCamera({ name: name.trim(), stream_url: url.trim(), zone_name: name.trim(), zone_capacity: parseInt(cap, 10) || 0, zone_order: cameraCount });
      }
      setName(""); setUrl(""); setCap(""); setOpen(false);
      onAdded();
    } catch (e: any) { setErr(e?.message ?? "Couldn't add that camera"); }
    finally { setAdding(false); }
  }

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 hover:bg-gray-800 transition-colors">
        <div className="flex items-center gap-2">
          <Plus size={15} className="text-indigo-400" />
          <span className="text-sm font-medium text-white">Add a network IP camera to a specific camera computer</span>
        </div>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>
      {open && (
        <form onSubmit={handleAdd} className="bg-gray-900 border-t border-gray-800 p-4 flex flex-col gap-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            For network (Wi-Fi/ethernet) cameras. USB cameras don't need this — just plug them into the camera computer.
          </p>
          {devices.length === 0 && (
            <p className="text-xs text-amber-400">Pair a camera computer first — it's what connects to the camera.</p>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Camera's address</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} required
              placeholder="rtsp://192.168.1.100/stream" autoComplete="off" spellCheck={false}
              className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono min-w-0" />
            <p className="text-xs text-gray-600">Found in the camera's app or settings — usually starts with rtsp://</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Camera name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Balcony"
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Seat capacity (optional)</label>
              <input value={cap} onChange={(e) => setCap(e.target.value)} type="number" min="0" placeholder="e.g. 250"
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          {devices.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Which camera computer can see it?</label>
              <select value={deviceId} onChange={(e) => setDev(e.target.value)} required
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Choose…</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <button type="submit" disabled={adding || devices.length === 0}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-2 font-medium self-start">
            {adding ? "Adding…" : "Add camera"}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function HelpPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
      <button onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
        <div className="flex items-center gap-2">
          <HelpCircle size={14} />
          <span>Camera won't connect? Here's what to check</span>
        </div>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 text-xs flex flex-col gap-3"
          style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-tertiary)" }}>
          <div>
            <p className="text-white font-medium mb-1">USB webcam or built-in camera</p>
            <p>
              Just plug it in and tap <strong>Plugged into this device</strong> above. Kyro
              will show you every camera the browser can see with a live preview. If a camera
              is missing, close any other app that might be using it (Zoom, FaceTime, Teams)
              and tap <strong>Scan again</strong>.
            </p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">Phone / iPad</p>
            <p>
              Open this page on the phone itself. The browser will offer both the front and
              rear cameras after you tap <strong>Plugged into this device</strong>.
            </p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">IP cameras (Hikvision, Reolink, TP-Link, Dahua…)</p>
            <p>
              Pick <strong>Network IP camera</strong> above, then paste the RTSP URL from your
              camera's app → Settings → Network. Format:
              <span className="font-mono text-indigo-300"> rtsp://admin:password@192.168.1.100:554/stream</span>
            </p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">Wireless HDMI transmitter (Teradek, Hollyland, Accsoon…)</p>
            <p>
              Pick <strong>Through a wireless transmitter → Receiver plugs into USB</strong>. Plug the
              receiver's HDMI out into a USB capture dongle (Elgato Cam Link, Magewell), plug that
              into this device, and Kyro will see it as a plug-and-play camera.
            </p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">NDI / SRT / RTMP transmitter</p>
            <p>
              Pick <strong>Through a wireless transmitter → Network stream</strong>. In the IP form,
              pick the matching protocol chip (NDI, SRT) and paste the address from the transmitter's
              control app. NDI sources show up by their LAN name, e.g.
              <span className="font-mono text-indigo-300"> ndi://CHURCH-TX1 (Camera)</span>.
            </p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">Browser blocked the camera?</p>
            <p>
              Click the padlock icon next to the URL in your browser's address bar → set the
              Camera permission to Allow → reload this page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CamerasPage() {
  const { cameras, loading, error, refresh, updateCamera, deleteCamera } = useCameras();
  const { role } = useAuth();
  // Operators run the services in-building and need to add cameras too — the
  // previous admin-only gate meant anyone signed in as an operator saw the
  // Cameras page as read-only with no way to add anything. Admin + operator
  // both get the manage controls; viewers stay read-only.
  const canManage = role === "admin" || role === "operator";

  // Live mode on the Cloudflare build — decided after mount (reads localStorage).
  const [edge, setEdge] = useState(false);
  useEffect(() => { setEdge(isEdgeLive()); }, []);

  const [devices, setDevices]       = useState<EdgeDevice[] | null>(null);
  const [devicesErr, setDevicesErr] = useState<string | null>(null);
  const [switchedOff, setOff]       = useState<EdgeCamera[]>([]);
  const [tick, setTick]             = useState(0);
  const reloadEdge = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!edge || !canManage) return;
    let alive = true;
    const load = async () => {
      try { const d = await edgeVenueApi.devices(); if (alive) { setDevices(d); setDevicesErr(null); } }
      catch (e: any) { if (alive) setDevicesErr(e?.message ?? "Couldn't reach the server"); }
      try { const all = await edgeVenueApi.cameras(true); if (alive) setOff(all.filter((c) => c.hidden)); }
      catch { /* non-fatal */ }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [edge, canManage, tick]);

  const afterEdgeChange = () => { reloadEdge(); refresh(); };
  const deleteAndReload = async (id: string) => { await deleteCamera(id); reloadEdge(); };

  return (
    <div className="flex min-h-screen text-gray-100" style={{ background: "var(--bg-base)" }}>
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0 p-3 sm:p-6 max-w-2xl">

        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Cameras</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {edge
              ? (canManage ? "Plug a camera into your camera computer and Kyro asks whether to add it" : "The cameras Kyro is watching")
              : (canManage ? "Add cameras and rename zones any time" : "The cameras Kyro is watching")}
          </p>
        </div>

        {/* Previously showed a 'Local-only mode (no backend)' banner. Removed —
            operators were understandably confused why Live mode would advertise
            itself as 'local-only'. Cameras added here still persist, same as
            any Kyro deployment. */}

        {edge && canManage && (
          <CameraComputersSection devices={devices} error={devicesErr} onChanged={afterEdgeChange} />
        )}

        {error && (edge
          ? <p className="text-xs text-amber-400 mb-3">Couldn't refresh the camera list: {error}</p>
          : <ErrorMessage message={error} onRetry={refresh} />
        )}

        {(!error || edge) && loading && (
          <p className="text-sm text-gray-500 py-8 text-center">Loading cameras…</p>
        )}

        {(!error || edge) && !loading && cameras.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {edge ? "Cameras" : "Registered"} ({cameras.length})
            </p>
            <div className="flex flex-col gap-3">
              {cameras.map((cam) => (
                <CameraCard key={cam.camera_id} cam={cam} onUpdated={refresh} onUpdate={updateCamera}
                  onDelete={edge ? deleteAndReload : deleteCamera} canManage={canManage} edge={edge} />
              ))}
            </div>
          </div>
        )}

        {edge && !loading && cameras.length === 0 && !canManage && (
          <p className="text-sm text-gray-500 py-6 text-center">No cameras are connected yet.</p>
        )}

        {edge && canManage && <SwitchedOffCameras cameras={switchedOff} onChanged={afterEdgeChange} />}

        {/* Plug-and-play detector — covers USB webcam, phone, built-in
            laptop camera. Shown on EVERY deployment (edge or not) and does
            NOT depend on the useCameras() error state so a transient
            edge-API hiccup can't hide the add form. */}
        {canManage && (
          <AddCameraForm onAdded={edge ? afterEdgeChange : refresh} cameraCount={cameras.length} />
        )}
        {/* Edge-specific IP-camera form kept for multi-device setups where
            the operator needs to choose which camera computer runs the
            stream. Only shown when at least one camera computer is paired. */}
        {edge && canManage && !loading && (devices?.length ?? 0) > 0 && (
          <EdgeAddCameraForm onAdded={afterEdgeChange} cameraCount={cameras.length} devices={devices ?? []} />
        )}
        {!canManage && (
          <p className="text-xs text-gray-500 rounded-xl px-4 py-3" style={{ border: "1px solid var(--border-subtle)" }}>
            Only administrators and operators can add, change or remove cameras.
          </p>
        )}

        <div className="mt-4">
          <HelpPanel />
        </div>

      </main>
    </div>
  );
}
