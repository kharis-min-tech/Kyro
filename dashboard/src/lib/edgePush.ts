/**
 * edgePush.ts — talks to the Cloudflare Worker (worker/index.js) that sends
 * Web Push when there's no FastAPI backend. Every call is best-effort: on a
 * build without the Worker (next dev, NAS) the requests just fail quietly.
 */

const PREFS_KEY = "kyro_notif_prefs";
const DEMO_AUTO_KEY = "kyro_demo_auto";

/** How often Demo mode sends automatic sample alerts: minutes, or "off". */
export type DemoAuto = "off" | "15" | "60";

export function getDemoAuto(): DemoAuto {
  try {
    const v = localStorage.getItem(DEMO_AUTO_KEY);
    return v === "off" || v === "60" ? v : "15";
  } catch { return "15"; }
}

/** What the Worker needs to decide which automatic alerts this device gets. */
function deviceContext() {
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch {}
  return {
    mode: localStorage.getItem("kyro_mode") === "live" ? "live" : "demo",
    tz,
    demo_auto: getDemoAuto(),
  };
}

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
      body: JSON.stringify({ subscription: sub.toJSON(), warn: thresholds.warn, crit: thresholds.crit, ...deviceContext() }),
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

/** Re-send this device's mode / timezone / demo setting (after a change). */
export async function refreshEdgeRegistration(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_API_URL) return false;
  const sub = await currentSubscription();
  return sub ? registerEdgeDevice(sub) : false;
}

export async function setDemoAuto(choice: DemoAuto): Promise<boolean> {
  try { localStorage.setItem(DEMO_AUTO_KEY, choice); } catch {}
  return refreshEdgeRegistration();
}

/** Re-save this device with new thresholds (Notifications page sliders). */
export async function updateEdgeThresholds(warn: number, crit: number): Promise<boolean> {
  const sub = await currentSubscription();
  return sub ? registerEdgeDevice(sub, { warn, crit }) : false;
}

/** This device's push endpoint, so the server can skip alerting the sender. */
export async function currentPushEndpoint(): Promise<string | undefined> {
  return (await currentSubscription())?.endpoint;
}
