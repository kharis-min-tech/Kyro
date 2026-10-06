"use client";

import { useCallback, useEffect, useState } from "react";
import { registerEdgeDevice, unregisterEdgeDevice } from "@/lib/edgePush";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

/**
 * How notifications reach this device:
 *  - "server": FastAPI backend (NEXT_PUBLIC_API_URL) stores the subscription
 *    and pushes on real capacity / camera events.
 *  - "edge":   Cloudflare Worker (worker/index.js) sends real Web Push —
 *    lock screen / app closed works — for test + demo alerts.
 *  - "local":  no push sender reachable; the service worker shows the
 *    notification itself, so it only fires while Kyro is open.
 */
export type PushMode = "server" | "edge" | "local";

export interface PushState {
  supported:   boolean;
  permission:  PermissionState;
  subscribed:  boolean;
  loading:     boolean;
  error:       string | null;
  mode:        PushMode;
  subscribe:   (opts?: { warnThreshold?: number; critThreshold?: number; notifyOffline?: boolean }) => Promise<void>;
  unsubscribe: () => Promise<void>;
  /** Resolves true when the test notification was handed off successfully. */
  sendTest:    () => Promise<boolean>;
  /** Fires the sequence of sample alerts; resolves to a status message. */
  sendDemo:    () => Promise<string>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

/** Get the best available auth token — real stored token first, then demo real token. */
async function getBestToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem("kyro_token");
  if (stored && !stored.includes("demo_signature_not_verified")) return stored;

  // Demo mode: check cached real token
  const cached = localStorage.getItem("kyro_real_token");
  if (cached) return cached;

  // Demo mode: fetch a real token now
  const user = process.env.NEXT_PUBLIC_DEMO_USER;
  const pass = process.env.NEXT_PUBLIC_DEMO_PASS;
  if (!user || !pass) return null;

  try {
    const res = await fetch(`${API_URL}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data.access_token as string;
    localStorage.setItem("kyro_real_token", token);
    return token;
  } catch {
    return null;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getBestToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

async function fetchVapidKey(): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/push/vapid-public-key`);
  if (!res.ok) throw new Error("Could not fetch VAPID key");
  return (await res.json()).publicKey as string;
}

/** VAPID key from the Cloudflare Worker, or null when no Worker is deployed
 *  (local `next dev`, NAS build) or it has no keys configured. */
async function fetchEdgeVapidKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-public-key", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    const key = (await res.json()).publicKey;
    return typeof key === "string" && key ? key : null;
  } catch {
    return null;
  }
}

async function edgeSend(sub: PushSubscription, kind: "test" | "demo"): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const res = await fetch("/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), kind }),
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({} as { error?: string; gone?: boolean }));
  return { ok: false, gone: res.status === 410 || data.gone === true, error: data.error ?? `Push failed (${res.status})` };
}

// `vibrate` and `requireInteraction` are valid Notification options on real
// browsers but missing from the DOM lib's NotificationOptions type.
type RichNotificationOptions = NotificationOptions & { vibrate?: number[]; requireInteraction?: boolean };

const LOCAL_DEMO_ALERTS: { title: string; body: string; level: string; url: string }[] = [
  { title: "⚠️ Main Floor filling up",   body: "82% of capacity (246 / 300)", level: "warning",  url: "/attendance" },
  { title: "🚨 Balcony overcrowded",      body: "93% of capacity (112 / 120)", level: "critical", url: "/attendance" },
  { title: "⚠️ Overflow Room filling up", body: "80% of capacity (64 / 80)",   level: "warning",  url: "/attendance" },
  { title: "🚨 Main Floor overcrowded",   body: "91% of capacity (273 / 300)", level: "critical", url: "/attendance" },
  { title: "⚠️ Stadium filling up",       body: "81% of capacity (810 / 1000)", level: "warning", url: "/attendance" },
  { title: "🎭 Kyro has a question",      body: "Someone moved toward the front — were they ushered?", level: "review", url: "/seating" },
];

