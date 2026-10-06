/**
 * Kyro edge Worker — runs in front of the static dashboard on Cloudflare.
 *
 * The Cloudflare deploy is a static export with no FastAPI backend, which
 * left two features unable to work from the browser alone:
 *
 *   1. Integrations — a browser POST to Slack / Zapier / Google Apps Script
 *      / most webhook receivers is blocked by CORS (they don't answer the
 *      preflight our JSON body + X-Kyro-Secret header trigger). The Worker
 *      makes the POST server-side, where CORS doesn't apply.
 *
 *   2. Notifications — real Web Push (lock screen, app closed) has to be
 *      sent by a server holding the VAPID private key. The Worker signs and
 *      encrypts pushes itself (RFC 8291 aes128gcm + RFC 8292 VAPID).
 *
 * Only /api/* reaches this script (see run_worker_first in wrangler.jsonc);
 * every other path is served straight from static assets.
 *
 * Routes:
 *   POST /api/relay/webhook          { url, secret?, payload }
 *   GET  /api/push/vapid-public-key
 *   POST /api/push/send              { subscription, kind: "test" | "demo" }
 *   POST /api/push/register          { subscription, warn, crit }
 *   POST /api/push/unregister        { endpoint }
 *   POST /api/events/manual-count    { kind, zone?, count, capacity?, counted_by?, sender_endpoint? }
 *
 * Registered devices live in the SUBS KV namespace, so a Manual Count
 * submitted on one phone alerts every leader who turned notifications on.
 *
 * Secrets / vars (wrangler.jsonc + `wrangler secret put`):
 *   VAPID_PUBLIC_KEY   base64url uncompressed P-256 point (public, in vars)
 *   VAPID_PRIVATE_KEY  base64url 32-byte private scalar (SECRET)
 *   VAPID_SUBJECT      mailto: or https: contact for push services
 */

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/relay/webhook" && request.method === "POST") {
        return await relayWebhook(request);
      }
      if (url.pathname === "/api/push/vapid-public-key" && request.method === "GET") {
        if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
          return json({ error: "Push not configured on this deployment (VAPID keys missing)" }, 503);
        }
        return json({ publicKey: env.VAPID_PUBLIC_KEY });
      }
      if (url.pathname === "/api/push/send" && request.method === "POST") {
        return await pushSend(request, env, ctx);
      }
      if (url.pathname === "/api/push/register" && request.method === "POST") {
        return await pushRegister(request, env);
      }
      if (url.pathname === "/api/push/unregister" && request.method === "POST") {
        return await pushUnregister(request, env);
      }
      if (url.pathname === "/api/events/manual-count" && request.method === "POST") {
        return await manualCountEvent(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Not found" }, 404);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// The relay and push sender are only for the Kyro dashboard itself — refuse
// cross-site callers so this can't be used as an open proxy from other pages.
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Body must be JSON"); }
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ─── Webhook relay ──────────────────────────────────────────────────────────

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.includes(":") && (h === "::1" || /^(fc|fd|fe80)/.test(h))) return true;
  return false;
}

async function relayWebhook(request) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ error: e.message }, e.status ?? 400); }

  let target;
  try { target = new URL(String(body.url ?? "").trim()); }
  catch { return json({ error: "Invalid webhook URL" }, 400); }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return json({ error: "Webhook URL must be http(s)" }, 400);
  }
  if (isBlockedHost(target.hostname)) {
    return json({ error: "Private / local addresses can't be reached from the cloud relay" }, 400);
  }
  if (typeof body.payload !== "object" || body.payload === null) {
    return json({ error: "payload must be an object" }, 400);
  }

  const headers = { "Content-Type": "application/json", "User-Agent": "Kyro-Webhook/1.0" };
  if (typeof body.secret === "string" && body.secret.trim()) headers["X-Kyro-Secret"] = body.secret.trim();

  let res;
  try {
    res = await fetch(target.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body.payload),
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ relayed: false, error: `Could not reach receiver: ${msg}` }, 502);
  }
  const text = (await res.text().catch(() => "")).slice(0, 500);
  // Always 200 from the relay itself; the receiver's verdict is in the body
  // so the UI can show "Receiver returned 404" rather than a relay error.
  return json({ relayed: true, ok: res.ok, status: res.status, statusText: res.statusText, body: text });
}

// ─── Web Push ───────────────────────────────────────────────────────────────

// Fixed messages only — the endpoint never forwards caller-supplied text,
// so it can't be abused to push arbitrary content.
const TEST_MESSAGE = {
  title: "✅ Kyro notifications active",
  body:  "Nice — push notifications are working on this device.",
  tag:   "kyro-test",
  url:   "/notifications",
  ttl:   3600,
};

// Sent ~20s after the request so the user can lock the phone / close the
// app first and see it arrive on the lock screen.
const LOCKED_TEST_MESSAGE = {
  title: "🔒 Kyro reached your lock screen",
  body:  "This arrived while Kyro was closed — you won't miss alerts.",
  tag:   "kyro-locked-test",
  url:   "/notifications",
  ttl:   3600,
};
const LOCKED_TEST_DELAY_MS = 20_000; // waitUntil allows ~30s after the response

