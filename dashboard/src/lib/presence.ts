/**
 * Who is signed in to Kyro right now.
 *
 * Every browser that has someone signed in quietly says "still here" every
 * ten seconds, and says goodbye the moment it is closed, switched away from or
 * locked — so a device that has gone stops being listed straight away instead
 * of lingering. The Kyro server keeps all of it in memory only, and forgets any
 * browser it hasn't heard from for 30 seconds, which covers the cases where no
 * goodbye could be sent: a crash, a flat battery, Wi-Fi dropping.
 *
 * "On Kyro" therefore means a page actually open in front of someone. Put the
 * phone in your pocket and it drops off within a few seconds.
 *
 * One person can be in two places at once — Ruth on the church computer and
 * on her phone is one account with two sessions — so each browser gives
 * itself a small random id, kept in that browser, and the server counts
 * sessions per account.
 *
 * Nothing about where anyone is or what they are looking at is recorded:
 * only the account, whether it's a phone or a computer, and when it last
 * said hello.
 */
import { useEffect, useState } from "react";
import { isEdgeLive, edgeFetch, edgeToken, edgeTokenPayload } from "@/lib/edgeAuth";

/** How often each browser says "still here". The server forgets one after 30s. */
const BEAT_MS = 10_000;
/** How often the administrator's list re-checks while they are looking at it. */
const LOOK_MS = 5_000;

/** This browser's own id — made once, then kept. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem("kyro_device_id");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      localStorage.setItem("kyro_device_id", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/** Phone, tablet or computer — just enough for an admin to recognise a session. */
export function deviceKind(): "phone" | "tablet" | "computer" {
  if (typeof navigator === "undefined") return "computer";
  const ua = navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/iPhone|iPod|Android|Mobile/i.test(ua)) return "phone";
  return "computer";
}

export interface HereSession { kind: string; seconds_ago: number }
export interface HereUser {
  username: string; name: string; role: string;
  sessions: number; devices: HereSession[]; last_seen: string;
}
export interface WhoIsHere { people_here: number; sessions: number; users: HereUser[] }

/**
 * Tell the server this browser is here, for as long as it's open.
 * Mounted once for the whole site, so it keeps going as pages change.
 */
export function usePresenceHeartbeat() {
  useEffect(() => {
    if (!isEdgeLive()) return;
    let stopped = false;

    const send = (path: string, keepalive = false) => {
      const token = edgeToken();
      if (!token || !edgeTokenPayload()) return;   // signed out — nothing to report
      // Deliberately NOT edgeFetch: that treats any refusal as "your session
      // ended" and sends the browser to the sign-in page. A background
      // heartbeat must never be able to sign anyone out.
      fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ device: deviceId(), kind: deviceKind() }),
        cache: "no-store",
        // keepalive lets the goodbye finish after the page itself has gone.
        ...(keepalive ? { keepalive: true } : {}),
      }).catch(() => {});                           // never let this bother anyone
    };

    const beat = () => { if (!stopped && document.visibilityState === "visible") send("/api/live/presence"); };
    // Closing the tab, switching app, locking the phone: say so now, rather
    // than leaving an administrator looking at a device that has gone.
    const bye = () => { if (!stopped) send("/api/live/presence/bye", true); };

    beat();
    const t = setInterval(beat, BEAT_MS);
    const onVisible = () => (document.visibilityState === "visible" ? beat() : bye());
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", bye);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", bye);
    };
  }, []);
}

/** The list of who is signed in, refreshed every few seconds. Administrators only. */
export function useWhoIsHere(enabled = true) {
  const [here, setHere] = useState<WhoIsHere | null>(null);
  useEffect(() => {
    if (!enabled || !isEdgeLive()) return;
    let stopped = false;
    const load = () => {
      if (stopped || document.visibilityState === "hidden") return;
      edgeFetch<WhoIsHere>("/api/live/presence")
        .then((d) => { if (!stopped) setHere(d); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, LOOK_MS);
    // Coming back to this page should show the truth at once, not in 5 seconds.
    document.addEventListener("visibilitychange", load);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", load); };
  }, [enabled]);
  return here;
}

/** "just now", "2 minutes ago" — for the last time a session was heard from. */
export function agoWords(seconds: number): string {
  if (seconds < 60) return "just now";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}
