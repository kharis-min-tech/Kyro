/**
 * edgePush.ts — talks to the Cloudflare Worker (worker/index.js) that sends
 * Web Push when there's no FastAPI backend. Every call is best-effort: on a
 * build without the Worker (next dev, NAS) the requests just fail quietly.
 */

const PREFS_KEY = "kyro_notif_prefs";

function storedThresholds(): { warn: number; crit: number } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      warn: typeof p.warn === "number" ? p.warn : 0.8,
      crit: typeof p.crit === "number" ? p.crit : 0.9,
    };
  } catch { return { warn: 0.8, crit: 0.9 }; }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

/** Save this device in the Worker's list so it receives count alerts. */
export async function registerEdgeDevice(sub: PushSubscription, thresholds = storedThresholds()): Promise<boolean> {
  try {
    const res = await fetch("/api/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), warn: thresholds.warn, crit: thresholds.crit }),
    });
    return res.ok;
  } catch { return false; }
}

export async function unregisterEdgeDevice(endpoint: string): Promise<void> {
  try {
    await fetch("/api/push/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch { /* best effort */ }
}

/** Re-save this device with new thresholds (Notifications page sliders). */
export async function updateEdgeThresholds(warn: number, crit: number): Promise<boolean> {
  const sub = await currentSubscription();
  return sub ? registerEdgeDevice(sub, { warn, crit }) : false;
}

/**
 * Tell every leader's phone about a Manual Count. Only call in Live mode —
 * demo numbers must never wake real people up. The sending device is
 * excluded (the usher already sees their own count on screen).
 */
export async function notifyManualCount(ev: {
  kind: "count" | "approved";
  zone?: string;
  count: number;
  capacity?: number | null;
  counted_by?: string;
}): Promise<void> {
  if (process.env.NEXT_PUBLIC_API_URL) return; // backend deployments alert from the server
  try {
    const sub = await currentSubscription();
    await fetch("/api/events/manual-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ev, sender_endpoint: sub?.endpoint }),
      keepalive: true,
    });
  } catch { /* best effort — the count itself is already saved */ }
}
