"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { camerasApi, seatsApi, ApiError } from "@/lib/api";
import { DEMO_MODE, DEMO_CAMERAS } from "@/lib/demo";
import { isEdgeLive } from "@/lib/edgeAuth";
import { edgeVenueApi } from "@/lib/edgeVenue";
import type { Camera } from "@/types";

function isLiveMode(): boolean { if (typeof window === "undefined") return false; return localStorage.getItem("kyro_mode") === "live"; }
const inDemoMode = () => typeof window !== "undefined" && (localStorage.getItem("kyro_mode") === "demo" || !process.env.NEXT_PUBLIC_API_URL);

// Mode-scoped storage keys. Live and Demo mode now keep COMPLETELY SEPARATE
// camera lists — adding, overriding or deleting a camera in one mode cannot
// bleed into the other. Previously the keys were shared, which is why
// Service Rota's Camera Zone picker showed Demo cameras even in Live mode.
function mdeKey(name: "overrides" | "added" | "deleted"): string {
  const mode = typeof window === "undefined" ? "demo" : (localStorage.getItem("kyro_mode") ?? "demo");
  return `kyro_${mode}_cameras_${name}`;
}

/**
 * A "browser camera" is one the user picked via the plug-and-play detector:
 * their phone, laptop or USB webcam, identified by a MediaDevices deviceId.
 * These cannot be processed by the edge camera computer (the box doesn't
 * have access to the user's browser), so we persist them LOCALLY and merge
 * them into every refresh — otherwise the server would overwrite them with
 * its own camera list the moment the user navigates away.
 */
function isBrowserCameraUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith("webcam://");
}
function loadLocalAddedCameras(): Camera[] {
  try { return JSON.parse(localStorage.getItem(mdeKey("added")) ?? "[]") as Camera[]; }
  catch { return []; }
}
function saveLocalAddedCameras(cams: Camera[]) {
  try { localStorage.setItem(mdeKey("added"), JSON.stringify(cams)); } catch {}
}

function loadDemoCameras(): Camera[] {
  // Seed the fake DEMO_CAMERAS only when the user explicitly picked Demo.
  // In Live mode without a backend, start from an empty base — the operator
  // adds their real cameras via the Cameras page.
  const seedDemo = localStorage.getItem("kyro_mode") === "demo";
  const base: Camera[] = seedDemo ? (DEMO_CAMERAS as Camera[]) : [];
  try {
    const overrides:  Record<string, Partial<Camera>> = JSON.parse(localStorage.getItem(mdeKey("overrides")) ?? "{}");
    const extra:      Camera[]  = JSON.parse(localStorage.getItem(mdeKey("added"))     ?? "[]");
    const deletedIds: string[]  = JSON.parse(localStorage.getItem(mdeKey("deleted"))   ?? "[]");
    const merged = base
      .filter((c) => !deletedIds.includes(c.camera_id))
      .map((c) => overrides[c.camera_id] ? { ...c, ...overrides[c.camera_id] } : c);
    return [...merged, ...extra.filter((c) => !deletedIds.includes(c.camera_id))];
  } catch { return base; }
}