const DEMO_MESSAGES = [
  { title: "⚠️ Main Floor filling up",  body: "82% of capacity (246 / 300)", level: "warning",  camera_id: "cam_main",     tag: "demo-1" },
  { title: "🚨 Balcony overcrowded",     body: "93% of capacity (112 / 120)", level: "critical", camera_id: "cam_balcony",  tag: "demo-2" },
  { title: "⚠️ Overflow Room filling up", body: "80% of capacity (64 / 80)",   level: "warning",  camera_id: "cam_overflow", tag: "demo-3" },
  { title: "🚨 Main Floor overcrowded",  body: "91% of capacity (273 / 300)", level: "critical", camera_id: "cam_main",     tag: "demo-4" },
  { title: "⚠️ Stadium filling up",      body: "81% of capacity (810 / 1000)", level: "warning", camera_id: "cam_stadium",  tag: "demo-5" },
  { title: "🎭 Kyro has a question",     body: "Someone moved toward the front — were they ushered?", level: "review", camera_id: "cam_main", tag: "demo-6" },
  { title: "🪑 Seat A12 is free — Main Floor", body: "A seat just opened up. Tap to see it on the seat map.", level: "seat", url: "/seating", tag: "demo-7" },
];

// Push services browsers actually hand out. Restricting to these keeps the
// sender from being pointed at arbitrary hosts.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string" || !sub.keys) return false;
  if (typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") return false;
  try {
    const u = new URL(sub.endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

async function pushSend(request, env, ctx) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return json({ error: "Push not configured on this deployment (VAPID keys missing)" }, 503);
  }
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ error: e.message }, e.status ?? 400); }
  if (!validSubscription(body.subscription)) return json({ error: "Invalid push subscription" }, 400);

  const vapid = vapidFromEnv(env);

  if (body.kind === "locked-test") {
    ctx.waitUntil((async () => {
      await new Promise((r) => setTimeout(r, LOCKED_TEST_DELAY_MS));
      await sendWebPush(body.subscription, LOCKED_TEST_MESSAGE, vapid).catch(() => {});
    })());
    return json({ queued: 1, delay_seconds: LOCKED_TEST_DELAY_MS / 1000 });
  }

  if (body.kind === "demo") {
    // Respond now, deliver over ~12s so the user can lock / minimise and
    // watch them arrive. waitUntil keeps the Worker alive for the sends.
    ctx.waitUntil((async () => {
      for (let i = 0; i < DEMO_MESSAGES.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 2000));
        await sendWebPush(body.subscription, { ...DEMO_MESSAGES[i], ttl: 600 }, vapid).catch(() => {});
      }
    })());
    return json({ queued: DEMO_MESSAGES.length });
  }

  const res = await sendWebPush(body.subscription, TEST_MESSAGE, vapid);
  if (res.status === 404 || res.status === 410) {
    return json({ error: "This device's push subscription has expired — turn notifications off and on again", gone: true }, 410);
  }
  if (!res.ok) {
    return json({ error: `Push service rejected the message (${res.status}): ${res.body.slice(0, 200)}` }, 502);
  }
  return json({ sent: true });
}

// ─── Registered devices + event alerts ──────────────────────────────────────

const SUB_TTL_SECONDS = 120 * 24 * 3600; // refreshed whenever the app is opened

function vapidFromEnv(env) {
  return {
    publicKey:  env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject:    env.VAPID_SUBJECT || "mailto:admin@kyro.app",
  };
}

function pushReady(env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.SUBS);
}

async function subKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return `sub:${b64urlEncode(digest)}`;
}

function clampFraction(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.1 && n <= 1 ? n : fallback;
}

async function pushRegister(request, env) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  if (!pushReady(env)) return json({ error: "Push alerts not configured on this deployment" }, 503);
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ error: e.message }, e.status ?? 400); }
  if (!validSubscription(body.subscription)) return json({ error: "Invalid push subscription" }, 400);

  const { endpoint, keys } = body.subscription;
  const record = {
    subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    warn: clampFraction(body.warn, 0.8),
    crit: clampFraction(body.crit, 0.9),
    updated_at: Date.now(),
  };
  await env.SUBS.put(await subKey(endpoint), JSON.stringify(record), { expirationTtl: SUB_TTL_SECONDS });
  return json({ registered: true });
}

async function pushUnregister(request, env) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  if (!env.SUBS) return json({ removed: false });
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ error: e.message }, e.status ?? 400); }
  if (typeof body.endpoint !== "string") return json({ error: "endpoint required" }, 400);
  await env.SUBS.delete(await subKey(body.endpoint));
  return json({ removed: true });
}