async function registerWithBackend(
  sub: PushSubscription,
  opts: { warnThreshold: number; critThreshold: number; notifyOffline: boolean },
): Promise<void> {
  const json = sub.toJSON();
  const headers = await authHeader();
  const res = await fetch(`${API_URL}/api/v1/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      endpoint:       json.endpoint,
      keys:           json.keys,
      warn_threshold: opts.warnThreshold,
      crit_threshold: opts.critThreshold,
      notify_offline: opts.notifyOffline,
    }),
  });
  if (!res.ok) {
    // If 401, token may have expired — clear cache and retry once
    if (res.status === 401) {
      localStorage.removeItem("kyro_real_token");
      const freshHeaders = await authHeader();
      const retry = await fetch(`${API_URL}/api/v1/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...freshHeaders },
        body: JSON.stringify({
          endpoint:       json.endpoint,
          keys:           json.keys,
          warn_threshold: opts.warnThreshold,
          crit_threshold: opts.critThreshold,
          notify_offline: opts.notifyOffline,
        }),
      });
      if (!retry.ok) throw new Error((await retry.json().catch(() => ({}))).detail ?? "Failed to save subscription");
      return;
    }
    throw new Error((await res.json().catch(() => ({}))).detail ?? "Failed to save subscription");
  }
}

