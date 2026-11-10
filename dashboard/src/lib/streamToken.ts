"use client";

/**
 * A short-lived, watch-only token for a URL.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A browser cannot put an Authorization header on an `<img src>` or on a
 * WebSocket, so a picture endpoint has to take its token in the query string.
 * And a query string is not private: it is written to the web server's access
 * log, to every proxy in front of it, and to the browser's own history.
 *
 * What used to go there was the SESSION token — the key to somebody's whole
 * account, with a day of life left in it, sitting in a log file for as long as
 * that log is kept. Anyone who could read the log could be that person.
 *
 * This is the replacement. The server mints it from the session token (which
 * travels in a header, properly), it expires in minutes, and it carries
 * `scope: "stream"` so it cannot be used to read a figure, change a camera or
 * answer a question. It can open a picture. That is all it can do.
 *
 * Fetched once and reused until shortly before it expires, so a page full of
 * seat thumbnails asks for one token rather than forty.
 */

import { useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

let token: string | null = null;
let expiresAt = 0;
let asking: Promise<string | null> | null = null;

/** Thrown away on sign-out, so the next page does not reuse somebody else's. */
export function forgetStreamToken(): void {
  token = null;
  expiresAt = 0;
  asking = null;
}

/** A stream token, fetching a new one if the one in hand is close to expiring. */
export async function streamToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  // Half a minute of margin: a token that expires while the request is in
  // flight is a broken picture for no reason.
  if (token && Date.now() < expiresAt - 30_000) return token;
  if (asking) return asking;
  const session = localStorage.getItem("kyro_token");
  if (!session) return null;
  asking = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/stream-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { token?: string; expires_in?: number };
      if (!body.token) return null;
      token = body.token;
      expiresAt = Date.now() + Math.max(30, Number(body.expires_in) || 300) * 1000;
      return token;
    } catch {
      return null;
    } finally {
      asking = null;
    }
  })();
  return asking;
}

/** `?token=…` (or `&token=…`) for a URL that needs one, or "" when there is none. */
export async function streamQuery(join: "?" | "&" = "?"): Promise<string> {
  const t = await streamToken();
  return t ? `${join}token=${encodeURIComponent(t)}` : "";
}

/**
 * A `src` for an <img> that needs a stream token.
 *
 * The token has to be fetched, so the URL cannot be built on the spot in a
 * render. This resolves it once and hands back a string — empty until it is
 * ready, which an <img> treats as "nothing to show yet".
 */
export function useStreamSrc(make: () => Promise<string>, deps: unknown[]): string {
  const [src, setSrc] = useState("");
  // The factory is rebuilt every render; the deps are what actually change.
  const ref = useRef(make);
  ref.current = make;
  useEffect(() => {
    let alive = true;
    ref.current().then((u) => { if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return src;
}
