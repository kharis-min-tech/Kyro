/**
 * Integrations (Live mode on the Cloudflare build): the end-of-service
 * webhook, stored on the server so every admin sees the same settings, and
 * sent automatically by the Worker's cron at the chosen day/time.
 *
 * Routes (admins only):
 *   GET  /api/integrations               settings (the secret itself is never returned)
 *   PUT  /api/integrations               { url, secret?, auto: { enabled, days[], time, tz } }
 *   GET  /api/integrations/preview?kind=test|live   exactly what would be sent now
 *   POST /api/integrations/send          { kind: "test" | "live" }
 *
 * What's sent: today's APPROVED manual counts (shared counts in KV) plus each
 * camera room's highest count that day (worker/venue.js), as JSON.
 */
import { currentUser } from "./accounts.js";

const CFG_KEY = "cfg:integrations";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** Hosts the cloud can't (and shouldn't) reach: localhost and private networks. */
export function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.includes(":") && (h === "::1" || /^(fc|fd|fe80)/.test(h))) return true;
  return false;
}

function validTz(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Date, weekday (0=Sun) and minutes-past-midnight in the church's timezone. */
function localParts(now, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

async function loadCfg(env) {
  return (await env.SUBS.get(CFG_KEY, "json")) || { url: "", secret: "", auto: { enabled: false, days: [0], time: "12:30", tz: "Europe/London" } };
}

function publicCfg(c) {
  return { url: c.url || "", has_secret: !!c.secret, auto: c.auto, last_sent: c.last_sent || null };
}

/** Each camera room's highest count on that day, from the live camera hub (worker/venue.js). */
async function cameraPeaks(env, date, tz) {
  if (!env.VENUE) return [];
  try {
    const hub = env.VENUE.get(env.VENUE.idFromName("venue"));
    const res = await hub.fetch(`https://hub/internal/day-peaks?date=${date}&tz=${encodeURIComponent(tz)}`, { headers: { "X-Kyro-Internal": "1" } });
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

/**
 * The JSON that gets POSTed: today's APPROVED manual counts plus each camera
 * room's count (the most people it saw at once that day). If a room has both,
 * the approved manual count wins — someone checked it by hand.
 */
export async function buildPayload(env, date, test, tz = "Europe/London") {
  const page = await env.SUBS.list({ prefix: `mc:${date}:` });
  const rows = (await Promise.all(page.keys.map((k) => env.SUBS.get(k.name, "json")))).filter(Boolean);
  const approved = rows.filter((r) => r.approved);
  const manualTotal = approved.reduce((n, r) => n + (r.count || 0), 0);
  const manualZones = new Set(approved.map((r) => String(r.zone || "").trim().toLowerCase()));
  // A test send adds a clearly fake camera zone (42 on "Main Floor") so the
  // receiving system can tell it's a dry run.
  const cameras = test
    ? [{ zone: "Main Floor", count: 42 }]
    : (await cameraPeaks(env, date, tz)).filter((c) => c.count > 0 && !manualZones.has(String(c.zone).trim().toLowerCase()));
  const cameraTotal = cameras.reduce((n, c) => n + (c.count || 0), 0);
  return {
    service_date: date,
    counted_at: new Date().toISOString(),
    mode: "live",
    totals: { camera_count: cameraTotal, manual_count: manualTotal, grand_total: cameraTotal + manualTotal },
    by_zone: [
      ...approved.map((r) => ({ zone: r.zone, count: r.count, source: "manual", approved_by: r.approved_by || null })),
      ...cameras.map((c) => ({ zone: c.zone, count: c.count, source: "camera" })),
    ],
    source: "kyro",
    kyro_version: "0.3.0",
    ...(test ? { test: true } : {}),
  };
}

async function deliver(cfg, payload) {
  let target;
  try { target = new URL(cfg.url); } catch { return { ok: false, error: "No valid webhook URL saved" }; }
  if (!/^https?:$/.test(target.protocol)) return { ok: false, error: "Webhook URL must be http(s)" };
  if (isBlockedHost(target.hostname)) return { ok: false, error: "Private / local addresses can't be reached from the cloud" };
  const headers = { "Content-Type": "application/json", "User-Agent": "Kyro-Webhook/1.0" };
  if (cfg.secret) headers["X-Kyro-Secret"] = cfg.secret;
  try {
    const res = await fetch(target.toString(), {
      method: "POST", headers, body: JSON.stringify(payload), redirect: "follow", signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: res.ok, status: res.status, statusText: res.statusText, body };
  } catch (e) {
    return { ok: false, error: `Could not reach the receiver: ${e instanceof Error ? e.message : e}` };
  }
}

export async function handleIntegrations(request, env, url) {
  if (!url.pathname.startsWith("/api/integrations")) return null;
  if (!env.SUBS) return json({ error: "Not configured" }, 503);
  const me = await currentUser(request, env);
  if (!me) return json({ error: "Please sign in again" }, 401);
  if (me.role !== "admin") return json({ error: "Only administrators can manage integrations" }, 403);

  const cfg = await loadCfg(env);
  const tz = validTz(cfg.auto?.tz) ? cfg.auto.tz : "Europe/London";

  if (url.pathname === "/api/integrations" && request.method === "GET") return json(publicCfg(cfg));

  if (url.pathname === "/api/integrations" && request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Body must be JSON" }, 400); }
    const next = { ...cfg };
    if (typeof body.url === "string") {
      const u = body.url.trim();
      if (u) {
        let parsed;
        try { parsed = new URL(u); } catch { return json({ error: "That doesn't look like a web address" }, 400); }
        if (!/^https?:$/.test(parsed.protocol)) return json({ error: "URL must start with https://" }, 400);
        if (isBlockedHost(parsed.hostname)) return json({ error: "Private / local addresses can't be reached from the cloud" }, 400);
      }
      next.url = u.slice(0, 500);
    }
    // Secret: a string replaces it, "" clears it, absent keeps it.
    if (typeof body.secret === "string") next.secret = body.secret.trim().slice(0, 200);
    if (body.auto && typeof body.auto === "object") {
      const days = Array.isArray(body.auto.days) ? [...new Set(body.auto.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : cfg.auto.days;
      const time = /^\d{2}:\d{2}$/.test(body.auto.time ?? "") ? body.auto.time : cfg.auto.time;
      next.auto = {
        enabled: !!body.auto.enabled,
        days: days.length ? days : [0],
        time,
        tz: validTz(body.auto.tz) ? body.auto.tz : tz,
      };
      if (next.auto.enabled && !next.url) return json({ error: "Add a webhook URL before turning on automatic sending" }, 400);
    }
    await env.SUBS.put(CFG_KEY, JSON.stringify(next));
    return json(publicCfg(next));
  }

  if (url.pathname === "/api/integrations/preview" && request.method === "GET") {
    const test = url.searchParams.get("kind") !== "live";
    return json(await buildPayload(env, localParts(new Date(), tz).date, test, tz));
  }

  if (url.pathname === "/api/integrations/send" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const test = body.kind !== "live";
    if (!cfg.url) return json({ ok: false, error: "Save a webhook URL first" }, 400);
    const payload = await buildPayload(env, localParts(new Date(), tz).date, test, tz);
    const result = await deliver(cfg, payload);
    if (!test) {
      await env.SUBS.put(CFG_KEY, JSON.stringify({ ...cfg, last_sent: { at: new Date().toISOString(), date: payload.service_date, how: "manual", ok: result.ok, status: result.status ?? null } }));
    }
    return json({ ...result, payload });
  }
  return json({ error: "Not found" }, 404);
}

/** Cron (every 15 min): send once on each chosen day, in the 15 minutes after the chosen time. */
export async function runIntegrationTick(env, now) {
  if (!env.SUBS) return;
  const cfg = await loadCfg(env);
  const auto = cfg.auto || {};
  if (!auto.enabled || !cfg.url) return;
  const tz = validTz(auto.tz) ? auto.tz : "Europe/London";
  const p = localParts(now, tz);
  const [hh, mm] = (auto.time || "12:30").split(":").map(Number);
  const at = hh * 60 + mm;
  if (!auto.days?.includes(p.weekday)) return;
  if (p.minutes < at || p.minutes >= at + 15) return;
  if (cfg.last_sent?.date === p.date && cfg.last_sent?.how === "auto") return; // already sent today
  const payload = await buildPayload(env, p.date, false, tz);
  const result = await deliver(cfg, payload);
  await env.SUBS.put(CFG_KEY, JSON.stringify({ ...cfg, last_sent: { at: now.toISOString(), date: p.date, how: "auto", ok: result.ok, status: result.status ?? null, error: result.error } }));
}