async function unregisterFromBackend(endpoint: string): Promise<void> {
  const headers = await authHeader();
  await fetch(
    `${API_URL}/api/v1/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
    { method: "DELETE", headers },
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePushNotifications(): PushState {
  const [supported,  setSupported]  = useState(false);
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [mode,       setMode]       = useState<PushMode>(API_URL ? "server" : "local");

  // On mount: detect support, read permission, and check if already subscribed
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    setPermission(Notification.permission as PermissionState);

    if (!API_URL) {
      fetchEdgeVapidKey().then((k) => setMode(k ? "edge" : "local"));
    }

    // Use navigator.serviceWorker.ready so we wait for the SW to be fully active
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((existing) => {
        if (existing) {
          setSubscribed(true);
          setPermission("granted"); // if they have a sub, permission must be granted
          if (API_URL) {
            // Silently re-register with backend in case it was missed
            registerWithBackend(existing, {
              warnThreshold: 0.80, critThreshold: 0.90, notifyOffline: true,
            }).catch(() => {});
          } else {
            // Refresh this device in the Worker's list (entries expire
            // after months of not opening Kyro).
            registerEdgeDevice(existing).catch(() => {});
          }
        } else if (!API_URL && localStorage.getItem("kyro_push_subscribed") === "1"
                   && Notification.permission === "granted") {
          // No backend: there's no Web Push subscription to find, but the
          // user previously enabled notifications in this browser (we
          // stored a flag). Honour that state so the Notifications page
          // doesn't show them as 'disabled' after a reload.
          setSubscribed(true);
        } else {
          setSubscribed(false);
        }
      })
      .catch(() => {});
  }, []);

  const subscribe = useCallback(async (opts?: {
    warnThreshold?: number; critThreshold?: number; notifyOffline?: boolean;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const reg = await getRegistration();

      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") throw new Error("Permission denied — please allow notifications");

      // No FastAPI backend: use the Cloudflare Worker as the push sender
      // when it's deployed, so notifications reach a locked phone / closed
      // app. Subscription lives only in this browser — the Worker is
      // stateless and receives it with each send request.
      if (!API_URL) {
        const edgeKey = await fetchEdgeVapidKey();
        if (edgeKey) {
          const existing = await reg.pushManager.getSubscription();
          // A subscription made with a different key can't be reused —
          // subscribe() would throw InvalidStateError.
          if (existing) await existing.unsubscribe().catch(() => {});
          const pushSub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(edgeKey),
          });
          setMode("edge");
          setSubscribed(true);
          localStorage.setItem("kyro_push_subscribed", "1");
          await registerEdgeDevice(pushSub, {
            warn: opts?.warnThreshold ?? 0.80,
            crit: opts?.critThreshold ?? 0.90,
          });
          const sent = await edgeSend(pushSub, "test");
          if (!sent.ok) throw new Error(sent.error ?? "Subscribed, but the welcome push failed");
          return;
        }

        // No push sender reachable at all: local notifications only.
        setMode("local");
        setSubscribed(true);
        localStorage.setItem("kyro_push_subscribed", "1");
        try {
          await reg.showNotification("Notifications enabled", {
            body: "Kyro will alert you here while the app is open. Lock-screen alerts need a backend.",
            icon:  "/icon-192.png",
            badge: "/icon-badge.png",
            tag:   "kyro-welcome",
          });
        } catch { /* best effort */ }
        return;
      }

      const vapidKey = await fetchVapidKey();
      const pushSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await registerWithBackend(pushSub, {
        warnThreshold: opts?.warnThreshold ?? 0.80,
        critThreshold: opts?.critThreshold ?? 0.90,
        notifyOffline: opts?.notifyOffline ?? true,
      });

      setSubscribed(true);
      localStorage.setItem("kyro_push_subscribed", "1");

      // Fire a welcome push immediately so the user sees it works right away
      try {
        const headers = await authHeader();
        await fetch(
          `${API_URL}/api/v1/push/test?endpoint=${encodeURIComponent(pushSub.endpoint)}`,
          { method: "POST", headers },
        );
      } catch { /* non-fatal */ }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Subscribe failed";
      setError(msg);
      console.error("[Kyro Push] subscribe error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reg    = await getRegistration();
      const pushSub = await reg.pushManager.getSubscription();
      if (pushSub) {
        if (API_URL) {
          await unregisterFromBackend(pushSub.endpoint).catch(() => {});
        } else {
          await unregisterEdgeDevice(pushSub.endpoint);
        }
        await pushSub.unsubscribe();
      }
      setSubscribed(false);
      localStorage.removeItem("kyro_push_subscribed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unsubscribe failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const sendTest = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const reg = await getRegistration();

      if (!API_URL) {
        const edgeSub = await reg.pushManager.getSubscription();
        if (edgeSub) {
          const sent = await edgeSend(edgeSub, "test");
          if (sent.ok) return true;
          if (sent.gone) {
            await unregisterEdgeDevice(edgeSub.endpoint);
            await edgeSub.unsubscribe().catch(() => {});
            setSubscribed(false);
            localStorage.removeItem("kyro_push_subscribed");
          }
          throw new Error(sent.error);
        }
      }

      // No backend: show a LOCAL notification via the service worker.
      // This appears on the phone as a real system notification (lock-screen
      // too if the PWA is installed), providing immediate proof that
      // notifications work in this browser/device — even without a backend
      // to send Web Push. The only difference vs. real Web Push: this only
      // fires while the Kyro tab/PWA is open; real Web Push can wake a
      // closed app.
      if (!API_URL) {
        if (Notification.permission !== "granted") {
          throw new Error("Permission denied — click Turn on first");
        }
        const opts: RichNotificationOptions = {
          body: "Nice — notifications are working on this device.",
          icon:  "/icon-192.png",
          badge: "/icon-badge.png",
          tag:   "kyro-test",
          vibrate: [200, 100, 200],
          requireInteraction: false,
        };
        await reg.showNotification("Kyro test notification", opts);
        return true;
      }

      const pushSub = await reg.pushManager.getSubscription();
      if (!pushSub) throw new Error("Not subscribed — click Turn on first");

      const headers = await authHeader();
      const res = await fetch(
        `${API_URL}/api/v1/push/test?endpoint=${encodeURIComponent(pushSub.endpoint)}`,
        { method: "POST", headers },
      );

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("kyro_real_token");
          const freshHeaders = await authHeader();
          const retry = await fetch(
            `${API_URL}/api/v1/push/test?endpoint=${encodeURIComponent(pushSub.endpoint)}`,
            { method: "POST", headers: freshHeaders },
          );
          if (!retry.ok) throw new Error((await retry.json().catch(() => ({}))).detail ?? "Test failed");
          return true;
        }
        throw new Error((await res.json().catch(() => ({}))).detail ?? "Test push failed");
      }
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Test failed");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const sendDemo = useCallback(async (): Promise<string> => {
    const reg = await getRegistration();

    if (API_URL) {
      const send = async () => fetch(`${API_URL}/api/v1/push/demo-alerts`, {
        method: "POST", headers: await authHeader(),
      });
      let res = await send();
      if (res.status === 401) { localStorage.removeItem("kyro_real_token"); res = await send(); }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "Failed to queue demo alerts");
      return "🔔 Sending demo alerts over the next ~10 seconds — lock your phone or minimise this tab to see them";
    }

    const edgeSub = await reg.pushManager.getSubscription();
    if (edgeSub) {
      const sent = await edgeSend(edgeSub, "demo");
      if (!sent.ok) throw new Error(sent.error);
      return "🔔 6 alerts arriving over the next ~12 seconds — lock your phone or minimise this tab to see them";
    }

    if (Notification.permission !== "granted") throw new Error("Turn notifications on first");
    LOCAL_DEMO_ALERTS.forEach((a, i) => {
      setTimeout(() => {
        const opts: RichNotificationOptions = {
          body: a.body, icon: "/icon-192.png", badge: "/icon-badge.png",
          tag: `kyro-demo-${i}`, data: { url: a.url, level: a.level },
          vibrate: [200, 100, 200], requireInteraction: a.level === "critical" || a.level === "review",
        };
        reg.showNotification(a.title, opts).catch(() => {});
      }, i * 2000);
    });
    return "🔔 6 alerts over the next ~12 seconds — keep Kyro open (lock-screen delivery needs the push server)";
  }, []);

  return { supported, permission, subscribed, loading, error, mode, subscribe, unsubscribe, sendTest, sendDemo };
}