function saveDemoOverride(cameraId: string, fields: Partial<Camera>) {
  try {
    const overrides: Record<string, Partial<Camera>> = JSON.parse(localStorage.getItem(mdeKey("overrides")) ?? "{}");
    overrides[cameraId] = { ...(overrides[cameraId] ?? {}), ...fields };
    localStorage.setItem(mdeKey("overrides"), JSON.stringify(overrides));
  } catch {}
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface CameraContextValue {
  cameras:      Camera[];
  loading:      boolean;
  error:        string | null;
  refresh:      () => Promise<void>;
  updateCamera: (id: string, fields: Partial<Camera>) => Promise<void>;
  addCamera:    (fields: { name: string; stream_url: string; location?: string; zone_name?: string; zone_capacity?: number; zone_order?: number }) => Promise<void>;
  deleteCamera: (id: string) => Promise<void>;
}

const CameraContext = createContext<CameraContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CameraProvider({ children }: { children: ReactNode }) {
  // Start with empty list — populated after mount so SSR and client always agree
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Live mode on the Cloudflare build: real cameras reported by the camera
    // computer at church (worker/venue.js). Checked before inDemoMode(),
    // which is also true here because there's no API URL.
    if (isEdgeLive()) {
      try {
        const server = await edgeVenueApi.cameras();
        // Merge in browser cameras the user added via the plug-and-play
        // detector. The edge box can't see those (they live in the user's
        // phone/laptop) so the server list wouldn't include them, but we
        // still want them to appear in the sidebar, Sessions, Seat Map and
        // Rota the same way any other camera does.
        const local = loadLocalAddedCameras().filter((c) => isBrowserCameraUrl(c.stream_url));
        const serverIds = new Set(server.map((c) => c.camera_id));
        setCameras([...server, ...local.filter((c) => !serverIds.has(c.camera_id))]);
        setError(null);
      } catch (e: any) {
        // Even when the edge API is unreachable, surface the local browser
        // cameras so the user doesn't lose them.
        setCameras(loadLocalAddedCameras().filter((c) => isBrowserCameraUrl(c.stream_url)));
        setError(e?.message ?? "Could not load cameras");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (inDemoMode()) {
      setCameras(loadDemoCameras());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setCameras(await camerasApi.list());
    } catch (e: any) {
      // 401 = token expired or missing — let the auth hook handle redirect
      if (e instanceof ApiError && e.status === 401) {
        setError("Session expired. Please log in again.");
      } else {
        setError(e.message ?? "Could not load cameras");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Hydrate on client mount — avoids SSR/client mismatch
  useEffect(() => { refresh(); }, [refresh]);

  // Edge Live: poll so a newly plugged-in camera appears without a reload.
  useEffect(() => {
    if (!isEdgeLive()) return;
    const id = setInterval(() => { refresh(); }, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const updateCamera = useCallback(async (cameraId: string, fields: Partial<Camera>) => {
    setCameras((prev) => prev.map((c) => c.camera_id === cameraId ? { ...c, ...fields } : c));
    // Browser cameras live in local storage — persist edits there so a
    // rename or capacity change survives a reload. Prefix "web-" matches
    // what addCamera() assigns.
    if (cameraId.startsWith("web-")) {
      const saved = loadLocalAddedCameras();
      const idx = saved.findIndex((c) => c.camera_id === cameraId);
      if (idx >= 0) {
        saved[idx] = { ...saved[idx], ...fields };
        saveLocalAddedCameras(saved);
      }
      return;
    }
    if (isEdgeLive()) {
      const f = fields as Partial<Camera> & { hidden?: boolean };
      await edgeVenueApi.updateCamera(cameraId, {
        name:          f.name          ?? undefined,
        zone_name:     f.zone_name     ?? undefined,
        zone_capacity: f.zone_capacity ?? undefined,
        zone_order:    f.zone_order    ?? undefined,
        // The Cameras page sends location: undefined for "Indoor (has seats)".
        location:      "location" in f ? (f.location === "queue" ? "queue" : "indoor") : undefined,
        hidden:        f.hidden,
      });
      return;
    }
    if (inDemoMode()) { saveDemoOverride(cameraId, fields); return; }
    await camerasApi.update(cameraId, {
      name:          fields.name          ?? undefined,
      zone_name:     fields.zone_name     ?? undefined,
      stream_url:    fields.stream_url    ?? undefined,
      zone_capacity: fields.zone_capacity ?? undefined,
    });
  }, []);

  const addCamera = useCallback(async (
    fields: { name: string; stream_url: string; location?: string; zone_name?: string; zone_capacity?: number; zone_order?: number }
  ) => {
    const isQueue = fields.location === "queue";
    const capacity = fields.zone_capacity ?? 0;
    const browserCam = isBrowserCameraUrl(fields.stream_url);

    // Browser cameras — picked from the plug-and-play detector — live only
    // on the user's device. Save them to local storage so they survive page
    // navigation and so the sidebar, Sessions, Seat Map and Rota all see
    // them. We skip edgeVenueApi.addStream for these because the server
    // doesn't know what a webcam://<deviceId> URL means and would reject or
    // drop the record on the next refresh.
    if (browserCam) {
      const newCam: Camera = {
        camera_id:     `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name:          fields.name,
        stream_url:    fields.stream_url,
        location:      fields.location ?? null,
        zone_name:     fields.zone_name ?? fields.name,
        zone_capacity: capacity,
        zone_order:    fields.zone_order ?? 99,
        is_active:     true,
        created_at:    new Date().toISOString(),
      };
      const saved = loadLocalAddedCameras();
      saved.push(newCam);
      saveLocalAddedCameras(saved);
      setCameras((prev) => [...prev, newCam]);

      // Auto-generate a seat layout so the Seat Map shows this camera right
      // away — same behaviour the demo path uses.
      if (!isQueue && capacity > 0) {
        try {
          const LAYOUTS_KEY = `kyro_${localStorage.getItem("kyro_mode") ?? "demo"}_layouts`;
          const { generateSeatsFromCapacity } = await import("@/lib/seatGenerator");
          const seats = generateSeatsFromCapacity(capacity);
          const layouts = JSON.parse(localStorage.getItem(LAYOUTS_KEY) ?? "{}");
          layouts[newCam.camera_id] = {
            id: Date.now(), camera_id: newCam.camera_id,
            name: `${fields.name} — auto`, is_active: true,
            seat_count: seats.length, created_at: new Date().toISOString(), seats,
          };
          localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
        } catch {}
      }
      return;
    }

    if (isEdgeLive()) {
      // A network camera: the camera computer picks the address up on its next report.
      const { camera_id } = await edgeVenueApi.addStream({
        url: fields.stream_url, name: fields.name,
        zone_name: fields.zone_name, zone_capacity: fields.zone_capacity,
      });
      if (isQueue) await edgeVenueApi.updateCamera(camera_id, { location: "queue" }).catch(() => {});
      await refresh();
      return;
    }

    if (inDemoMode()) {
      const newCam: Camera = {
        camera_id:     `demo-custom-${Date.now()}`,
        name:          fields.name,
        stream_url:    fields.stream_url,
        location:      fields.location ?? null,
        zone_name:     fields.zone_name ?? fields.name,
        zone_capacity: capacity,
        zone_order:    fields.zone_order ?? 99,
        is_active:     true,
        created_at:    new Date().toISOString(),
      };
      setCameras((prev) => [...prev, newCam]);
      try {
        const saved: Camera[] = JSON.parse(localStorage.getItem(mdeKey("added")) ?? "[]");
        saved.push(newCam);
        localStorage.setItem(mdeKey("added"), JSON.stringify(saved));
      } catch {}

      // Auto-generate a demo seat layout for indoor cameras with capacity
      if (!isQueue && capacity > 0) {
        try {
          const DEMO_LAYOUTS_KEY = "kyro_demo_layouts";
          const { generateSeatsFromCapacity } = await import("@/lib/seatGenerator");
          const seats = generateSeatsFromCapacity(capacity);
          const layouts = JSON.parse(localStorage.getItem(DEMO_LAYOUTS_KEY) ?? "{}");
          layouts[newCam.camera_id] = {
            id: Date.now(), camera_id: newCam.camera_id,
            name: `${fields.name} — auto`, is_active: true,
            seat_count: seats.length, created_at: new Date().toISOString(), seats,
          };
          localStorage.setItem(DEMO_LAYOUTS_KEY, JSON.stringify(layouts));
        } catch {}
      }
      return;
    }

    const created = await camerasApi.create(fields);
    setCameras((prev) => [...prev, created]);

    // Auto-generate and activate a layout for indoor cameras with capacity
    if (!isQueue && capacity > 0) {
      seatsApi.autoGenerateLayout(created.camera_id, created.name, capacity)
        .catch(() => {}); // non-fatal — user can draw manually if this fails
    }
  }, [refresh]);

  const deleteCamera = useCallback(async (cameraId: string) => {
    setCameras((prev) => prev.filter((c) => c.camera_id !== cameraId));
    // Browser cameras — remove from local storage only.
    if (cameraId.startsWith("web-")) {
      const saved = loadLocalAddedCameras().filter((c) => c.camera_id !== cameraId);
      saveLocalAddedCameras(saved);
      return;
    }
    if (isEdgeLive()) { await edgeVenueApi.removeCamera(cameraId); return; }
    if (inDemoMode()) {
      try {
        const deleted: string[] = JSON.parse(localStorage.getItem(mdeKey("deleted")) ?? "[]");
        if (!deleted.includes(cameraId)) deleted.push(cameraId);
        localStorage.setItem(mdeKey("deleted"), JSON.stringify(deleted));
        const added: Camera[] = JSON.parse(localStorage.getItem(mdeKey("added")) ?? "[]");
        localStorage.setItem(mdeKey("added"), JSON.stringify(added.filter((c) => c.camera_id !== cameraId)));
      } catch {}
      return;
    }
    await camerasApi.delete(cameraId);
  }, []);

  return (
    <CameraContext.Provider value={{ cameras, loading, error, refresh, updateCamera, addCamera, deleteCamera }}>
      {children}
    </CameraContext.Provider>
  );
}

export function useCameraContext() {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error("useCameraContext must be used inside CameraProvider");
  return ctx;
}
