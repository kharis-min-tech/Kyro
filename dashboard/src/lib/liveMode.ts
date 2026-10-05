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

/** Returns true if the app should use fake/demo data right now.
 *  Also true when no backend URL is configured for the deployment (e.g.
 *  Cloudflare-only preview) — in that case Live mode has nothing to talk
 *  to, so we fall back to local storage data just like demo mode. */
export function inDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem("kyro_mode") === "demo") return true;
  if (!process.env.NEXT_PUBLIC_API_URL) return true;
  return false;
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
