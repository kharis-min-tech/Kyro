/**
 * liveMode.ts — single source of truth for mode detection.
 *
 * The user's mode choice (made on the login screen) is stored under the
 * "kyro_mode" localStorage key as either "demo" or "live". Both helpers
 * below read that same key so they can never disagree with each other —
 * demo mode is a runtime choice, not gated behind a build-time flag.
 */

/** Returns true if user is in live mode (chose Live on login screen). */
export function isLiveMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("kyro_mode") === "live";
}

/** Returns true if the app should use the LOCAL STORAGE path for data
 *  operations instead of calling the backend. True when the user picked
 *  demo mode OR when no backend URL is configured for the deployment
 *  (Cloudflare-only preview) — in both cases there's no backend to talk
 *  to, so pages fall back to local storage. */
export function inDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem("kyro_mode") === "demo") return true;
  if (!process.env.NEXT_PUBLIC_API_URL) return true;
  return false;
}

/** Returns true ONLY if the user explicitly picked Demo mode on the
 *  login screen. Use this when deciding whether to SEED fake demo data
 *  (e.g. DEMO_CAMERAS). Live mode without a backend should start empty,
 *  not pre-populated with fake Balcony / Overflow cameras. */
export function isUserChosenDemo(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("kyro_mode") === "demo";
}

export function setLiveMode() {
  if (typeof window !== "undefined") {
    localStorage.setItem("kyro_mode", "live");
    sessionStorage.setItem("kyro_live_mode", "1");
  }
}

export function setDemoMode() {
  if (typeof window !== "undefined") {
    localStorage.setItem("kyro_mode", "demo");
    sessionStorage.removeItem("kyro_live_mode");
  }
}
