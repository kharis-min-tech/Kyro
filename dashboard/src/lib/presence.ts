/**
 * Who is signed in to Kyro right now.
 *
 * Every browser that has someone signed in quietly says "still here" every
 * half minute. The Kyro server keeps those messages in memory only, and
 * forgets any browser it hasn't heard from for a minute and a half.
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

/** How often each browser says "still here". The server allows 90s. */
const BEAT_MS = 30_000;

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
    const beat = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const token = edgeToken();
      if (!token || !edgeTokenPayload()) return;   // signed out — nothing to report
      // Deliberately NOT edgeFetch: that treats any refusal as "your session
      // ended" and sends the browser to the sign-in page. A background
      // heartbeat must never be able to sign anyone out.
      fetch("/api/live/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ device: deviceId(), kind: deviceKind() }),
        cache: "no-store",
      }).catch(() => {});                      // never let this bother anyone
    };
    beat();
    const t = setInterval(beat, BEAT_MS);
    // Coming back to the tab should show up straight away, not in 30 seconds.
    document.addEventListener("visibilitychange", beat);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", beat); };
  }, []);
}

/** The list of who is signed in, refreshed every 15 seconds. Administrators only. */
export function useWhoIsHere(enabled = true) {
  const [here, setHere] = useState<WhoIsHere | null>(null);
  useEffect(() => {
    if (!enabled || !isEdgeLive()) return;
    let stopped = false;
    const load = () => {
      edgeFetch<WhoIsHere>("/api/live/presence")
        .then((d) => { if (!stopped) setHere(d); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { stopped = true; clearInterval(t); };
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