async function allSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    const values = await Promise.all(page.keys.map((k) => env.SUBS.get(k.name, "json")));
    values.forEach((v, i) => { if (v) out.push({ key: page.keys[i].name, ...v }); });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

// Plain text only, short, no control characters — these strings end up on
// lock screens, so keep them tidy and bounded.
function cleanText(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Coarse per-IP limit so a misbehaving client can't flood everyone's phone.
async function rateLimited(env, request, limit) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.SUBS.get(key)) || "0", 10);
  if (n >= limit) return true;
  await env.SUBS.put(key, String(n + 1), { expirationTtl: 120 });
  return false;
}

function levelFor(fraction, warn, crit) {
  if (fraction === null) return "info";
  if (fraction >= crit) return "critical";
  if (fraction >= warn) return "warning";
  return "info";
}

export function buildCountMessage(ev, sub) {
  const pct = ev.fraction === null ? "" : ` (${Math.round(ev.fraction * 100)}% full)`;
  if (ev.kind === "approved") {
    return {
      title: "✅ Final count approved",
      body:  `${ev.count.toLocaleString("en-US")} total for today's service${ev.by ? ` · approved by ${ev.by}` : ""}`,
      level: "info",
      tag:   "kyro-final-count",
      url:   "/attendance",
    };
  }
  const level = levelFor(ev.fraction, sub.warn, sub.crit);
  const title = level === "critical" ? `🚨 ${ev.zone} is over capacity`
              : level === "warning"  ? `⚠️ ${ev.zone} is filling up`
              :                        `📋 ${ev.zone} counted`;
  return {
    title,
    body: `${ev.count.toLocaleString("en-US")} people${ev.capacity ? ` of ${ev.capacity.toLocaleString("en-US")} seats` : ""}${pct}${ev.by ? ` · counted by ${ev.by}` : ""}`,
    level,
    tag:  `kyro-count-${ev.zone.toLowerCase()}`,
    url:  "/manual-count",
  };
}

async function manualCountEvent(request, env, ctx) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  if (!pushReady(env)) return json({ error: "Push alerts not configured on this deployment" }, 503);
  let body;
  try { body = await readJson(request); }
  catch (e) { return json({ error: e.message }, e.status ?? 400); }

  const kind = body.kind === "approved" ? "approved" : "count";
  const count = Math.round(Number(body.count));
  if (!Number.isFinite(count) || count < 0 || count > 1_000_000) return json({ error: "Invalid count" }, 400);
  const zone = cleanText(body.zone, 60);
  if (kind === "count" && !zone) return json({ error: "zone required" }, 400);
  const capRaw = Math.round(Number(body.capacity));
  const capacity = Number.isFinite(capRaw) && capRaw > 0 && capRaw <= 1_000_000 ? capRaw : null;
  const ev = {
    kind, zone, count, capacity,
    fraction: capacity ? count / capacity : null,
    by: cleanText(body.counted_by, 40),
  };

  if (await rateLimited(env, request, 30)) return json({ error: "Too many alerts — slow down" }, 429);

  const senderKey = typeof body.sender_endpoint === "string" ? await subKey(body.sender_endpoint) : null;
  const subs = (await allSubscriptions(env)).filter((s) => s.key !== senderKey);
  const vapid = vapidFromEnv(env);

  ctx.waitUntil(Promise.all(subs.map(async (s) => {
    const res = await sendWebPush(s.subscription, buildCountMessage(ev, s), vapid).catch(() => null);
    // Phone uninstalled the app / revoked permission — forget it.
    if (res && (res.status === 404 || res.status === 410)) await env.SUBS.delete(s.key);
  })));
  return json({ notified: subs.length });
}

// ─── RFC 8291 / 8292 implementation (WebCrypto only) ────────────────────────

const enc = new TextEncoder();

export function b64urlDecode(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

async function vapidJwt(audience, vapid) {
  const pub = b64urlDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256",
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })));
  const unsigned = `${header}.${claims}`;
  // WebCrypto ECDSA signatures are already raw r||s, which is what JWS wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `${unsigned}.${b64urlEncode(sig)}`;
}

export async function encryptPayload(subscription, plaintext) {
  const uaPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);

  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Single record: plaintext followed by the 0x02 last-record delimiter.
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export async function sendWebPush(subscription, message, vapid) {
  const endpoint = new URL(subscription.endpoint);
  const jwt = await vapidJwt(endpoint.origin, vapid);
  const { ttl: _ttl, ...payload } = message;
  const body = await encryptPayload(subscription, enc.encode(JSON.stringify(payload)));
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      // How long the push service holds the message for a phone that's
      // off / offline. Real alerts wait a day so nothing is missed while
      // the phone is switched off; demo/test messages are throwaway.
      TTL: String(message.ttl ?? 86400),
      // "high" lets Android / iOS wake a sleeping phone immediately
      // instead of batching the alert for later.
      Urgency: "high",
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body,
  });
  return { ok: res.ok, status: res.status, body: await res.text().catch(() => "") };
}
